import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { getCurrentUserId } from '../lib/auth';
import { getAyahLocation } from '../lib/juzSurahMap';
import { expectedWordsFrom, normalizeArabic } from '../lib/arabicUtils';
import { getAyah } from '../lib/quranApi';
import { supabase } from '../lib/supabase';
import {
  ListeningCancelled,
  startListening,
  stopListening,
  resetUtterance,
  resumeListening,
  rewindUtterance,
} from '../lib/realtimeTranscription';
import { createLiveJudge, findAyahRestart, describeExtraWords } from '../lib/liveWordJudge';
import { useSQLiteContext } from 'expo-sqlite';
import MushafPage from '../components/MushafPage';
import { getPageForAyah } from '../lib/mushafDb';
import { reportHandledError } from '../lib/sentry';
import { colors, fonts, radius, spacing } from '../lib/theme';

// Remove consecutive duplicate words (stutters) before passing to the live judge.
function dedupeConsecutiveWords(text) {
  if (!text) return text;
  const words = normalizeArabic(text).split(/\s+/).filter(Boolean);
  return words.filter((w, i) => i === 0 || w !== words[i - 1]).join(' ');
}

// Returns true if `text` contains 3+ consecutive words that appear in order
// inside any of the confirmed ayah word lists. Checks from most recent to
// oldest so that if multiple ayahs share an opening phrase the most recently
// completed one wins. Sequential matching avoids false positives from shared
// phrases (e.g. Ar-Rahman repetitions).
function isGoingBack(text, confirmedAyahWords) {
  if (!text || confirmedAyahWords.length === 0) return false;
  const spoken = normalizeArabic(text).split(/\s+/).filter(Boolean);
  for (let a = confirmedAyahWords.length - 1; a >= 0; a--) {
    const prevWords = confirmedAyahWords[a];
    if (prevWords.length < 3) continue;
    let prevIdx = 0;
    let streak = 0;
    for (const w of spoken) {
      while (prevIdx < prevWords.length && prevWords[prevIdx] !== w) prevIdx++;
      if (prevIdx < prevWords.length) {
        streak++;
        prevIdx++;
        if (streak >= 3) return true;
      } else {
        break;
      }
    }
  }
  return false;
}

// True when 3+ of the spoken words appear in order inside `expected`, or when
// everything said so far does and there are simply fewer than three of them.
// The same sequential test isGoingBack uses, pointed at one word list.
function runsThrough(spoken, expected) {
  if (spoken.length === 0 || expected.length === 0) return false;
  let idx = 0;
  let streak = 0;
  for (const w of spoken) {
    while (idx < expected.length && expected[idx] !== w) idx++;
    if (idx >= expected.length) break;
    streak++;
    idx++;
    if (streak >= 3) return true;
  }
  return streak > 0 && streak === spoken.length;
}

/**
 * Consecutive commits that fail to move matchPos before we offer a way out.
 *
 * The recogniser sometimes cannot produce a word no matter how it is recited.
 * Al-Fatihah 3 came back as ارحمني, رحيم, اروح, يرحم across fifteen commits
 * and never once as الرحمن. Nothing matched, so the ayah could not complete,
 * and reciting ahead only produced more misses against an ayah already left
 * behind. The only escape was to pause the session and resume it, which is not
 * something anyone should have to work out mid-recitation.
 *
 * Three is roughly five to ten seconds of speech: long enough that a person
 * merely pausing to think does not see it, short enough to arrive before they
 * conclude the app is broken.
 */
const STALLED_COMMITS_BEFORE_SKIP = 3;

/**
 * Where the run of wrong words at the front starts: walk back from `frontier`
 * over words in `wrong`, stopping at a word asked for with Reveal, which is
 * always shown. Equal to `frontier` when the word before it is not wrong.
 *
 * One place for the display rule (the red underline), the lost-place record
 * and Reveal, which used to carry three copies of this loop.
 */
function frontRunStart(frontier, wrong, revealed) {
  let start = frontier;
  while (start > 0 && wrong.has(start - 1) && !revealed.has(start - 1)) start -= 1;
  return start;
}

// Ayahs fetched at once when restoring a resumed session. Enough to make a
// long portion quick, few enough not to hammer quran.com.
const RESUME_FETCH_BATCH = 10;

