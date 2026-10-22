import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { expectedWordsFrom, normalizeArabic, wordDiff } from '../lib/arabicUtils';
import { getCurrentUserId } from '../lib/auth';
import { getSurahName } from '../lib/juzSurahMap';
import { createLiveJudge, findAyahRestart, hasSelfCorrectedSlip } from '../lib/liveWordJudge';
import {
  countAnsweredToday,
  fetchDueQuizItems,
  groupQuizRuns,
  flagContextAyahIfNeeded,
  updateQuizResult,
} from '../lib/quizEngine';
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
import { useSQLiteContext } from 'expo-sqlite';
import MushafPage from '../components/MushafPage';
import { getPageForAyah } from '../lib/mushafDb';
import { reportHandledError } from '../lib/sentry';
import { colors, fonts, radius, spacing } from '../lib/theme';

function dedupeConsecutiveWords(text) {
  if (!text) return text;
  const words = normalizeArabic(text).split(/\s+/).filter(Boolean);
  return words.filter((w, i) => i === 0 || w !== words[i - 1]).join(' ');
}

/**
 * The due questions as the runs they are recited in (see groupQuizRuns), with
 * each run cut off at the real end of its surah.
 *
 * @returns {Promise<{ items: object[], runs: { surah: number, start: number, end: number, first: number, count: number }[] }>}
 *   the items in the order they will be asked, and each run's range and slice of them
 */
async function buildRuns(items) {
  const ordered = [];
  const runs = [];
  for (const group of groupQuizRuns(items)) {
    let { end } = group;
    try {
      await getAyah(group.surah, end);
    } catch {
      end -= 1;
    }
    runs.push({ surah: group.surah, start: group.start, end, first: ordered.length, count: group.items.length });
    ordered.push(...group.items);
  }
  return { items: ordered, runs };
}

async function loadContextBlock(surahNumber, start, end) {
  const block = [];
  for (let n = start; n <= end; n++) {
    const data = await getAyah(surahNumber, n);
    block.push({ ayahNumber: n, ...data });
  }
  return block;
}

/**
 * Consecutive commits that fail to move matchPos before we offer a way out.
 *
 * The recogniser sometimes cannot produce a word however carefully it is
 * recited. When that happens nothing matches, the ayah never completes, and
 * reciting on only produces more misses against an ayah already left behind.
 * Without this the only escape is to pause the session and resume it.
 *
 * Three is roughly five to ten seconds of speech: long enough that someone
 * pausing to think never sees it, short enough to arrive before they conclude
 * the app is broken. Kept in step with the same constant in RecitationScreen.
 */
const STALLED_COMMITS_BEFORE_SKIP = 3;