export default function RecitationScreen(props) {
  const params = props.route?.params ?? props;
  const {
    startOffset,
    endOffset,
    sessionId,
    juzNumber = 1,
    totalAyahsInJuz,
    resumeFromOffset = startOffset,
  } = params;

  const navigation = useNavigation();
  const db = useSQLiteContext();
  // Portions are juz-relative offsets, not surah-relative ayah numbers. A juz
  // holds up to eleven surahs, so a portion routinely starts in one and ends in
  // another: juz 1 day one runs Al-Fatiha 1 to Al-Baqarah 88. The old params
  // carried the *start's* surah with the *end's* ayah number, which produced
  // either a nonsensical count (Al-Fatiha, ayahs 1 to 88, when it has 7) or a
  // negative one (Al-Baqarah 282 to Ali Imran 83 gives -198, ending the session
  // after a single ayah). Offsets have no such ambiguity: every ayah resolves
  // its own surah, one at a time.
  const totalAyahs = endOffset - startOffset + 1;
  const initialAyahIndex = resumeFromOffset - startOffset;

  /** Surah and ayah for the nth ayah of this portion, counting from 0. */
  const locationAt = useCallback(
    (index) => getAyahLocation(juzNumber, startOffset + index),
    [juzNumber, startOffset]
  );
  const [currentAyahIndex, setCurrentAyahIndex] = useState(initialAyahIndex);
  const [confirmedAyahs, setConfirmedAyahs] = useState([]);
  const [currentAyahDisplay, setCurrentAyahDisplay] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  // Set when the microphone closed itself: two minutes of silence, or two hours
  // in one sitting. Null while listening.
  const [micClosedReason, setMicClosedReason] = useState(null);
  // Nothing is listening until the mic is tapped. The microphone used to open
  // itself on arrival, which meant the screen asked people to recite while it
  // was already recording, and gave them no way to get ready first.
  const [hasStarted, setHasStarted] = useState(false);
  // True once the microphone is genuinely open. The screen used to go live the
  // instant the mic was tapped, while the token fetch and the connection still
  // had a second or two to run, so it told people to recite before anything
  // could hear them. The audio is held from this moment on, so this is the
  // honest point to say so.
  const [micReady, setMicReady] = useState(false);
  // Bumped to restart listening after the microphone closed itself. The whole
  // setup lives in one effect, so re-running it is the honest way back in
  // rather than duplicating the connection logic.
  const [listenAttempt, setListenAttempt] = useState(0);
  // When recitation actually began, so its duration can be recorded separately
  // from the quizzes either side of it. Deliberately NOT reset when the silence
  // cutoff resumes: a pause is part of how long the portion took, and sessions
  // that imply an implausible pace are discarded later rather than corrected
  // for here.
  const recitationStartedAt = useRef(null);

  const resumeAfterAutoStop = useCallback(() => {
    setMicClosedReason(null);
    setListenAttempt((n) => n + 1);
  }, []);

  const ayahDataRef = useRef({
    textDisplay: '',
    textCompare: '',
    words: [],
    isDisconnectedLetters: false,
  });
  const nextAyahCacheRef = useRef(null);
  const currentAyahIndexRef = useRef(initialAyahIndex);

  // ── Per-ayah mistake tracking ──────────────────────────────────────────────
  // Accumulates wrong word indices throughout the ayah (grows, never shrinks).
  const accumulatedWrongIndicesRef = useRef(new Set());
  // Normalized word lists for every confirmed ayah (oldest → newest).
  const confirmedAyahWordsRef = useRef([]);
  // True once going-back is detected in onPartial. Prevents onMarksChange from
  // adding false-positive indices even after the STABILITY_LAG delay fires.
  // Reset to false when matchPos advances again (user is back on current ayah).
  const isGoingBackRef = useRef(false);
  // Tracks the previous matchPos so onCommit can detect skips.
  const prevMatchPosRef = useRef(0);
  // Ref mirror of revealedWordCount so onMarksChange can read/bump it
  // synchronously without a stale closure over the state value.
  const revealedWordCountRef = useRef(0);
  // Ref mirror of liveLetterDiff so onAyahComplete can read the final spoken
  // words synchronously (before React flushes the async setState).
  const letterDiffRef = useRef({});
  // Clears the "Mistake in ayah N" message after 3 s (cancelled on advance).
  // Consecutive commits that did not move matchPos forward. Reset the moment
  // it advances, and on every ayah change. Drives the skip offer.
  const stalledCommitsRef = useRef(0);
  // Ref mirror of liveText, so a skip can hand the real spoken text to
  // onAyahComplete rather than an empty string.
  const liveTextRef = useRef('');
  // Wrong words a restart of this ayah must not erase: the slip that sent the
  // reciter back to the top, plus anything Reveal or skip detection put there.
  // Everything else standing at that moment came from aligning an abandoned
  // half-attempt against the whole ayah, and was never really recited wrong.
  const stickyWrongIndicesRef = useRef(new Set());
  const stickyLetterDiffRef = useRef({});
  // The latest verdict from each source, index → spoken word (null = the word
  // was not said at all). Held whole, and replaced rather than added to, so a
  // word the aligner stops objecting to loses its mark. The old code only ever
  // added, which made the first doubt about a word permanent for the ayah.
  const commitFaultsRef = useRef(new Map());
  const partialFaultsRef = useRef(new Map());
  // Words the reciter asked to be shown. The only marks the end-of-ayah
  // reconciliation cannot overturn: they were not a judgement about the
  // recitation, so there is nothing for a later alignment to disagree with.
  const revealedWrongRef = useRef(new Set());
  // Words where the reciter lost their place: two or more wrong in a row at
  // the front, shown as a red underline. The first of the run is a mistake
  // however the ayah ends. Going back and reciting it correctly does not undo
  // having been stuck on it, so like a revealed word it survives restarts and
  // the end-of-ayah reconciliation.
  const lostAtRef = useRef(new Set());
  // Words the reciter skipped over: marked 'missing' by a commit, which the
  // aligner only does once a later word has been matched. Like a stuck word,
  // a skipped one stays a mistake after the reciter goes back and says it.
  // Without this, a skip that first looked like a run of wrong words at the
  // front was treated as getting lost: only its first word stayed red and the
  // rest went green once recited (Al-Baqarah 143, "القبلة التي ان يتبعوا
  // الرسول", skipping كنت عليها الا لنعلم من, then going back for them).
  const skippedRef = useRef(new Set());
  // How much of the ayah was recited before the reciter started it over. A
  // restart moves the matcher back to the top, and the page following it took
  // everything already recited off the screen until they caught up again.
  const keptRevealedRef = useRef(0);
  // Wrong or skipped words that have already had their mistake sound.
  const alertedIndicesRef = useRef(new Set());
  // Transcript of the attempts a restart threw away, kept only so the logged
  // mistake still shows everything that was actually said.
  const discardedAttemptsRef = useRef('');
  // ──────────────────────────────────────────────────────────────────────────

  const [skippedWordIndices, setSkippedWordIndices] = useState([]);
  const startedRef = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [showTransition, setShowTransition] = useState(false);
  const [isRevisionComplete, setIsRevisionComplete] = useState(false);
  const finishRevisionRef = useRef(null);
  const liveJudgeRef = useRef(null);
  const [liveWrongIndices, setLiveWrongIndices] = useState([]);
  // wordIndex → normalized spoken word (null = word was skipped entirely)
  const [liveLetterDiff, setLiveLetterDiff] = useState({});
  const [liveText, setLiveText] = useState('');
  const [revealedWordCount, setRevealedWordCount] = useState(0);
  // True once the recogniser has stalled long enough to offer a way past.
  const [canSkip, setCanSkip] = useState(false);
  // Ordered list of unique mushaf pages visited this session, for swiping back.
  const [allPages, setAllPages] = useState([]);
  const pageListRef = useRef(null);
  const { width: screenWidth } = useWindowDimensions();

  /**
   * Add this visit's reciting time to whatever the session already had.
   *
   * recitation_seconds used to be overwritten with the time since this screen
   * mounted, and the screen mounts again on every resume. So a portion recited
   * across two sittings stored only the second one, while refreshMeasuredPace()
   * divided it by the pages of the whole portion. Every resumed session made
   * the person look faster than they are, their measured pace drifted down,
   * and a too-fast pace hands out portions too long to finish, which is what
   * makes people pause in the first place.
   *
   * Read-then-add rather than an atomic increment: one person recites on one
   * device at a time, and the alternative is a database function for a number
   * that is already wall-clock and approximate.
   */
  const bankRecitationSeconds = useCallback(async () => {
    const startedAt = recitationStartedAt.current;
    if (!sessionId || !startedAt) return;

    const leg = Math.round((Date.now() - startedAt) / 1000);
    // Reset first, so a second call cannot bank the same stretch twice.
    recitationStartedAt.current = Date.now();
    if (leg <= 0) return;

    const { data: row } = await supabase
      .from('sessions')
      .select('recitation_seconds')
      .eq('id', sessionId)
      .maybeSingle();

    await supabase
      .from('sessions')
      .update({ recitation_seconds: (row?.recitation_seconds ?? 0) + leg })
      .eq('id', sessionId);
  }, [sessionId]);

  const isFinishingRef = useRef(false);

  const finishRevisionAndNavigate = useCallback(async () => {
    // The button stays on screen until the transition covers it, so a second
    // tap would run all of this twice.
    if (isFinishingRef.current) return;
    isFinishingRef.current = true;
    // Nothing here may stand between someone who has finished reciting and
    // their summary. Every step used to be awaited bare, so one that stalled
    // left them on a button that did nothing, and the session was never moved
    // on.
    //
    // There is no recap quiz any more: reciting the portion finishes the
    // session. Its mistakes are queued for later review when it is scored,
    // after the summary's corrections; see applyPendingSessionPlans().
    try {
      await stopListening();
      await bankRecitationSeconds();
      if (sessionId) {
        const { error: completeError } = await supabase
          .from('sessions')
          .update({ phase: 'complete', status: 'complete', completed_at: new Date().toISOString() })
          .eq('id', sessionId);
        if (completeError) throw new Error(completeError.message);
      }
    } catch (err) {
      // The summary can show without these. If the session was not marked
      // complete, the Today screen finishes it on the next start, because
      // last_confirmed_ayah already reaches the end of the portion.
      reportHandledError('recitation.finish', err);
    }
    setShowTransition(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 1500,
      useNativeDriver: true,
    }).start();
    await new Promise((resolve) => setTimeout(resolve, 4000));
    navigation.replace('SessionSummary', { sessionId, totalAyahsInJuz });
  }, [
    navigation,
    sessionId,
    startOffset,
    endOffset,
    juzNumber,
    totalAyahsInJuz,
    fadeAnim,
  ]);

  finishRevisionRef.current = finishRevisionAndNavigate;

  /**
   * Recompute what is marked wrong from the three things that can mark it: the
   * frozen slip and anything asked for outright (sticky), the last committed
   * alignment, and the last live one. Sticky is applied last-resort-first
   * because it is a record of what happened, not an opinion that can change.
   */
  const applyMarks = useCallback(() => {
    const next = new Set(stickyWrongIndicesRef.current);
    const diff = { ...stickyLetterDiffRef.current };
    for (const [index, spoken] of commitFaultsRef.current) {
      next.add(index);
      diff[index] = spoken;
    }
    for (const [index, spoken] of partialFaultsRef.current) {
      next.add(index);
      diff[index] = spoken;
    }
    // Refs updated synchronously so onAyahComplete can read the final diff
    // before React flushes the state below.
    accumulatedWrongIndicesRef.current = next;
    letterDiffRef.current = diff;
    setLiveWrongIndices([...next]);
    setLiveLetterDiff(diff);
    return next;
  }, []);

  /**
   * Show the ayah up to where the reciter currently is, by the latest reading.
   *
   * This only ever moved forward. A run of wrong words is first read as wrong
   * words in place of the ayah's next ones, which revealed the ayah that far;
   * when a later word let the aligner see they were nothing to do with those
   * words, it moved back, the marks came off, and the words stayed on screen
   * in green although nobody had said them. Tested on a phone: "يا يكون للناس
   * عليكم حجة" in place of "وان الذين اوتوا الكتاب" left انه green.
   *
   * Now it follows the reading both ways. What the reciter asked to be shown,
   * a word they got stuck on, and what was on screen before they started the
   * ayah over (keptRevealedRef) hold it open.
   */
  const syncRevealed = useCallback(() => {
    let next = Math.max(prevMatchPosRef.current, keptRevealedRef.current);
    for (const index of accumulatedWrongIndicesRef.current) next = Math.max(next, index + 1);
    for (const index of revealedWrongRef.current) next = Math.max(next, index + 1);
    for (const index of lostAtRef.current) next = Math.max(next, index + 1);
    if (next !== revealedWordCountRef.current) {
      revealedWordCountRef.current = next;
      setRevealedWordCount(next);
    }
  }, []);

  const revealNextWord = useCallback(() => {
    // The next word not yet shown. When the reciter is stuck, the wrong words
    // at the front are hidden under an underline, and the word they need is
    // the first of those, not the word after them all.
    const wordIndex = frontRunStart(
      revealedWordCountRef.current,
      accumulatedWrongIndicesRef.current,
      revealedWrongRef.current
    );
    const words = ayahDataRef.current?.words;
    if (!words || wordIndex >= words.length) return;
    // Asked for outright, so neither a restart nor a later re-solve takes it back.
    revealedWrongRef.current.add(wordIndex);
    stickyWrongIndicesRef.current.add(wordIndex);
    stickyLetterDiffRef.current[wordIndex] = null;
    applyMarks();
    const next = Math.max(revealedWordCountRef.current, wordIndex + 1);
    revealedWordCountRef.current = next;
    setRevealedWordCount(next);
  }, [applyMarks]);

  const getExpectedWords = useCallback(() => {
    if (ayahDataRef.current?.isDisconnectedLetters) return [];
    return expectedWordsFrom(ayahDataRef.current?.words);
  }, []);

  const loadAyah = useCallback(async (ayahIndex) => {
    const { surahNumber, ayahNumber } = locationAt(ayahIndex);

    let data;
    if (nextAyahCacheRef.current?.index === ayahIndex) {
      data = nextAyahCacheRef.current.data;
      ayahDataRef.current = data;
      nextAyahCacheRef.current = null;
    } else {
      data = await getAyah(surahNumber, ayahNumber);
      ayahDataRef.current = data;
    }

    setCurrentAyahDisplay(
      data.isDisconnectedLetters ? data.textCompare : data.textDisplay
    );

    const prefetchIndex = ayahIndex + 1;
    if (prefetchIndex < totalAyahs) {
      // Resolved separately: the next ayah may belong to the next surah.
      const next = locationAt(prefetchIndex);
      getAyah(next.surahNumber, next.ayahNumber)
        .then((d) => {
          nextAyahCacheRef.current = { index: prefetchIndex, data: d };
        })
        .catch(() => {});
    }
  }, [locationAt, totalAyahs]);

  const buzzAndTone = useCallback(async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {
      // haptics not supported
    }
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('../assets/beep.mp3')
      );
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) sound.unloadAsync();
      });
    } catch (e) {
      console.log('Sound error:', e);
    }
  }, []);

  /**
   * Has the reciter doubled back to an ayah they already finished?
   *
   * Entering the state also clears any marks this ayah picked up from at or
   * after the current position, because those came from words that were never
   * meant for this ayah in the first place.
   *
   * Used from two places. The partials see it first and most often, since they
   * carry the running text and arrive several times a second. The committed
   * words then ask again before being judged, and a commit on its own is often
   * only two or three words, too few to recognise: that is why an already
   * open going-back state counts as an answer on its own. The partials are the
   * detector, this is the memory of what they found.
   */
  /**
   * Do these words fit the ayah currently on screen?
   *
   * Matched against the whole ayah rather than from the position reached, so
   * that someone starting the ayah again from its first word reads as working
   * on this ayah, which it is, and goes to the restart handling that exists
   * for it rather than being taken for a jump back to an earlier one.
   */
  const matchesCurrentAyah = useCallback((text) => {
    const spoken = normalizeArabic(text ?? '').split(/\s+/).filter(Boolean);
    // Flattened, because this counts spoken words against spoken words. The
    // expected list is one entry per written word and some of those are said
    // as two, which no single spoken word could ever equal.
    const expected = getExpectedWords().flatMap((w) => w.split(' '));
    return runsThrough(spoken, expected);
  }, [getExpectedWords]);

  const checkGoingBack = useCallback((text) => {
    // The ayah in front of them wins any tie.
    //
    // The Qur'an repeats itself by design, and a refrain makes the test below
    // fire on a perfectly ordinary recitation: Ar-Rahman 16 is word for word
    // Ar-Rahman 13, so reciting 16 looks exactly like doubling back to 13.
    // That was survivable while going-back only suppressed marks. It is not
    // survivable now that it drops the words: the ayah on screen would never
    // see them, never complete, and the reciter would be stuck on an ayah they
    // were reciting correctly. So if the words fit the ayah they are on, that
    // is the reading, whatever else they also resemble.
    //
    // Except before the new ayah has begun. Asked for by the author: having
    // finished an ayah, going back into it is not a mistake in the next one,
    // however few words it is. The general test needs three words in a row,
    // and the tie-break above gives words to the ayah on screen whenever they
    // occur anywhere in it, which with one or two words (الله, من) is nearly
    // always. So the first word the reciter said was judged against the new
    // ayah and marked wrong. Until something of the new ayah has been
    // recited, a real start of it begins with its first word; words that do
    // not, and that run in order through the ayah just finished, are going
    // back into it.
    const spoken = normalizeArabic(text ?? '').split(/\s+/).filter(Boolean);
    const justFinished = confirmedAyahWordsRef.current[confirmedAyahWordsRef.current.length - 1];
    const firstWord = getExpectedWords().flatMap((w) => w.split(' '))[0];
    const backBeforeStarting =
      prevMatchPosRef.current === 0 &&
      !!justFinished &&
      spoken.length > 0 &&
      spoken[0] !== firstWord &&
      runsThrough(spoken, justFinished);

    if (!backBeforeStarting) {
      if (matchesCurrentAyah(text)) return false;
      if (!isGoingBack(text, confirmedAyahWordsRef.current)) return false;
    }
    if (!isGoingBackRef.current) {
      isGoingBackRef.current = true;
      // Scrub indices at or beyond current matchPos — those came from
      // going-back words misread against this ayah, not real mistakes.
      const pos = prevMatchPosRef.current;
      [...accumulatedWrongIndicesRef.current].forEach((i) => {
        if (i >= pos) accumulatedWrongIndicesRef.current.delete(i);
      });
      // Withdrawn for good, not merely until the next re-solve.
      //
      // These marks sit in sticky as well, and sticky is a record rather than
      // an opinion: the end of the ayah restores from it, and every call to
      // applyMarks puts it back. Clearing only the working set left them to
      // reappear on the next update, and now that a mark is kept unless it can
      // be proved an artefact, they would reappear on the finished ayah too.
      // A word marked because the reciter was somewhere else entirely is the
      // one case where the mark is provably not theirs.
      //
      // Words asked for outright are left alone. Those were never a judgement.
      [...stickyWrongIndicesRef.current].forEach((i) => {
        if (
          i >= pos &&
          !revealedWrongRef.current.has(i) &&
          !lostAtRef.current.has(i) &&
          !skippedRef.current.has(i)
        ) {
          stickyWrongIndicesRef.current.delete(i);
          delete stickyLetterDiffRef.current[i];
        }
      });
      setLiveWrongIndices([...accumulatedWrongIndicesRef.current]);
    }
    return true;
  }, [getExpectedWords, matchesCurrentAyah]);

  // One sound per mistake, asked for by the author. A run of neighbouring
  // wrong or skipped words is one mistake however it arrives: word by word,
  // all at once, or reported twice (the live judge and the committed words
  // both name the same slip, a moment apart, and each used to sound). A run
  // sounds only if none of its words has sounded before. The sound is the
  // whole alert; the "Mistake in ayah N" line under the page was removed.
  const alertMistake = useCallback(() => {
    if (ayahDataRef.current?.isDisconnectedLetters) return;
    // Revealed words are left out: asking for one makes no sound, and counting
    // it here made the next check beep for it as if it were new.
    const faults = new Set(
      [...accumulatedWrongIndicesRef.current].filter((i) => !revealedWrongRef.current.has(i))
    );
    const alerted = alertedIndicesRef.current;
    let isNewMistake = false;
    for (const index of faults) {
      if (alerted.has(index)) continue;
      // Walk out to the ends of this word's run of faults.
      let lo = index;
      while (faults.has(lo - 1)) lo -= 1;
      let hi = index;
      while (faults.has(hi + 1)) hi += 1;
      let runAlerted = false;
      for (let k = lo; k <= hi && !runAlerted; k += 1) runAlerted = alerted.has(k);
      if (!runAlerted) isNewMistake = true;
    }
    for (const index of faults) alerted.add(index);
    if (isNewMistake) buzzAndTone();
  }, [buzzAndTone]);

  const recreateJudge = useCallback(() => {
    liveJudgeRef.current = createLiveJudge({
      // The one list, not the ayah's text split on spaces. Everything the judge
      // returns is an index the screen looks up in `words` to paint a mushaf
      // word red, so a list of a different length puts every mark after the
      // first multi-word spelling on the wrong word.
      getExpectedWords,
      onMistake: () => {
        // Freeze the board as it stands: this is the slip itself, and it
        // survives however many times the ayah is started over afterwards.
        stickyWrongIndicesRef.current = new Set(accumulatedWrongIndicesRef.current);
        stickyLetterDiffRef.current = { ...letterDiffRef.current };
        alertMistake();
      },
      onMarksChange: (entries) => {
        // entries: [{index, status, spoken}] — discard if going-back detected.
        if (isGoingBackRef.current) return;
        // Replaced wholesale, not merged: the judge re-solves the whole ayah on
        // every partial, so a slot it no longer objects to must be able to lose
        // its mark. Anything that should outlive a re-solve lives in sticky.
        partialFaultsRef.current = new Map(
          entries.map(({ index, spoken }) => [index, spoken ?? null])
        );
        applyMarks();
        // A wrong word not yet reached by matchPos is shown now, and one the
        // judge withdraws is hidden again.
        syncRevealed();
      },
    });
  }, [alertMistake, applyMarks, getExpectedWords, syncRevealed]);

  /**
   * The reciter has gone back to the first word of the ayah they are on.
   *
   * Starting an ayah again after a slip is how people actually correct
   * themselves, and it used to be punished twice over. The abandoned attempt
   * stayed in the transcript, so the second run at the opening had to be
   * aligned as extra words and half the ayah came back red; and the matcher,
   * still waiting on the word that was fumbled, sat through the whole re-read
   * without advancing, which counts as a stall and puts the skip button out.
   *
   * The slip that caused the restart still stands. Nothing the restart itself
   * produces does.
   *
   * @param {number} restartAt index of the new attempt in the live word stream
   */
  const handleAyahRestart = useCallback((restartAt) => {
    // restartAt counts the unstable partial tail too, which the recogniser has
    // not committed and so cannot rewind. rewindUtterance clamps to what it
    // actually holds, which is the whole abandoned attempt either way.
    const { discarded } = rewindUtterance(restartAt);
    discardedAttemptsRef.current = [discardedAttemptsRef.current, discarded]
      .filter(Boolean)
      .join(' ');

    // The page stays exactly as it was when the reciter went back: what was
    // shown stays shown, and what was red stays red. Asked for by the author;
    // the app follows them silently from the top until they catch up.
    //
    // "Shown" is what the reciter could see, which stops at the red underline
    // when they were stuck: wrong words at the front are hidden under it, and
    // keeping the matcher's reach instead showed them green once their marks
    // were cleared for the restart (Al-Baqarah 145, a phrase of 144 said in
    // place of بكل ءاية ما تبعوا قبلتك). Red words before that point are
    // kept by freezing them, since the restart clears the working marks.
    const shownUpTo = frontRunStart(
      revealedWordCountRef.current,
      accumulatedWrongIndicesRef.current,
      revealedWrongRef.current
    );
    for (const index of accumulatedWrongIndicesRef.current) {
      if (index < shownUpTo && !stickyWrongIndicesRef.current.has(index)) {
        stickyWrongIndicesRef.current.add(index);
        stickyLetterDiffRef.current[index] = letterDiffRef.current[index] ?? null;
      }
    }
    keptRevealedRef.current = Math.max(keptRevealedRef.current, shownUpTo);

    commitFaultsRef.current = new Map();
    partialFaultsRef.current = new Map();
    applyMarks();

    // The matcher is back at the top of the ayah, so the next commit is a
    // fresh start rather than another commit that failed to move.
    prevMatchPosRef.current = 0;
    stalledCommitsRef.current = 0;
    setCanSkip(false);

    // Words already shown stay shown. They have been read, and pulling them
    // back off the page mid-recitation helps nobody.
  }, [applyMarks]);

  const onAyahComplete = useCallback(
    async (accumulatedText) => {
      try {
        setLiveText('');

        // ── Helper: advance to next ayah ─────────────────────────────────
        const advanceAyah = async ({ confirmedEntry, mistakeInsert = null }) => {
          const completedIndex = currentAyahIndexRef.current;
          const nextIndex = completedIndex + 1;

          // Append this ayah's words to the going-back detection list before
          // ayahDataRef is overwritten inside loadAyah.
          const completedNorm = normalizeArabic(ayahDataRef.current.textCompare ?? '');
          if (completedNorm) {
            confirmedAyahWordsRef.current = [
              ...confirmedAyahWordsRef.current,
              completedNorm.split(/\s+/).filter(Boolean),
            ];
          }

          // Freeze STT before state changes to prevent stale commits racing
          // against the ayahDataRef update inside loadAyah.
          resetUtterance({ discardMs: 30000 });

          // Reset all per-ayah tracking.
          accumulatedWrongIndicesRef.current = new Set();
          commitFaultsRef.current = new Map();
          partialFaultsRef.current = new Map();
          revealedWrongRef.current = new Set();
          lostAtRef.current = new Set();
          keptRevealedRef.current = 0;
          alertedIndicesRef.current = new Set();
          skippedRef.current = new Set();
          isGoingBackRef.current = false;
          prevMatchPosRef.current = 0;
          revealedWordCountRef.current = 0;
          letterDiffRef.current = {};
          stalledCommitsRef.current = 0;
          liveTextRef.current = '';
          stickyWrongIndicesRef.current = new Set();
          stickyLetterDiffRef.current = {};
          discardedAttemptsRef.current = '';

          // Synchronous state batch before any await.
          setRevealedWordCount(0);
          setCanSkip(false);
          setSkippedWordIndices([]);
          setLiveWrongIndices([]);
          setLiveLetterDiff({});
          currentAyahIndexRef.current = nextIndex;
          setCurrentAyahIndex(nextIndex);
          setCurrentAyahDisplay('');
          setConfirmedAyahs((prev) => [...prev, confirmedEntry]);

          // The last ayah is saved like every other one. It used to return
          // before the writes below, so the final ayah's mistakes were never
          // logged and last_confirmed_ayah always stopped one short.
          if (nextIndex >= totalAyahs) {
            setIsRevisionComplete(true);
            await stopListening();
            // A save that fails must not stop the recitation; the reciter has
            // already moved on. Reported, not shown.
            await saveCompletedAyah().catch((err) => reportHandledError('recitation.saveAyah', err));
            return;
          }

          // The next ayah is loaded and the freeze lifted before anything is
          // written to the database, not after.
          //
          // These two writes used to sit inside the freeze, so on a phone
          // network the app spent a round trip or two deaf to a reciter who
          // was already saying the next ayah. What they said in that time was
          // dropped, and the ayah was then marked wrong for missing the words
          // they had just recited. Nothing here needs to finish before the
          // reciter can carry on, so none of it is in their way any more.
          //
          // The trade is a millisecond-wide window where the app has moved on
          // but the database has not, so a crash in it costs one ayah of saved
          // progress. Re-reciting one ayah is a far smaller harm than being
          // marked wrong on every one of them.
          await loadAyah(nextIndex);
          recreateJudge();
          resumeListening();
          // A save that fails must not stop the recitation; the reciter has
          // already moved on. Reported, not shown.
          await saveCompletedAyah().catch((err) => reportHandledError('recitation.saveAyah', err));

          // Declared as a function so the last-ayah branch above can call it
          // before this point in the text.
          async function saveCompletedAyah() {
            if (mistakeInsert && sessionId) {
              const { userId, surahNumber, ayahNumber, tier, wrong_words, transcribed_text } =
                mistakeInsert;
              // mistakes.tier is NOT NULL with no default, so omitting it makes
              // every insert fail. The error used to be discarded here, which
              // silently starved the post-session quiz, the tier-2 count and the
              // juz gate for months. Surface it instead.
              const { error: mistakeError } = await supabase.from('mistakes').insert({
                user_id: userId,
                session_id: sessionId,
                surah_number: surahNumber,
                ayah_number: ayahNumber,
                tier,
                wrong_words,
                transcribed_text,
              });
              if (mistakeError) {
                console.error('[Recitation] failed to log mistake:', mistakeError.message);
              }
              // Deliberately no quiz_queue row here. The mistakes row above is
              // the record; the queue row is what puts an ayah into Mistake
              // Review, and it is not this screen's to write.
              //
              // Writing it here scheduled mistakes out of a session that might
              // never finish. Pause halfway and the queue row still fell due the
              // next morning, but the session summary, which is the only place a
              // misflag can be cleared, only ever resolves a completed session.
              // So the review window never opened and the app went on testing
              // someone on words it had misheard, with no way to say so.
              //
              // queueSessionMistakes() writes these rows instead, from the same
              // mistakes table, keyed by session. It runs when the finished
              // session is scored, after the summary screen's corrections, and
              // it picks up every mistake in the session including the ones
              // made before a pause.
              //
              // The trade: a session abandoned for good never schedules its
              // mistakes. That is the intended reading of an abandoned session,
              // and the mistakes rows still exist either way.
            }
            await supabase
              .from('sessions')
              // A juz offset, matching sessions.portion_start_ayah. It used to be
              // a surah-relative ayah number, so resuming a portion that crossed a
              // surah restarted it in the wrong place.
              .update({ last_confirmed_ayah: startOffset + completedIndex })
              .eq('id', sessionId);
          }
        };
        // ─────────────────────────────────────────────────────────────────

        // Disconnected letters (الم etc.) — always advance as correct.
        if (ayahDataRef.current.isDisconnectedLetters) {
          await advanceAyah({
            confirmedEntry: { textDisplay: ayahDataRef.current.textCompare, status: 'correct' },
          });
          return;
        }

        const { textDisplay, words } = ayahDataRef.current;

        // Final pass: process the complete ayah text without STABILITY_LAG so
        // substitutions in the last 1–2 words (e.g. حساب instead of عذاب) are
        // caught and their spoken form recorded in letterDiffRef for letter diff.
        // Must run before reading accumulatedWrongIndicesRef and letterDiffRef.
        //
        // Everything standing at this point was decided while the ayah was
        // still arriving, when a word said twice is indistinguishable from a
        // word said wrongly. Going back a few words to correct yourself
        // reliably produced a red word somewhere ahead of where you were, and
        // it was frozen on sight and never revisited, even though a second
        // later the alignment worked out what had happened and came up clean.
        //
        // So the live marks are cleared and the final pass over the whole ayah
        // decides. It is the only reading of the recitation made with all of it
        // in hand. What the reciter asked to be shown outright survives, having
        // never been a judgement in the first place.
        const frozenSlip = new Set(stickyWrongIndicesRef.current);
        const frozenSlipDiff = { ...stickyLetterDiffRef.current };

        isGoingBackRef.current = false;
        commitFaultsRef.current = new Map();
        partialFaultsRef.current = new Map();
        const unOverturnable = [
          ...revealedWrongRef.current,
          ...lostAtRef.current,
          ...skippedRef.current,
        ];
        stickyWrongIndicesRef.current = new Set(unOverturnable);
        stickyLetterDiffRef.current = Object.fromEntries(
          unOverturnable.map((index) => [index, null])
        );
        liveJudgeRef.current?.finalUpdate(dedupeConsecutiveWords(accumulatedText));

        // The ayah can finish correct and still have been got wrong on the way:
        // the reciter said the wrong word, or jumped one, heard it, and went
        // back to fix it. Reading only the final state would call that a clean
        // recitation, which for hifz it is not. A word that had to be caught
        // and repaired is exactly the word worth revising.
        //
        // A mark made live is kept unless the discarded words prove it was an
        // artefact of re-treading. It used to be the other way round: marks
        // were dropped unless a self-correction could be proved, and that
        // silently threw away the commonest case of all. The recogniser knows
        // the Qur'an, so a word heard wrong in the live guess is often tidied
        // to the expected one by the time it is confirmed. The final text then
        // reads as a flawless recitation, nothing was discarded, no
        // self-correction could be proved, and the mistake vanished from the
        // screen and from the mistakes table with it. Nothing recorded it, so
        // the quiz never asked about it.
        //
        // Both that case and an innocent re-tread answer "no" to "did they
        // slip?", which is why that question alone could not separate them.
        // The one that tells them apart is whether anything was discarded at
        // all: a straight-through recitation has nothing to blame a stray mark
        // on, while a re-tread has the repeat sitting right there.
        if (frozenSlip.size > 0) {
          const spokenNorm = normalizeArabic(accumulatedText ?? '');
          const { discarded, slipped } = describeExtraWords(
            getExpectedWords(),
            spokenNorm.split(/\s+/).filter(Boolean)
          );
          const wasPlainRetread = discarded && !slipped;
          if (!wasPlainRetread) {
            frozenSlip.forEach((index) => {
              stickyWrongIndicesRef.current.add(index);
              stickyLetterDiffRef.current[index] = frozenSlipDiff[index] ?? null;
            });
            applyMarks();
          }
        }

        const wrongIndices = [...accumulatedWrongIndicesRef.current].sort((a, b) => a - b);
        const letterDiffByIndex = wrongIndices.length > 0 ? { ...letterDiffRef.current } : undefined;

        const confirmedEntry = {
          textDisplay,
          status: 'correct',
          wrongIndices,
          letterDiffByIndex,
        };

        let mistakeInsert = null;
        if (wrongIndices.length > 0 && sessionId) {
          const userId = await getCurrentUserId();
          mistakeInsert = {
            userId,
            // Carries its own surah, because the portion may span several.
            ...locationAt(currentAyahIndexRef.current),
            wrong_words: wrongIndices.map((i) => words[i]?.textDisplay ?? ''),
            // Attempts abandoned by a restart are prepended, so the record
            // still shows the slip even though it was judged separately.
            transcribed_text: [discardedAttemptsRef.current, accumulatedText]
              .filter(Boolean)
              .join(' '),
          };
        }

        await advanceAyah({ confirmedEntry, mistakeInsert });
      } catch (err) {
        resumeListening();
        reportHandledError('recitation.ayahComplete', err);
        setError(err?.message ?? 'Failed to process ayah completion.');
      }
    },
    [applyMarks, getExpectedWords, loadAyah, recreateJudge, locationAt, startOffset, sessionId, totalAyahs]
  );

  /**
   * Gives up on the current ayah and moves on, counting it as a mistake.
   *
   * Only reachable once the recogniser has stalled, so this is not a way to
   * skip past anything inconvenient. The ayah is scored as if it were recited
   * wrongly: every word from the last confirmed match onwards is marked wrong,
   * a mistake row is written, and it is queued for review tomorrow. Words the
   * recogniser did match are left alone, so a stall on the final word does not
   * discard the rest of the ayah.
   *
   * Routed through onAyahComplete rather than reimplementing the advance,
   * because that path also freezes the recogniser, resets the judge and
   * restarts listening. Doing any of that by hand here would drift from it.
   */
  const skipCurrentAyah = useCallback(() => {
    const words = ayahDataRef.current?.words ?? [];
    if (words.length === 0) return;

    const from = Math.max(0, Math.min(prevMatchPosRef.current, words.length));
    for (let i = from; i < words.length; i += 1) {
      accumulatedWrongIndicesRef.current.add(i);
      // null means the word never came back at all, as opposed to coming back
      // misheard, which is exactly what happened here.
      letterDiffRef.current[i] = null;
    }

    setLiveWrongIndices([...accumulatedWrongIndicesRef.current]);
    setLiveLetterDiff({ ...letterDiffRef.current });
    revealedWordCountRef.current = words.length;
    setRevealedWordCount(words.length);

    onAyahComplete(liveTextRef.current);
  }, [onAyahComplete]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    recitationStartedAt.current = Date.now();

    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);

        if (resumeFromOffset > startOffset) {
          const { data: priorMistakes } = await supabase
            .from('mistakes')
            .select('surah_number, ayah_number, wrong_words')
            .eq('session_id', sessionId)
            .is('dismissed_at', null)
            .order('ayah_number', { ascending: true });

          // Keyed on surah *and* ayah. Keyed on ayah alone, a portion spanning
          // two surahs would let Al-Baqarah 5's mistake mark Ali Imran 5.
          const mistakesByAyah = {};
          for (const m of priorMistakes ?? []) {
            mistakesByAyah[`${m.surah_number}:${m.ayah_number}`] = m;
          }

          // Fetched in parallel batches. One at a time, resuming near the end
          // of a long portion meant well over a hundred round trips in a row
          // behind a spinner, which testers reported as loading forever.
          const priorOffsets = [];
          for (let offset = startOffset; offset < resumeFromOffset; offset++) {
            priorOffsets.push(offset);
          }
          const priorAyahs = [];
          for (let i = 0; i < priorOffsets.length; i += RESUME_FETCH_BATCH) {
            const batch = priorOffsets.slice(i, i + RESUME_FETCH_BATCH);
            const fetched = await Promise.all(
              batch.map((offset) => {
                const loc = getAyahLocation(juzNumber, offset);
                return getAyah(loc.surahNumber, loc.ayahNumber).then((data) => ({ loc, data }));
              })
            );
            if (!mounted) return;
            priorAyahs.push(...fetched);
          }

          const priorConfirmed = [];
          for (const { loc, data } of priorAyahs) {
            const mistake = mistakesByAyah[`${loc.surahNumber}:${loc.ayahNumber}`];
            let wrongIndices = [];
            if (mistake?.wrong_words?.length) {
              wrongIndices = mistake.wrong_words
                .map((w) => data.words.findIndex((word) => word.textDisplay === w))
                .filter((i) => i >= 0);
            }
            priorConfirmed.push({
              textDisplay: data.isDisconnectedLetters ? data.textCompare : data.textDisplay,
              status: 'correct',
              wrongIndices,
            });
          }

          if (mounted) {
            setConfirmedAyahs(priorConfirmed);
            // Pre-populate going-back detection with all resumed ayahs.
            confirmedAyahWordsRef.current = priorConfirmed.map((a) => {
              const norm = normalizeArabic(a.textDisplay ?? '');
              return norm ? norm.split(/\s+/).filter(Boolean) : [];
            });
          }

          // Seed the swipeable page list with the pages recited in the earlier
          // sitting. allPages is otherwise built only as the reciter advances,
          // so someone resuming opened on the page they stopped at with nothing
          // behind it: the ayahs they had already recited were restored into
          // confirmedAyahs and rendered, but there was no page to swipe back to
          // and see them on. Resuming the next day made a session look as
          // though it had started at the middle of the portion.
          //
          // Mushaf pages run in order and a portion is a contiguous run of
          // ayahs, so every page between the portion's first ayah and the one
          // being resumed at was visited. That makes this two lookups rather
          // than one per ayah already recited.
          const firstLoc = getAyahLocation(juzNumber, startOffset);
          const resumeLoc = getAyahLocation(juzNumber, resumeFromOffset);
          const [firstPage, resumePage] = await Promise.all([
            getPageForAyah(db, firstLoc.surahNumber, firstLoc.ayahNumber),
            getPageForAyah(db, resumeLoc.surahNumber, resumeLoc.ayahNumber),
          ]);
          if (mounted && firstPage != null && resumePage != null) {
            const priorPages = [];
            for (let p = firstPage; p <= resumePage; p++) priorPages.push(p);
            // The page effect fires on mount with the resumed ayah, so the
            // current page may already be in the list. Prepend around whatever
            // is there rather than replacing it, and keep the current page last
            // so the auto-scroll still lands on it.
            setAllPages((prev) => [
              ...priorPages,
              ...prev.filter((p) => !priorPages.includes(p)),
            ]);
          }
        }

        await loadAyah(initialAyahIndex);
        if (!mounted) return;
        recreateJudge();

        // Listening is no longer started here. The microphone is a button
        // now, so the portion loads and is readable first and the stream
        // only opens once someone taps. Kept as its own effect below
        // rather than inlined, so the connection logic still exists once.
      } catch (err) {
        if (mounted) {
          reportHandledError('recitation.startSession', err);
          setError(err.message ?? 'Failed to start recitation session.');
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
      startedRef.current = false;
    };
  }, [
    loadAyah,
    getExpectedWords,
    onAyahComplete,
    recreateJudge,
    initialAyahIndex,
    resumeFromOffset,
    startOffset,
    juzNumber,
    db,
  ]);

  /**
   * Open the microphone, once someone has asked for it.
   *
   * This used to run at the tail of the setup effect, so the stream opened the
   * moment the screen appeared: the app was already listening while the bottom
   * of the screen told you to start reciting, and a Speechmatics connection was
   * paid for whether or not anyone spoke. It now waits for the mic button.
   *
   * listenAttempt moved here with it. Bumping it is still how the microphone is
   * reopened after it closes itself, and re-running this effect is a smaller
   * thing to redo than the whole portion load.
   */
  useEffect(() => {
    if (!hasStarted || isLoading || error) return;

    let mounted = true;
    // Every run of this effect opens the microphone again, so the claim starts
    // false again with it.
    setMicReady(false);

    (async () => {
      try {
      await startListening({
        // Part-way through an ayah, so this is someone carrying on rather than
        // beginning. Read from what is on the page rather than from a record of
        // when the microphone was last opened, because that record would still
        // name the ayah it was opened on however many have been finished since.
        // On a fresh session nothing is revealed yet, which is the same
        // question asked of a different moment, and it answers correctly.
        preserveProgress: revealedWordCountRef.current > 0,
        getExpectedWords,
        onAyahComplete,
        // Committed words are dropped rather than judged while the reciter is
        // back on an earlier ayah. Without this the position held but the
        // marks did not: words from the old ayah were still aligned against
        // the current one, and what that produced was written into its record.
        isGoingBack: (text) => {
          // Going back into an earlier ayah no longer counts towards "Not
          // hearing you? Skip this ayah". It used to, so the way out would
          // still appear if the current ayah were being misheard as an earlier
          // one; in practice it appeared on every deliberate look back, and
          // the author asked for it to go. Pause remains the way out.
          return isGoingBackRef.current || checkGoingBack(text);
        },
        onPartial: (text, partialText) => {
          // Asked about what they are saying now, not the running text.
          //
          // `text` carries every word already committed for this ayah in front
          // of the partial, so it always contains the current ayah, and the
          // tie-break inside checkGoingBack would answer "this is the ayah
          // they are on" every single time and never see a look back at all.
          // The raw partial is the only part that says where they actually
          // are.
          if (checkGoingBack(partialText ?? text)) return;
          // Going-back window ended — user is speaking current ayah again.
          isGoingBackRef.current = false;

          // Only look for a restart once something has already gone wrong on
          // this ayah. An ayah that repeats its own opening would otherwise
          // look like a restart in the middle of a flawless recitation.
          if (accumulatedWrongIndicesRef.current.size > 0) {
            const spoken = normalizeArabic(text).split(/\s+/).filter(Boolean);
            const restartAt = findAyahRestart(spoken, getExpectedWords());
            if (restartAt > 0) {
              handleAyahRestart(restartAt);
              // This update still carries the abandoned attempt in front of the
              // new one. The next partial arrives without it.
              const retry = spoken.slice(restartAt).join(' ');
              liveJudgeRef.current?.update(dedupeConsecutiveWords(retry));
              liveTextRef.current = retry;
              setLiveText(retry);
              return;
            }
          }

          liveJudgeRef.current?.update(dedupeConsecutiveWords(text));
          liveTextRef.current = text;
          setLiveText(text);
        },
        onCommit: (matchedCount, statuses = [], commitText = '') => {
          const prev = prevMatchPosRef.current;
          prevMatchPosRef.current = matchedCount;

          // The aligner names every word it was unhappy with, and says whether
          // it was said wrong or not said at all. Mistakes used to be read off
          // the size of the position jump instead, which could not tell a
          // genuine skip from several correct words arriving in one commit: a
          // three-word commit opening an ayah moved the position 0 → 3 and
          // painted the first two words red on a clean recitation.
          //
          // Replaced whole rather than added to, and re-synced on every commit
          // rather than only on the ones that advance, so a slot the aligner
          // reconsiders gives its mark back as soon as it changes its mind.
          // Skips are remembered once the reciter has carried on at least two
          // words past them; see skippedRef. Named on sight, a single word
          // that also occurs further on in the ayah briefly read as a jump to
          // it, and the words in between were locked in as skipped although
          // the next words showed the reciter had not moved.
          const correctAfter = (index) =>
            statuses.filter((e) => e.index > index && e.status === 'correct').length;
          for (const entry of statuses) {
            if (
              entry.status === 'missing' &&
              !skippedRef.current.has(entry.index) &&
              correctAfter(entry.index) >= 2
            ) {
              skippedRef.current.add(entry.index);
              stickyWrongIndicesRef.current.add(entry.index);
              stickyLetterDiffRef.current[entry.index] = null;
            }
          }

          const before = commitFaultsRef.current;
          commitFaultsRef.current = new Map(
            statuses
              .filter((entry) => entry.status !== 'correct')
              .map(({ index, spoken }) => [index, spoken ?? null])
          );
          applyMarks();

          // Once per newly faulted word, rather than once per commit, and never
          // again for a word already standing red.
          const isNewFault = [...commitFaultsRef.current.keys()].some(
            (index) => !before.has(index)
          );
          if (isNewFault) alertMistake();

          syncRevealed();

          if (matchedCount > prev) {
            // matchPos advanced — user is on current ayah.
            isGoingBackRef.current = false;

            // Progress, so nobody is stuck. Withdraw the offer if it was out.
            stalledCommitsRef.current = 0;
            setCanSkip(false);
          } else {
            // A commit that moved nothing. One is normal, a few in a row means
            // the recogniser is not going to produce this ayah on its own.
            //
            // Unless every word in it belongs to this ayah, or there are no
            // words at all. Going back over the ayah moves nothing forward
            // either, and pausing now sends only punctuation, which is no
            // words. Both were counted, and going back then pausing put up
            // "Not hearing you?" on a reciter who was being heard perfectly.
            const heard = normalizeArabic(commitText ?? '').split(/\s+/).filter(Boolean);
            const ayahWords = new Set(getExpectedWords().flatMap((word) => word.split(' ')));
            const onlyThisAyah = heard.every((word) => ayahWords.has(word));
            if (!onlyThisAyah) stalledCommitsRef.current += 1;
            if (stalledCommitsRef.current >= STALLED_COMMITS_BEFORE_SKIP) {
              setCanSkip(true);
            }
          }
        },
        onError: (message) => {
          reportHandledError('recitation.transcription', message);
          if (mounted) setError(message);
        },
        onAutoStop: (reason) => {
          if (mounted) {
            setMicReady(false);
            setMicClosedReason(reason);
          }
        },
      });
      // startListening resolves only once the microphone is open, the token is
      // in hand, the socket is up and the audio held during setup has been
      // sent. Said another way: this is the first moment the app is not merely
      // hearing the reciter but transcribing them. That is what the button is
      // claiming when it turns orange, so it is claimed here and nowhere
      // earlier. Anything said before it is buffered and arrives, so waiting
      // for the colour costs a reciter nothing.
      if (mounted) setMicReady(true);
      } catch (err) {
        // The screen turned the microphone off, or started again, before this
        // attempt finished. Nothing failed and nobody is waiting on it, so it
        // is neither an error to show nor one to report.
        if (err instanceof ListeningCancelled) return;
        reportHandledError('recitation.startListening', err, {
          // The reason the recorder actually had, which its own error
          // message throws away. Without it every cause looks the same.
          nativeReason: err?.nativeReason ?? null,
          cause: err?.cause?.message ?? null,
        });
        if (mounted) setError(err.message ?? 'Could not start listening.');
      }
    })();

    return () => {
      mounted = false;
      setMicReady(false);
      stopListening();
    };
  }, [
    hasStarted,
    isLoading,
    error,
    listenAttempt,
    checkGoingBack,
    getExpectedWords,
    onAyahComplete,
    handleAyahRestart,
    alertMistake,
    syncRevealed,
  ]);

  useEffect(() => {
    currentAyahIndexRef.current = currentAyahIndex;
  }, [currentAyahIndex]);

  useEffect(() => {
    if (isLoading || error) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isLoading, error, pulseAnim]);

  const handlePauseSession = async () => {
    // Banked here too, or the whole first sitting is lost: this is the exit
    // people actually take mid-portion.
    await bankRecitationSeconds();
    if (sessionId) {
      await supabase
        .from('sessions')
        .update({ status: 'paused' })
        .eq('id', sessionId);
    }
    await stopListening();
    navigation.navigate('Today');
  };

  const [currentPage, setCurrentPage] = useState(null);
  // The page actually on screen. Pages already visited can be swiped back to,
  // and a badge that kept reporting the recitation position would name a page
  // the reader is not looking at.
  const [visiblePage, setVisiblePage] = useState(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const handleViewableChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) setVisiblePage(viewableItems[0].item);
  }).current;

  useEffect(() => {
    let mounted = true;
    const loc = locationAt(Math.min(currentAyahIndex, totalAyahs - 1));
    getPageForAyah(db, loc.surahNumber, loc.ayahNumber)
      .then((page) => {
        if (!mounted || page == null) return;
        setCurrentPage(page);
        setVisiblePage((prev) => prev ?? page);
        setAllPages((prev) => {
          if (prev[prev.length - 1] === page) return prev;
          return [...prev, page];
        });
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [db, locationAt, currentAyahIndex, totalAyahs]);

  // Auto-advance to the latest page whenever allPages grows.
  // useEffect runs after render so the FlatList layout is ready.
  useEffect(() => {
    if (allPages.length === 0) return;
    pageListRef.current?.scrollToIndex({
      index: allPages.length - 1,
      animated: true,
    });
  }, [allPages.length]);

  const ayahStatuses = useMemo(() => {
    const map = {};
    confirmedAyahs.forEach((ayah, index) => {
      const loc = locationAt(index);
      map[`${loc.surahNumber}:${loc.ayahNumber}`] = {
        wrongIndices: ayah.wrongIndices ?? [],
        letterDiffByIndex: ayah.letterDiffByIndex,
      };
    });
    // Once the last ayah is recited the index sits one past the portion, and
    // there is no current ayah to mark. Looking it up anyway named the next
    // portion's first ayah, which was harmless, until a portion ended on the
    // last ayah of its juz: then there is no next ayah, the lookup threw, and
    // the screen crashed at the very moment the juz was finished. That was the
    // "stuck at the end" both September testers hit, on juz 1's ayah 148.
    if (currentAyahIndex >= totalAyahs) return map;
    const cur = locationAt(currentAyahIndex);
    const currentKey = `${cur.surahNumber}:${cur.ayahNumber}`;
    if (!map[currentKey]) {
      if (revealedWordCount > 0) {
        // Lost, not slipped. One wrong word is shown in red. Two or more in a
        // row at the front means the reciter has lost their place, and every
        // word revealed past that point is a guess at what they meant, painted
        // red. So the run is hidden again and its first word becomes a blank
        // with a red underline: "you are stuck here". Nothing about the
        // judging changes. Once a correct word arrives after the run it is no
        // longer at the front, and the run shows in red with the recovered
        // words in green after it. Usually both wrong words arrive in one
        // commit, so the first is never seen in red before it disappears.
        // A word asked for with Reveal is always shown, in red. It counts as a
        // mistake, so without that stop it was taken for a slip at the front
        // and hidden under the underline it was meant to answer.
        const runStart = frontRunStart(
          revealedWordCount,
          new Set(liveWrongIndices),
          revealedWrongRef.current
        );
        // Any wrong word at the front, even one. Shown red the moment it
        // arrived, a slip then flashed and disappeared as the next wrong word
        // came in, which on a phone, where words commit one at a time, was
        // every time. It turns red once a correct word follows it.
        const lost = revealedWordCount - runStart >= 1;
        map[currentKey] = {
          revealedCount: lost ? runStart : revealedWordCount,
          stuckAtIndex: lost ? runStart : null,
          liveWrongIndices,
          skippedWordIndices,
          letterDiffByIndex: liveLetterDiff,
        };
      } else if (currentAyahIndex === initialAyahIndex) {
        // The first ayah of this sitting, greyed as a prompt. It used to be
        // the first ayah of the portion and nothing else, so anyone resuming
        // after a pause arrived at a blank page: the ayahs already recited sat
        // behind them in black and the one they were meant to continue with
        // showed nothing at all. Resuming mid-portion is the moment a person
        // is least likely to remember where they were, which makes it the
        // worst one to give no prompt.
        //
        // Someone interrupted in the middle of an ayah resumes at the top of
        // it, because an ayah only counts once it is finished, so the whole
        // ayah is the right thing to show either way.
        map[currentKey] = { wrongIndices: [], cue: true };
      }
      // ayahs after the first stay hidden until the user starts reciting them
    }
    return map;
  }, [
    confirmedAyahs,
    locationAt,
    currentAyahIndex,
    initialAyahIndex,
    liveWrongIndices,
    liveLetterDiff,
    revealedWordCount,
    skippedWordIndices,
    totalAyahs,
  ]);

  // Remembers where the reciter got lost, so that word stays red after they
  // recover. Same test as the display rule in ayahStatuses above.
  //
  // Only the first word of the run is kept. A slip freezes every wrong mark
  // standing at that moment (onMistake), which for a lost run would freeze the
  // words after it too, and they would stay red after a clean recovery. They
  // are guesses at what was meant, not mistakes, so they are unfrozen and the
  // judge decides them afresh: green when recited, red when skipped over.
  //
  // Committed words only. The live partial is the recogniser's first guess and
  // is often tidied a moment later; a two-word misreading there, recorded
  // here, became a permanent red word and a saved mistake for a recitation
  // the committed words show was correct. The underline itself still follows
  // the live reading, so it appears as fast as before.
  useEffect(() => {
    const committedWrong = new Set(commitFaultsRef.current.keys());
    let frontier = prevMatchPosRef.current;
    for (const index of committedWrong) frontier = Math.max(frontier, index + 1);
    const runStart = frontRunStart(frontier, committedWrong, revealedWrongRef.current);
    if (frontier - runStart < 2) return;
    let changed = false;
    if (!lostAtRef.current.has(runStart)) {
      lostAtRef.current.add(runStart);
      stickyWrongIndicesRef.current.add(runStart);
      stickyLetterDiffRef.current[runStart] = null;
      changed = true;
    }
    for (let i = runStart + 1; i < frontier; i += 1) {
      if (
        stickyWrongIndicesRef.current.has(i) &&
        !revealedWrongRef.current.has(i) &&
        !lostAtRef.current.has(i) &&
        !skippedRef.current.has(i)
      ) {
        stickyWrongIndicesRef.current.delete(i);
        delete stickyLetterDiffRef.current[i];
        changed = true;
      }
    }
    if (changed) applyMarks();
  }, [revealedWordCount, liveWrongIndices, applyMarks]);

  const displayAyahNumber = Math.min(currentAyahIndex + 1, totalAyahs);
  const isListening = hasStarted && micReady && !isLoading && !error && !showTransition && !isRevisionComplete;

  // "Al-Baqarah 142-252", or "Al-Baqarah 282 to Ali Imran 83" when the portion
  // spans two surahs, which most portions in most juz do.
  const portionLabel = useMemo(() => {
    try {
      const a = getAyahLocation(juzNumber, startOffset);
      const b = getAyahLocation(juzNumber, endOffset);
      return a.surahNumber === b.surahNumber
        ? `${a.surahName} ${a.ayahNumber}\u2013${b.ayahNumber}`
        : `${a.surahName} ${a.ayahNumber} to ${b.surahName} ${b.ayahNumber}`;
    } catch {
      return '';
    }
  }, [juzNumber, startOffset, endOffset]);

  if (showTransition) {
    return (
      <Animated.View style={[styles.transitionOverlay, { opacity: fadeAnim }]}>
        <Text style={styles.transitionText}>Revision complete</Text>
      </Animated.View>
    );
  }

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.header}>
        <Text style={styles.headerMode}>Recitation Portion</Text>
        <Text style={styles.headerSub}>{portionLabel}</Text>
        <Text style={styles.pageBadge}>{visiblePage != null ? `pg ${visiblePage}` : ''}</Text>
      </View>

      {micClosedReason ? (
        <TouchableOpacity
          style={styles.micPaused}
          onPress={resumeAfterAutoStop}
          activeOpacity={0.85}
        >
          <Text style={styles.micPausedTitle}>Listening paused</Text>
          <Text style={styles.micPausedBody}>
            {micClosedReason === 'ceiling'
              ? 'That has been a long sitting. Tap to carry on.'
              : 'The microphone turned itself off after two quiet minutes. Tap to carry on.'}
          </Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.progressTrack}>
        <View
          style={[styles.progressFill, { width: `${(currentAyahIndex / totalAyahs) * 100}%` }]}
        />
      </View>

      <FlatList
        ref={pageListRef}
        style={styles.mushafArea}
        data={allPages}
        horizontal
        inverted
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => String(item)}
        getItemLayout={(_, index) => ({
          length: screenWidth,
          offset: screenWidth * index,
          index,
        })}
        onViewableItemsChanged={handleViewableChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item: pageNum }) => (
          <View style={{ width: screenWidth, flex: 1 }}>
            <MushafPage pageNumber={pageNum} ayahStatuses={ayahStatuses} />
          </View>
        )}
      />

      {isRevisionComplete ? (
        <View style={styles.feedbackPanel}>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => finishRevisionRef.current?.()}
            activeOpacity={0.85}
          >
            <Text style={styles.doneBtnText}>Done, see summary</Text>
          </TouchableOpacity>
        </View>
      ) : canSkip ? (
        <View style={styles.feedbackPanel}>
          <Text style={styles.stuckHint}>
            Not hearing you? You can move on and review this ayah later.
          </Text>
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={skipCurrentAyah}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Skip this ayah and count it as a mistake"
          >
            <Text style={styles.skipBtnText}>Skip this ayah</Text>
          </TouchableOpacity>
        </View>
      ) : !hasStarted
        || (currentAyahIndex === initialAyahIndex && revealedWordCount === 0) ? (
        <View style={styles.feedbackPanel}>
          {!hasStarted ? (
            <Text style={styles.reciteHint}>Tap the mic to start reciting</Text>
          ) : !micReady ? (
            <Text style={styles.reciteHint}>Opening the microphone, one moment</Text>
          ) : resumeFromOffset > startOffset ? (
            /* The ayah to continue from is greyed in, the same prompt a fresh
               session gets, and the ayahs already recited sit behind it in
               black. This says which of the two to read. */
            <Text style={styles.reciteHint}>Recite from where you left off</Text>
          ) : (
            <Text style={styles.reciteHint}>Recite from the gray portion</Text>
          )}
        </View>
      ) : null}

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.pauseBtn, isLoading && styles.pauseBtnDisabled]}
          onPress={handlePauseSession}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          <Text style={styles.pauseBtnText}>✕ Pause</Text>
        </TouchableOpacity>

        <View style={styles.micArea}>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <TouchableOpacity
              onPress={() => setHasStarted((wasStarted) => !wasStarted)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: hasStarted }}
              accessibilityLabel={hasStarted ? 'Stop listening' : 'Start reciting'}
            >
              <View style={styles.micWrap}>
                <Animated.View
                  style={[
                    styles.micRing,
                    isListening && styles.micRingLive,
                    { opacity: isListening ? pulseAnim : 0.15, transform: [{ scale: isListening ? pulseAnim : 1 }] },
                  ]}
                />
                <View style={[styles.micCircle, isListening && styles.micCircleLive]}>
                  <Text style={styles.micEmoji}>🎙</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
          {/* Under the microphone it is labelling, and the slot is held open
              either way so the bar does not change height as it toggles. It
              appears only once the microphone is actually open; until then the
              hint above says it is opening. */}
          <Text style={[styles.micLabel, !isListening && styles.micLabelOff]}>Listening</Text>
        </View>

        <TouchableOpacity
          style={styles.revealBtn}
          onPress={revealNextWord}
          activeOpacity={0.8}
        >
          <Text style={styles.revealBtnText}>Reveal</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: 56,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  // Sits against the header's right edge, absolutely so the centred title
  // stays centred. Western digits: the Arabic-Indic number at the foot of the
  // page was decoration, this is a reference someone reads against a physical
  // mushaf.
  pageBadge: {
    position: 'absolute',
    right: 16,
    top: 2,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textMuted,
  },
  headerMode: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: colors.text,
  },
  micPaused: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: '#E6EFF9',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  micPausedTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.primary,
    marginBottom: 3,
  },
  micPausedBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMid,
  },
  headerSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  headerProgress: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.accent,
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.07)',
    marginHorizontal: 16,
    borderRadius: 2,
    marginBottom: 6,
  },
  progressFill: {
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  error: {
    color: colors.error,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  mushafArea: {
    flex: 1,
  },
  feedbackPanel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  doneBtn: {
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: {
    fontFamily: fonts.semiBold,
    color: colors.white,
    fontSize: 16,
  },
  pageNumber: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  reciteHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  stuckHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingBottom: 8,
  },
  skipBtn: {
    alignSelf: 'center',
    backgroundColor: colors.goldLight,
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  skipBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: colors.brown,
  },
  transitionOverlay: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  transitionText: {
    fontFamily: fonts.semiBold,
    fontSize: 32,
    color: colors.success,
    textAlign: 'center',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
  micArea: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  micWrap: { alignItems: 'center', justifyContent: 'center', width: 48, height: 48 },
  micLabel: {
    fontFamily: fonts.medium, fontSize: 11, color: colors.accent, marginTop: 2,
  },
  micLabelOff: { opacity: 0 },
  micRing: {
    position: 'absolute', width: 42, height: 42,
    borderRadius: 21, backgroundColor: colors.primaryDim,
  },
  micRingLive: { backgroundColor: colors.accentLight },
  // Blue is the resting control, the same blue as every other thing on the
  // screen that is waiting to be pressed. Orange means the app is listening and
  // transcribing, which is the one state worth spending the accent colour on:
  // pressing it again closes it and the blue comes back.
  //
  // It used to turn orange on the tap, which is a second or two before any of
  // that is true and, when the microphone could not be opened at all, never
  // became true. The button sat orange over an error message saying the
  // microphone could not be reached. Orange is now the live session itself, so
  // a start that fails leaves the button blue, where it belongs.
  micCircle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  micCircleLive: {
    backgroundColor: colors.accent,
  },
  micEmoji: { fontSize: 16 },
  revealBtn: {
    backgroundColor: colors.goldLight,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  revealBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: colors.brown,
  },
  progress: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.accent,
    textAlign: 'right',
  },
  pauseBtn: {
    backgroundColor: 'rgba(6,21,44,0.07)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  pauseBtnDisabled: {
    opacity: 0.5,
  },
  pauseBtnText: {
    fontFamily: fonts.medium,
    color: colors.textMid,
    fontSize: 13,
  },
});