export default function PreSessionQuizScreen(props) {
  const navigation = useNavigation();
  const db = useSQLiteContext();
  const sessionParams = props.route?.params ?? {};
  const { sessionId, juzNumber: sessionJuzNumber = 1, sessionType = 'revision' } = sessionParams;
  const isQuizOnly = sessionType === 'quiz_only';

  const [quizItems, setQuizItems] = useState([]);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  // Questions already answered earlier today, before a pause. Answering one
  // moves it off today's due list, so coming back refetched only what was left
  // and the count started again at Q 1. Added to the numbering so it carries on.
  const [answeredBefore, setAnsweredBefore] = useState(0);
  const [confirmedAyahs, setConfirmedAyahs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  // Nothing listens until the mic is tapped. It used to open itself on
  // arrival, so the screen asked people to recite while already recording.
  const [hasStarted, setHasStarted] = useState(false);
  // Orange on the microphone means the app is transcribing, not that the
  // button was pressed. Set only once startListening has resolved, which is
  // after the socket is up, so a start that fails leaves the button blue.
  const [micReady, setMicReady] = useState(false);
  // Why the microphone closed itself ('silence' or 'ceiling'), the same as the
  // portion. The review never listened for this, so after two quiet minutes
  // the mic stayed orange with nothing behind it. Null while listening.
  const [micClosedReason, setMicClosedReason] = useState(null);
  // Bumped to reopen the microphone after it closed itself, by re-running the
  // effect that opened it.
  const [listenAttempt, setListenAttempt] = useState(0);
  const resumeAfterAutoStop = useCallback(() => {
    setMicClosedReason(null);
    setListenAttempt((n) => n + 1);
  }, []);
  const [error, setError] = useState('');
  const [showTransition, setShowTransition] = useState(false);
  // A question has been finished and the next is waiting on the button. The
  // review used to move on by itself after four seconds of "Next question",
  // with the microphone still open, so the next question started listening
  // before anyone had looked at it.
  // 'next' between questions, 'finish' after the last one, null while reciting.
  const [awaitingNextQuestion, setAwaitingNextQuestion] = useState(null);

  const blockAyahsRef = useRef([]);
  // The runs questions are recited in (see buildRuns), and which one is on.
  const runsRef = useRef([]);
  const currentRunIndexRef = useRef(0);
  // Block index of each ayah being tested in the current run → its item index.
  // A run of joined questions has several.
  const targetsRef = useRef(new Map());
  // Item index → { result, detail } for the targets recited so far this run.
  const targetResultsRef = useRef(new Map());
  const ayahDataRef = useRef({ textDisplay: '', textCompare: '', words: [], isDisconnectedLetters: false });
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const currentBlockIndexRef = useRef(0);
  const currentItemIndexRef = useRef(0);
  const wrongIndicesRef = useRef([]);
  const [mistakeMessage, setMistakeMessage] = useState('');
  // Clears the mistake text after 3 s, cancelled when the ayah changes.
  const mistakeMessageTimeoutRef = useRef(null);
  // True once the recogniser has stalled long enough to offer a way past.
  const [canSkip, setCanSkip] = useState(false);
  const startedRef = useRef(false);
  const onAyahCompleteRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Live word-reveal state (mirrors RecitationScreen)
  const [revealedWordCount, setRevealedWordCount] = useState(0);
  const [liveWrongIndices, setLiveWrongIndices] = useState([]);
  const [liveLetterDiff, setLiveLetterDiff] = useState({});
  const accumulatedWrongIndicesRef = useRef(new Set());
  const prevMatchPosRef = useRef(0);
  const revealedWordCountRef = useRef(0);
  const letterDiffRef = useRef({});
  const liveJudgeRef = useRef(null);
  // Consecutive commits that did not move matchPos forward.
  const stalledCommitsRef = useRef(0);
  // Wrong words a restart of this ayah must not erase: the slip that sent the
  // reciter back to the top, plus anything Reveal or skip detection put there.
  // Everything else standing at that moment came from aligning an abandoned
  // half-attempt against the whole ayah, and was never really recited wrong.
  // Marks are held as what each source currently believes, not as a running
  // tally. The old set was add-only, so the first moment a word was doubted was
  // final: going back a few words to correct yourself makes the judge briefly
  // read the repeat as a later word said wrongly, and that guess could never be
  // taken back even though the very next update knew better.
  const commitFaultsRef = useRef(new Map());
  const partialFaultsRef = useRef(new Map());
  // Words asked for outright. The one kind of mark no re-solve may overturn,
  // because it was never a judgement about the recitation.
  const revealedWrongRef = useRef(new Set());
  const stickyWrongIndicesRef = useRef(new Set());
  const stickyLetterDiffRef = useRef({});
  // True from a restart until the next commit lands, so the words re-covered
  // in one breath are not read as a jump over words that were skipped.
  const justRestartedRef = useRef(false);
  // Guards skipCurrentAyah against a second press while the first is still
  // in flight. It awaits updateQuizResult before the transition screen
  // mounts, and the skip button is still on screen for that whole round trip.
  const isSkippingRef = useRef(false);

  const currentItem = quizItems[currentItemIndex];
  const blockLength = blockAyahsRef.current.length;

  // On a quiz-only day the quiz *is* the day. There is no portion to recite and
  // no recap of one, so finishing here finishes the session. Previously every
  // path from this screen led into recitation, which is how a day the app had
  // called "Quiz only" ended up walking people through Al-Fatihah 1 and then
  // rebooking a juz they had already completed.
  const finishQuizOnlyDay = useCallback(async () => {
    await stopListening();
    if (sessionParams.sessionId) {
      await supabase
        .from('sessions')
        .update({
          phase: 'complete',
          status: 'complete',
          completed_at: new Date().toISOString(),
        })
        .eq('id', sessionParams.sessionId);
    }
    navigation.navigate('Today');
  }, [navigation, sessionParams.sessionId]);

  const navigateToRecitation = useCallback(async () => {
    if (isQuizOnly) {
      await finishQuizOnlyDay();
      return;
    }
    if (sessionParams.sessionId) {
      await supabase.from('sessions').update({ phase: 'revision' }).eq('id', sessionParams.sessionId);
    }
    navigation.replace('Recitation', sessionParams);
  }, [navigation, sessionParams, isQuizOnly, finishQuizOnlyDay]);

  const finishAllQuizItems = useCallback(async () => {
    if (isQuizOnly) {
      await finishQuizOnlyDay();
      return;
    }
    await stopListening();
    if (sessionParams.sessionId) {
      await supabase.from('sessions').update({ phase: 'revision' }).eq('id', sessionParams.sessionId);
    }
    setShowTransition(true);
    Animated.timing(fadeAnim, { toValue: 1, duration: 1500, useNativeDriver: true }).start();
    setTimeout(() => { navigation.replace('Recitation', sessionParams); }, 4500);
  }, [fadeAnim, navigation, sessionParams, isQuizOnly, finishQuizOnlyDay]);

  const buzzAndTone = useCallback(async () => {
    try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
    try {
      const { sound } = await Audio.Sound.createAsync(require('../assets/mistake.m4a'));
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((s) => { if (s.didJustFinish) sound.unloadAsync(); });
    } catch (e) { console.log('Sound error:', e); }
  }, []);

  /**
   * Rebuilds what is shown from what each source currently believes, plus the
   * marks that are not up for revision.
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
    // Refs first, synchronously, so onAyahComplete reads the final marks
    // without waiting on React to flush the state below.
    accumulatedWrongIndicesRef.current = next;
    letterDiffRef.current = diff;
    setLiveWrongIndices([...next]);
    setLiveLetterDiff(diff);
    return next;
  }, []);

  const revealNextWord = useCallback(() => {
    const wordIndex = revealedWordCountRef.current;
    const words = ayahDataRef.current?.words;
    if (!words || wordIndex >= words.length) return;
    // Asked for outright, so neither a restart nor a later re-solve takes it back.
    revealedWrongRef.current.add(wordIndex);
    stickyWrongIndicesRef.current.add(wordIndex);
    stickyLetterDiffRef.current[wordIndex] = null;
    applyMarks();
    revealedWordCountRef.current = wordIndex + 1;
    setRevealedWordCount(wordIndex + 1);
  }, [applyMarks]);

  const resetLiveState = useCallback(() => {
    accumulatedWrongIndicesRef.current = new Set();
    commitFaultsRef.current = new Map();
    partialFaultsRef.current = new Map();
    revealedWrongRef.current = new Set();
    prevMatchPosRef.current = 0;
    revealedWordCountRef.current = 0;
    letterDiffRef.current = {};
    stalledCommitsRef.current = 0;
    stickyWrongIndicesRef.current = new Set();
    stickyLetterDiffRef.current = {};
    justRestartedRef.current = false;
    setRevealedWordCount(0);
    setCanSkip(false);
    setLiveWrongIndices([]);
    setLiveLetterDiff({});
  }, []);

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
    rewindUtterance(restartAt);

    commitFaultsRef.current = new Map();
    partialFaultsRef.current = new Map();
    applyMarks();

    // The matcher is back at the top of the ayah, so the next commit is a
    // fresh start rather than another commit that failed to move.
    justRestartedRef.current = true;
    prevMatchPosRef.current = 0;
    stalledCommitsRef.current = 0;
    setCanSkip(false);

    // Words already shown stay shown. They have been read, and pulling them
    // back off the page mid-recitation helps nobody.
  }, [applyMarks]);

  /**
   * Names the slip on screen for a moment, matching the portion. Clears itself
   * so it cannot sit over the next ayah.
   */
  const showMistakeMessage = useCallback(() => {
    if (mistakeMessageTimeoutRef.current) clearTimeout(mistakeMessageTimeoutRef.current);
    setMistakeMessage('Mistake');
    mistakeMessageTimeoutRef.current = setTimeout(() => setMistakeMessage(''), 3000);
  }, []);

  const recreateJudge = useCallback(() => {
    liveJudgeRef.current = createLiveJudge({
      getExpectedWords: () => {
        if (ayahDataRef.current?.isDisconnectedLetters) return [];
        return expectedWordsFrom(ayahDataRef.current?.words);
      },
      onMistake: () => {
        // Freeze the board as it stands: this is the slip itself, and it
        // survives however many times the ayah is started over afterwards.
        stickyWrongIndicesRef.current = new Set(accumulatedWrongIndicesRef.current);
        stickyLetterDiffRef.current = { ...letterDiffRef.current };
        if (ayahDataRef.current?.isDisconnectedLetters) return;
        buzzAndTone();
        // Said at the word, not at the end of the ayah. The retry prompt that
        // used to carry this was the only text the quiz ever showed for a
        // mistake, so dropping the retry would have left the buzz alone.
        showMistakeMessage();
      },
      onMarksChange: (entries) => {
        // The judge re-solves the whole ayah on every partial, so its verdict
        // replaces the last one instead of piling on top of it. A word it now
        // considers correct has to be able to lose its mark.
        partialFaultsRef.current = new Map(
          entries.map(({ index, spoken }) => [index, spoken ?? null])
        );
        const allWrong = applyMarks();
        if (allWrong.size > 0) {
          const maxWrong = Math.max(...allWrong);
          if (maxWrong >= revealedWordCountRef.current) {
            revealedWordCountRef.current = maxWrong + 1;
            setRevealedWordCount(maxWrong + 1);
          }
        }
      },
    });
  }, [applyMarks, buzzAndTone, showMistakeMessage]);

  const loadRun = useCallback(async (runIndex, items) => {
    resetUtterance({ discardMs: 2000 });
    const run = runsRef.current[runIndex];
    currentRunIndexRef.current = runIndex;
    const block = await loadContextBlock(run.surah, run.start, run.end);
    blockAyahsRef.current = block;
    const targets = new Map();
    for (let i = run.first; i < run.first + run.count; i += 1) {
      targets.set(block.findIndex((b) => b.ayahNumber === items[i].ayah_number), i);
    }
    targetsRef.current = targets;
    targetResultsRef.current = new Map();
    currentItemIndexRef.current = run.first;
    setCurrentItemIndex(run.first);
    currentBlockIndexRef.current = 0;
    setCurrentBlockIndex(0);
    wrongIndicesRef.current = [];
    if (mistakeMessageTimeoutRef.current) clearTimeout(mistakeMessageTimeoutRef.current);
    setMistakeMessage('');
    setConfirmedAyahs([]);
    resetLiveState();

    const first = block[0];
    ayahDataRef.current = { textDisplay: first.textDisplay, textCompare: first.textCompare, words: first.words, isDisconnectedLetters: first.isDisconnectedLetters };
    recreateJudge();
    resumeListening();
  }, [resetLiveState, recreateJudge]);

  const loadBlockAyah = useCallback((blockIndex) => {
    const entry = blockAyahsRef.current[blockIndex];
    if (!entry) return;
    // The header names the next ayah being tested. In a joined run that moves
    // on once its question's target has been recited.
    let upcoming = null;
    for (const [targetIndex, itemIndex] of targetsRef.current) {
      if (targetIndex >= blockIndex && (upcoming === null || itemIndex < upcoming)) {
        upcoming = itemIndex;
      }
    }
    if (upcoming !== null && upcoming !== currentItemIndexRef.current) {
      currentItemIndexRef.current = upcoming;
      setCurrentItemIndex(upcoming);
    }
    ayahDataRef.current = { textDisplay: entry.textDisplay, textCompare: entry.textCompare, words: entry.words, isDisconnectedLetters: entry.isDisconnectedLetters };
    resetLiveState();
    recreateJudge();
  }, [resetLiveState, recreateJudge]);

  // What the target ayah was marked wrong on, kept so the mistake can be
  // written with the same detail a recitation mistake carries: without the
  // words and the transcript there is nothing on the summary to disagree with.
  const recordTargetAyahResult = useCallback((result, detail = null) => {
    const itemIndex = targetsRef.current.get(currentBlockIndexRef.current);
    if (itemIndex === undefined) return;
    targetResultsRef.current.set(itemIndex, {
      result,
      detail: result === 'wrong' ? detail : null,
    });
  }, []);

  const advanceToNextBlockAyah = useCallback(async () => {
    const nextIndex = currentBlockIndexRef.current + 1;
    if (nextIndex >= blockAyahsRef.current.length) {
      const run = runsRef.current[currentRunIndexRef.current];
      for (let i = run.first; i < run.first + run.count; i += 1) {
        const item = quizItems[i];
        const recorded = targetResultsRef.current.get(i);
        const result = recorded?.result ?? 'wrong';
        const previous = await updateQuizResult(item.id, result);

        // A review mistake goes on the record the same way a recitation mistake
        // does. It used to leave nothing behind but a demoted box level, so a
        // word the recogniser misheard here could not be disputed on the summary
        // the way the identical mishearing could be during the portion, and it
        // went on shaping the schedule unchallenged.
        if (result === 'wrong' && sessionId) {
          try {
            const detail = recorded?.detail;
            const userId = await getCurrentUserId();
            const { error: mistakeError } = await supabase.from('mistakes').insert({
              user_id: userId,
              session_id: sessionId,
              surah_number: item.surah_number,
              ayah_number: item.ayah_number,
              source: 'review',
              wrong_words: detail?.wrongWords ?? [],
              transcribed_text: detail?.transcribedText ?? '',
              // Where the item stood before this answer moved it, so clearing
              // the mistake can put the schedule back exactly.
              review_prev_box_level: previous?.previousBoxLevel ?? null,
              review_prev_next_date: previous?.previousNextReviewDate ?? null,
            });
            if (mistakeError) throw new Error(mistakeError.message);
          } catch (err) {
            // The quiz result is already saved and is the part that matters for
            // scheduling. Losing the summary entry is not worth failing the quiz.
            reportHandledError('preQuiz.recordReviewMistake', err);
          }
        }
      }

      // Close the microphone and wait to be asked, after the last question as
      // much as between them, so the review never moves on by itself.
      // goToNextQuestion takes it from here.
      const isLastRun = currentRunIndexRef.current + 1 >= runsRef.current.length;
      setHasStarted(false);
      setAwaitingNextQuestion(isLastRun ? 'finish' : 'next');
      return;
    }

    currentBlockIndexRef.current = nextIndex;
    setCurrentBlockIndex(nextIndex);
    if (mistakeMessageTimeoutRef.current) clearTimeout(mistakeMessageTimeoutRef.current);
    setMistakeMessage('');
    loadBlockAyah(nextIndex);
  }, [quizItems, loadBlockAyah, loadRun, finishAllQuizItems, sessionId, sessionJuzNumber]);

  /**
   * The Next question button. Loads the next run and opens the microphone
   * again, so moving on is one tap rather than this and then the mic.
   */
  const goToNextQuestion = useCallback(async () => {
    if (!awaitingNextQuestion) return;
    const wasLast = awaitingNextQuestion === 'finish';
    setAwaitingNextQuestion(null);
    if (wasLast) {
      await finishAllQuizItems();
      return;
    }
    await loadRun(currentRunIndexRef.current + 1, quizItems);
    setHasStarted(true);
  }, [awaitingNextQuestion, finishAllQuizItems, loadRun, quizItems]);

  const onAyahComplete = useCallback(
    async (accumulatedText) => {
      const isTargetAyah = targetsRef.current.has(currentBlockIndexRef.current);

      if (ayahDataRef.current.isDisconnectedLetters) {
        const capturedDisplay = ayahDataRef.current.textCompare;
        setConfirmedAyahs((prev) => [...prev, { textDisplay: capturedDisplay, status: 'correct' }]);
        if (
          isTargetAyah &&
          !targetResultsRef.current.has(targetsRef.current.get(currentBlockIndexRef.current))
        ) {
          recordTargetAyahResult('correct_first');
        }
        await advanceToNextBlockAyah();
        return;
      }

      const { textDisplay, words } = ayahDataRef.current;
      // Per mushaf word, not per whitespace-separated token: `wrongIndices`
      // below indexes straight into `words`, and an imlaei word spelled as two
      // would shift every index after it by one.
      const expectedWords = expectedWordsFrom(words);
      const diff = wordDiff(expectedWords, normalizeArabic(accumulatedText));
      let wrongIndices = diff
        .map((item, i) => (item.status === 'wrong' || item.status === 'missing' ? i : -1))
        .filter((i) => i >= 0);

      // Everything on screen was decided while the ayah was still arriving,
      // when a word said twice is indistinguishable from a word said wrongly.
      // Going back a few words to correct yourself reliably painted something
      // red further ahead, and it was frozen on sight. The pass above read the
      // whole ayah with all of it in hand, so it gets the last word. What was
      // asked for outright survives, having never been a judgement.
      const spokenNorm = normalizeArabic(accumulatedText ?? '');
      const frozenSlip = new Set(stickyWrongIndicesRef.current);
      const frozenSlipDiff = { ...stickyLetterDiffRef.current };

      // An ayah can finish correct and still have been got wrong on the way:
      // said wrongly, or jumped, then heard and repaired. For hifz that is
      // exactly the word worth revising, so a clean finish is checked against
      // what was actually said before it is accepted as clean.
      if (
        wrongIndices.length === 0 &&
        frozenSlip.size > 0 &&
        hasSelfCorrectedSlip(expectedWords, spokenNorm.split(/\s+/).filter(Boolean))
      ) {
        wrongIndices = [...frozenSlip].sort((a, b) => a - b);
      }

      commitFaultsRef.current = new Map();
      partialFaultsRef.current = new Map(
        wrongIndices.map((i) => [i, frozenSlipDiff[i] ?? letterDiffRef.current[i] ?? null])
      );
      stickyWrongIndicesRef.current = new Set(revealedWrongRef.current);
      stickyLetterDiffRef.current = Object.fromEntries(
        [...revealedWrongRef.current].map((index) => [index, null])
      );
      applyMarks();
      wrongIndicesRef.current = wrongIndices;

      if (wrongIndices.length === 0) {
        if (mistakeMessageTimeoutRef.current) clearTimeout(mistakeMessageTimeoutRef.current);
        setMistakeMessage('');
        setConfirmedAyahs((prev) => [...prev, { textDisplay, status: 'correct' }]);
        if (isTargetAyah) recordTargetAyahResult('correct_first');
        await advanceToNextBlockAyah();
        return;
      }

      // A mistake is recorded and passed, the way the portion does it. This used
      // to ask for the ayah again, and on a second failure show what was said
      // beside the correct text and ask for it to be read back. The recitation
      // screen dropped both, and the review kept them, so the same slip was
      // handled two different ways in one session depending on which half you
      // were in. Nothing buzzes here: the live judge already did, at the word.
      setConfirmedAyahs((prev) => [...prev, { textDisplay, status: 'mistake', wrongIndices }]);

      if (isTargetAyah) {
        recordTargetAyahResult('wrong', {
          wrongWords: wrongIndices.map((i) => words[i]?.textDisplay ?? ''),
          transcribedText: accumulatedText,
        });
      } else {
        // A context ayah is not what is being tested, so it is not scored. It
        // still earns its own place in the queue.
        const blockEntry = blockAyahsRef.current[currentBlockIndexRef.current];
        const item = quizItems[currentItemIndexRef.current];
        if (blockEntry && item) {
          const userId = await getCurrentUserId();
          const previous = await flagContextAyahIfNeeded(
            userId,
            item.surah_number,
            blockEntry.ayahNumber
          );
          // Written down so it shows on the summary, where it can be cleared
          // like any other mistake. It used to change the queue and leave no
          // trace, so a misheard context ayah could not even be seen.
          if (sessionId) {
            try {
              const { error: contextError } = await supabase.from('mistakes').insert({
                user_id: userId,
                session_id: sessionId,
                surah_number: item.surah_number,
                ayah_number: blockEntry.ayahNumber,
                source: 'review_context',
                wrong_words: wrongIndices.map((i) => words[i]?.textDisplay ?? ''),
                transcribed_text: accumulatedText ?? '',
                review_prev_box_level: previous?.previousBoxLevel ?? null,
                review_prev_next_date: previous?.previousNextReviewDate ?? null,
                context_prev_count: previous?.previousContextCount ?? 0,
              });
              if (contextError) throw new Error(contextError.message);
            } catch (err) {
              reportHandledError('preQuiz.recordContextMistake', err);
            }
          }
        }
      }

      await advanceToNextBlockAyah();
    },
    [advanceToNextBlockAyah, applyMarks, quizItems, recordTargetAyahResult, sessionId]
  );

  /**
   * Gives up on the current ayah and moves on, counting it as a mistake.
   *
   * Only reachable once the recogniser has stalled, so this is not a way to
   * duck a hard ayah. It bypasses the retry and read-back states deliberately:
   * those ask someone to recite again, which is precisely what is not working.
   * If this is the ayah being tested, it is recorded wrong, so the spaced
   * repetition schedule treats it the same as any other mistake.
   */
  const skipCurrentAyah = useCallback(async () => {
    if (isSkippingRef.current) return;
    isSkippingRef.current = true;

    const words = ayahDataRef.current?.words ?? [];
    const isTargetAyah = targetsRef.current.has(currentBlockIndexRef.current);
    const from = Math.max(0, Math.min(prevMatchPosRef.current, words.length));
    const wrongIndices = [];
    for (let i = from; i < words.length; i += 1) wrongIndices.push(i);

    if (mistakeMessageTimeoutRef.current) clearTimeout(mistakeMessageTimeoutRef.current);

    setMistakeMessage('');
    setConfirmedAyahs((prev) => [
      ...prev,
      { textDisplay: ayahDataRef.current?.textDisplay ?? '', status: 'mistake', wrongIndices },
    ]);
    if (isTargetAyah) recordTargetAyahResult('wrong');

    try {
      await advanceToNextBlockAyah();
    } finally {
      isSkippingRef.current = false;
    }
  }, [advanceToNextBlockAyah, recordTargetAyahResult]);

  onAyahCompleteRef.current = onAyahComplete;

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);
        const userId = await getCurrentUserId();
        const [items, answered] = await Promise.all([
          fetchDueQuizItems(userId),
          countAnsweredToday(userId),
        ]);
        console.log('Quiz items fetched:', JSON.stringify(items));

        if (!mounted) return;

        if (items.length === 0) {
          await navigateToRecitation();
          return;
        }

        const { items: ordered, runs } = await buildRuns(items);
        if (!mounted) return;
        runsRef.current = runs;
        setAnsweredBefore(answered);
        setQuizItems(ordered);
        await loadRun(0, ordered);

        if (!mounted) return;

        // Listening now waits for the mic button; see the effect below.
      } catch (err) {
        reportHandledError('preQuiz.start', err);
        if (mounted) setError(err.message ?? 'Failed to start pre-session quiz.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
      startedRef.current = false;
    };
  }, [loadRun, navigateToRecitation, buzzAndTone]);

  /**
   * Open the microphone, once someone has asked for it.
   *
   * This ran at the tail of the setup effect, so the stream opened as soon as
   * the screen appeared: the app was listening while the bottom of the screen
   * told you to start reciting, and a Speechmatics connection was paid for
   * whether or not anybody spoke.
   */
  useEffect(() => {
    if (!hasStarted || isLoading || error) return;

    let mounted = true;
    // Every run opens the microphone again, so the claim starts false with it.
    setMicReady(false);

    (async () => {
      try {
      await startListening({
        // Reopened part-way through an ayah after the cutoff: carry on from
        // the words already on the page rather than starting the ayah again.
        preserveProgress: revealedWordCountRef.current > 0,
        getExpectedWords: () => {
          if (ayahDataRef.current?.isDisconnectedLetters) return [];
          return expectedWordsFrom(ayahDataRef.current?.words);
        },
        onAyahComplete: (text) => onAyahCompleteRef.current(text),
        onPartial: (text) => {
          // Only look for a restart once something has already gone wrong on
          // this ayah. An ayah that repeats its own opening would otherwise
          // look like a restart in the middle of a flawless recitation.
          if (accumulatedWrongIndicesRef.current.size > 0) {
            const expected = ayahDataRef.current?.isDisconnectedLetters
              ? []
              : expectedWordsFrom(ayahDataRef.current?.words);
            const spoken = normalizeArabic(text).split(/\s+/).filter(Boolean);
            const restartAt = findAyahRestart(spoken, expected);
            if (restartAt > 0) {
              handleAyahRestart(restartAt);
              // This update still carries the abandoned attempt in front of the
              // new one. The next partial arrives without it.
              liveJudgeRef.current?.update(
                dedupeConsecutiveWords(spoken.slice(restartAt).join(' '))
              );
              return;
            }
          }
          liveJudgeRef.current?.update(dedupeConsecutiveWords(text));
        },
        // The first guess has these words exactly right: show them now rather
        // than when they are confirmed. Never judged; see onEarlyReveal.
        onEarlyReveal: (position) => {
          if (position <= revealedWordCountRef.current) return;
          revealedWordCountRef.current = position;
          setRevealedWordCount(position);
        },
        onCommit: (matchedCount, statuses = []) => {
          const prev = prevMatchPosRef.current;
          prevMatchPosRef.current = matchedCount;

          // The aligner says which words it was unhappy with and why. Mistakes
          // used to be read off the size of the position jump, which could not
          // tell a genuine skip from several correct words landing in one
          // commit: a three-word commit opening an ayah moved the position
          // 0 → 3 and painted the first two words red on a clean recitation.
          //
          // Replaced whole rather than added to, so a slot the aligner
          // reconsiders gives its mark back as soon as it changes its mind.
          const before = commitFaultsRef.current;
          commitFaultsRef.current = new Map(
            statuses
              .filter((entry) => entry.status !== 'correct')
              .map(({ index, spoken }) => [index, spoken ?? null])
          );
          applyMarks();

          const isNewFault = [...commitFaultsRef.current.keys()].some(
            (index) => !before.has(index)
          );
          if (isNewFault && !ayahDataRef.current?.isDisconnectedLetters) {
            buzzAndTone();
            showMistakeMessage();
          }

          if (matchedCount > prev) {
            justRestartedRef.current = false;

            const newRevealed = Math.max(revealedWordCountRef.current, matchedCount);
            revealedWordCountRef.current = newRevealed;
            setRevealedWordCount(newRevealed);

            stalledCommitsRef.current = 0;
            setCanSkip(false);
          } else {
            // A commit that moved nothing. One is normal, a few in a row means
            // the recogniser is not going to produce this ayah on its own.
            stalledCommitsRef.current += 1;
            if (stalledCommitsRef.current >= STALLED_COMMITS_BEFORE_SKIP) {
              setCanSkip(true);
            }
          }
        },
        onError: (message) => {
          reportHandledError('preQuiz.transcription', message);
          if (mounted) setError(message);
        },
        onAutoStop: (reason) => {
          if (mounted) {
            setMicReady(false);
            setMicClosedReason(reason);
          }
        },
      });
      // Resolves only once the microphone is open, the socket is up and the
      // audio held during setup has been sent, so this is the first moment the
      // app is transcribing rather than merely hearing.
      if (mounted) setMicReady(true);
      } catch (err) {
        // The screen turned the microphone off, or started again, before this
        // attempt finished. Nothing failed and nobody is waiting on it, so it
        // is neither an error to show nor one to report.
        if (err instanceof ListeningCancelled) return;
        reportHandledError('preQuiz.startListening', err, {
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
  }, [hasStarted, isLoading, error, listenAttempt, buzzAndTone, handleAyahRestart]);

  useEffect(() => {
    if (isLoading || error || showTransition) {
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
  }, [isLoading, error, showTransition, pulseAnim]);

  useEffect(() => { currentBlockIndexRef.current = currentBlockIndex; }, [currentBlockIndex]);
  useEffect(() => { currentItemIndexRef.current = currentItemIndex; }, [currentItemIndex]);

  const [currentPage, setCurrentPage] = useState(null);

  useEffect(() => {
    if (!currentItem) return;
    const blockEntry = blockAyahsRef.current[currentBlockIndex];
    if (!blockEntry) return;
    let mounted = true;
    getPageForAyah(db, currentItem.surah_number, blockEntry.ayahNumber)
      .then((page) => { if (mounted && page != null) setCurrentPage(page); })
      .catch(() => {});
    return () => { mounted = false; };
  }, [db, currentItem, currentBlockIndex, isLoading]);

  const ayahStatuses = useMemo(() => {
    if (!currentItem) return {};
    const map = {};

    confirmedAyahs.forEach((ayah, index) => {
      const blockEntry = blockAyahsRef.current[index];
      if (!blockEntry) return;
      map[`${currentItem.surah_number}:${blockEntry.ayahNumber}`] = {
        wrongIndices: ayah.wrongIndices ?? [],
        letterDiffByIndex: ayah.letterDiffByIndex,
      };
    });

    // Current block ayah: live reveal. Only the question's opening ayah is
    // greyed in as the cue. The ayahs after it used to grey in too, one by one,
    // which handed over the very text being tested; they now stay hidden until
    // recited, as they do in the portion.
    const currentEntry = blockAyahsRef.current[currentBlockIndex];
    if (currentEntry) {
      const key = `${currentItem.surah_number}:${currentEntry.ayahNumber}`;
      if (!map[key]) {
        if (revealedWordCount > 0) {
          map[key] = {
            revealedCount: revealedWordCount,
            liveWrongIndices,
            skippedWordIndices: [],
            letterDiffByIndex: liveLetterDiff,
          };
        } else if (currentBlockIndex === 0) {
          map[key] = { wrongIndices: [], cue: true };
        }
      }
    }

    return map;
  }, [confirmedAyahs, currentItem, currentBlockIndex, revealedWordCount, liveWrongIndices, liveLetterDiff]);

  const isListening = hasStarted && micReady && !isLoading && !error && !showTransition;

  const handlePauseSession = async () => {
    if (sessionId) {
      await supabase.from('sessions').update({ status: 'paused' }).eq('id', sessionId);
    }
    await stopListening();
    navigation.navigate('Today');
  };

  if (showTransition) {
    return (
      <Animated.View style={[styles.transitionOverlay, { opacity: fadeAnim }]}>
        <Text style={styles.transitionText}>Time to revise</Text>
      </Animated.View>
    );
  }

  const hasFeedback = Boolean(mistakeMessage);
  // The prompt belongs to the start of a question, when the cue is the only
  // thing on the page. Every later ayah used to bring it back.
  const awaitingFirstWord = currentBlockIndex === 0 && revealedWordCount === 0;

  const quizTotal = answeredBefore + quizItems.length;
  const quizNumber = answeredBefore + currentItemIndex + 1;
  const quizProgress = quizItems.length > 0
    ? `Q ${quizNumber} of ${quizTotal}`
    : '';

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.header}>
        <Text style={styles.headerMode}>Mistake Review</Text>
        <Text style={styles.headerSub}>
          {quizProgress}
          {currentItem ? ` · ${getSurahName(currentItem.surah_number)} · Ayah ${currentItem.ayah_number}` : ''}
        </Text>
        <Text style={styles.pageBadge}>{currentPage != null ? `pg ${currentPage}` : ''}</Text>
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
          style={[
            styles.progressFill,
            {
              width: quizItems.length > 0
                ? `${(quizNumber / quizTotal) * 100}%`
                : '0%',
            },
          ]}
        />
      </View>

      <View style={styles.mushafArea}>
        {currentPage != null ? (
          <MushafPage pageNumber={currentPage} ayahStatuses={ayahStatuses} />
        ) : null}
      </View>

      {awaitingNextQuestion ? (
        <View style={styles.feedbackPanel}>
          {/* Between questions the button is the quiet blue of the paused
              banner, so it does not compete with the solid blue mic under it.
              The last one is solid brown, the warm end of the palette, for the
              step that leaves the review. Not orange: that means the mic is
              live. */}
          <TouchableOpacity
            style={[styles.nextBtn, awaitingNextQuestion === 'finish' && styles.finishBtn]}
            onPress={goToNextQuestion}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={
              awaitingNextQuestion === 'finish'
                ? (isQuizOnly ? 'Finish the review' : 'Go to the revision portion')
                : 'Go to the next question'
            }
          >
            <Text
              style={[styles.nextBtnText, awaitingNextQuestion === 'finish' && styles.finishBtnText]}
            >
              {awaitingNextQuestion === 'finish'
                ? (isQuizOnly ? 'Finish review  →' : 'Go to revision portion  →')
                : 'Next question  →'}
            </Text>
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
      ) : (!hasStarted || awaitingFirstWord || hasFeedback) ? (
        <View style={styles.feedbackPanel}>
          {hasFeedback ? null : !hasStarted ? (
            <Text style={styles.reciteHint}>Tap the mic to start reciting</Text>
          ) : !micReady && !micClosedReason ? (
            // Same as the portion: nothing is transcribing yet, so asking for
            // recitation here would be asking too early.
            <Text style={styles.reciteHint}>Opening the microphone, one moment</Text>
          ) : awaitingFirstWord ? (
            <Text style={styles.reciteHint}>Recite from the gray portion</Text>
          ) : null}
          {mistakeMessage ? (
            <Text style={styles.mistakeMessage}>{mistakeMessage}</Text>
          ) : null}
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
              onPress={() => {
                // Between questions the finished one has nothing left to hear,
                // so the mic moves on rather than reopening on it.
                if (awaitingNextQuestion) {
                  goToNextQuestion();
                  return;
                }
                setHasStarted((wasStarted) => !wasStarted);
              }}
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
    paddingTop: 4,
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
  headerProgress: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.accent,
  },
  headerSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
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
    maxHeight: 260,
  },
  reciteHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  mistakeMessage: {
    fontFamily: fonts.medium,
    color: colors.accent,
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  stuckHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingBottom: 8,
  },
  nextBtn: {
    alignSelf: 'center',
    backgroundColor: colors.ice,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 18,
    marginVertical: 8,
  },
  nextBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: colors.primary,
  },
  finishBtn: {
    backgroundColor: colors.brown,
    borderColor: colors.brown,
  },
  finishBtnText: {
    color: colors.white,
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
  // screen that is waiting to be pressed. Orange means the microphone is open,
  // which is the one state worth spending the accent colour on: pressing it
  // again closes it and the blue comes back.
  micCircle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  micCircleLive: {
    backgroundColor: colors.accent,
  },
  micEmoji: { fontSize: 16 },
  pageNumber: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingTop: 8,
    paddingHorizontal: 16,
  },
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
  pauseBtn: {
    backgroundColor: 'rgba(6,21,44,0.07)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  pauseBtnDisabled: { opacity: 0.5 },
  pauseBtnText: {
    fontFamily: fonts.medium,
    color: colors.textMid,
    fontSize: 13,
  },
  transitionOverlay: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  transitionText: {
    fontSize: 32,
    fontWeight: '700',
    // Brown, following on from the brown button that leads here.
    color: colors.brown,
    textAlign: 'center',
  },
});
