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
import { normalizeArabic, wordDiff } from '../lib/arabicUtils';
import { getCurrentUserId } from '../lib/auth';
import { getSurahName } from '../lib/juzSurahMap';
import { createLiveJudge, findAyahRestart } from '../lib/liveWordJudge';
import {
  fetchDueQuizItems,
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
import { colors, fonts } from '../lib/theme';

function dedupeConsecutiveWords(text) {
  if (!text) return text;
  const words = normalizeArabic(text).split(/\s+/).filter(Boolean);
  return words.filter((w, i) => i === 0 || w !== words[i - 1]).join(' ');
}

async function loadContextBlock(surahNumber, centerAyah) {
  const start = Math.max(1, centerAyah - 2);
  let end = centerAyah + 1;
  try {
    await getAyah(surahNumber, end);
  } catch {
    end = centerAyah;
  }
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
  const [confirmedAyahs, setConfirmedAyahs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  // Nothing listens until the mic is tapped. It used to open itself on
  // arrival, so the screen asked people to recite while already recording.
  const [hasStarted, setHasStarted] = useState(false);
  const [error, setError] = useState('');
  const [showTransition, setShowTransition] = useState(false);
  const [showNextItemTransition, setShowNextItemTransition] = useState(false);

  const blockAyahsRef = useRef([]);
  const targetAyahIndexRef = useRef(0);
  const targetAyahResultRef = useRef(null);
  const ayahDataRef = useRef({ textDisplay: '', textCompare: '', words: [], isDisconnectedLetters: false });
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const currentBlockIndexRef = useRef(0);
  const currentItemIndexRef = useRef(0);
  const mistakeStateRef = useRef('none');
  const wrongIndicesRef = useRef([]);
  const firstFailedTextRef = useRef('');
  const [mistakeMessage, setMistakeMessage] = useState('');
  // True once the recogniser has stalled long enough to offer a way past.
  const [canSkip, setCanSkip] = useState(false);
  const [correctFeedback, setCorrectFeedback] = useState(false);
  const [tier2AyahDisplay, setTier2AyahDisplay] = useState('');
  const [tier2TranscribedText, setTier2TranscribedText] = useState('');
  const [tier2HighlightIndices, setTier2HighlightIndices] = useState([]);
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
      const { sound } = await Audio.Sound.createAsync(require('../assets/beep.mp3'));
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((s) => { if (s.didJustFinish) sound.unloadAsync(); });
    } catch (e) { console.log('Sound error:', e); }
  }, []);

  const revealNextWord = useCallback(() => {
    const wordIndex = revealedWordCountRef.current;
    const words = ayahDataRef.current?.words;
    if (!words || wordIndex >= words.length) return;
    accumulatedWrongIndicesRef.current.add(wordIndex);
    letterDiffRef.current[wordIndex] = null;
    // Asked for outright, so a restart does not take it back.
    stickyWrongIndicesRef.current.add(wordIndex);
    stickyLetterDiffRef.current[wordIndex] = null;
    setLiveWrongIndices([...accumulatedWrongIndicesRef.current]);
    setLiveLetterDiff((prev) => ({ ...prev, [wordIndex]: null }));
    revealedWordCountRef.current = wordIndex + 1;
    setRevealedWordCount(wordIndex + 1);
  }, []);

  const resetLiveState = useCallback(() => {
    accumulatedWrongIndicesRef.current = new Set();
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

    accumulatedWrongIndicesRef.current = new Set(stickyWrongIndicesRef.current);
    letterDiffRef.current = { ...stickyLetterDiffRef.current };
    setLiveWrongIndices([...accumulatedWrongIndicesRef.current]);
    setLiveLetterDiff({ ...letterDiffRef.current });

    // The matcher is back at the top of the ayah, so the next commit is a
    // fresh start rather than another commit that failed to move.
    justRestartedRef.current = true;
    prevMatchPosRef.current = 0;
    stalledCommitsRef.current = 0;
    setCanSkip(false);

    // Words already shown stay shown. They have been read, and pulling them
    // back off the page mid-recitation helps nobody.
  }, []);

  const recreateJudge = useCallback(() => {
    liveJudgeRef.current = createLiveJudge({
      getExpectedWords: () => {
        if (ayahDataRef.current?.isDisconnectedLetters) return [];
        return (ayahDataRef.current?.words ?? [])
          .map((w) => normalizeArabic(w.textCompare))
          .filter(Boolean);
      },
      onMistake: () => {
        // Freeze the board as it stands: this is the slip itself, and it
        // survives however many times the ayah is started over afterwards.
        stickyWrongIndicesRef.current = new Set(accumulatedWrongIndicesRef.current);
        stickyLetterDiffRef.current = { ...letterDiffRef.current };
        if (!ayahDataRef.current?.isDisconnectedLetters) buzzAndTone();
      },
      onMarksChange: (entries) => {
        entries.forEach(({ index }) => accumulatedWrongIndicesRef.current.add(index));
        const allWrong = [...accumulatedWrongIndicesRef.current];
        setLiveWrongIndices(allWrong);
        entries.forEach(({ index, spoken }) => { letterDiffRef.current[index] = spoken ?? null; });
        setLiveLetterDiff((prev) => {
          const next = { ...prev };
          entries.forEach(({ index, spoken }) => { next[index] = spoken ?? null; });
          return next;
        });
        if (allWrong.length > 0) {
          const maxWrong = Math.max(...allWrong);
          if (maxWrong >= revealedWordCountRef.current) {
            revealedWordCountRef.current = maxWrong + 1;
            setRevealedWordCount(maxWrong + 1);
          }
        }
      },
    });
  }, [buzzAndTone]);

  const loadBlockForItem = useCallback(async (item) => {
    resetUtterance({ discardMs: 2000 });
    const block = await loadContextBlock(item.surah_number, item.ayah_number);
    blockAyahsRef.current = block;
    targetAyahIndexRef.current = block.findIndex((b) => b.ayahNumber === item.ayah_number);
    targetAyahResultRef.current = null;
    currentBlockIndexRef.current = 0;
    setCurrentBlockIndex(0);
    mistakeStateRef.current = 'none';
    wrongIndicesRef.current = [];
    setMistakeMessage('');
    setTier2AyahDisplay('');
    setTier2TranscribedText('');
    setTier2HighlightIndices([]);
    setConfirmedAyahs([]);
    firstFailedTextRef.current = '';
    resetLiveState();

    const first = block[0];
    ayahDataRef.current = { textDisplay: first.textDisplay, textCompare: first.textCompare, words: first.words, isDisconnectedLetters: first.isDisconnectedLetters };
    recreateJudge();
    resumeListening();
  }, [resetLiveState, recreateJudge]);

  const loadBlockAyah = useCallback((blockIndex) => {
    const entry = blockAyahsRef.current[blockIndex];
    if (!entry) return;
    ayahDataRef.current = { textDisplay: entry.textDisplay, textCompare: entry.textCompare, words: entry.words, isDisconnectedLetters: entry.isDisconnectedLetters };
    resetLiveState();
    recreateJudge();
  }, [resetLiveState, recreateJudge]);

  const recordTargetAyahResult = useCallback((result) => {
    if (currentBlockIndexRef.current === targetAyahIndexRef.current) {
      targetAyahResultRef.current = result;
    }
  }, []);

  const advanceToNextBlockAyah = useCallback(async () => {
    const nextIndex = currentBlockIndexRef.current + 1;
    if (nextIndex >= blockAyahsRef.current.length) {
      const item = quizItems[currentItemIndexRef.current];
      const result = targetAyahResultRef.current ?? 'wrong';
      await updateQuizResult(item.id, result);

      const nextItemIndex = currentItemIndexRef.current + 1;
      if (nextItemIndex >= quizItems.length) {
        await finishAllQuizItems();
        return;
      }

      setShowNextItemTransition(true);
      await new Promise((resolve) => setTimeout(resolve, 4000));
      setShowNextItemTransition(false);

      currentItemIndexRef.current = nextItemIndex;
      setCurrentItemIndex(nextItemIndex);
      await loadBlockForItem(quizItems[nextItemIndex]);
      return;
    }

    currentBlockIndexRef.current = nextIndex;
    setCurrentBlockIndex(nextIndex);
    mistakeStateRef.current = 'none';
    setMistakeMessage('');
    setTier2AyahDisplay('');
    setTier2TranscribedText('');
    setTier2HighlightIndices([]);
    loadBlockAyah(nextIndex);
  }, [quizItems, loadBlockAyah, loadBlockForItem, finishAllQuizItems, sessionJuzNumber]);

  const onAyahComplete = useCallback(
    async (accumulatedText) => {
      const isTargetAyah = currentBlockIndexRef.current === targetAyahIndexRef.current;

      if (ayahDataRef.current.isDisconnectedLetters) {
        const capturedDisplay = ayahDataRef.current.textCompare;
        setConfirmedAyahs((prev) => [...prev, { textDisplay: capturedDisplay, status: 'correct' }]);
        if (isTargetAyah && targetAyahResultRef.current === null) recordTargetAyahResult('correct_first');
        await advanceToNextBlockAyah();
        return;
      }

      const { textDisplay, textCompare, words } = ayahDataRef.current;
      const diff = wordDiff(normalizeArabic(textCompare), normalizeArabic(accumulatedText));
      const wrongEntries = diff.filter((item) => item.status === 'wrong' || item.status === 'missing');
      const allCorrect = wrongEntries.length === 0;
      const wrongIndices = diff
        .map((item, i) => (item.status === 'wrong' || item.status === 'missing' ? i : -1))
        .filter((i) => i >= 0);

      if (mistakeStateRef.current === 'none') {
        if (allCorrect) {
          setMistakeMessage('');
          setConfirmedAyahs((prev) => [...prev, { textDisplay, status: 'correct' }]);
          if (isTargetAyah) recordTargetAyahResult('correct_first');
          await advanceToNextBlockAyah();
        } else {
          wrongIndicesRef.current = wrongIndices;
          firstFailedTextRef.current = accumulatedText;
          mistakeStateRef.current = 'awaiting_retry';
          await buzzAndTone();
          setMistakeMessage('Possible mistake detected. Please try again.');
        }
        return;
      }

      if (mistakeStateRef.current === 'awaiting_retry') {
        if (allCorrect) {
          setCorrectFeedback(true);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          setCorrectFeedback(false);
          mistakeStateRef.current = 'none';
          setMistakeMessage('');
          setConfirmedAyahs((prev) => [
            ...prev,
            { textDisplay, status: 'correct', wrongIndices: wrongIndicesRef.current },
          ]);
          if (isTargetAyah) {
            recordTargetAyahResult('correct_second');
          } else if (wrongIndicesRef.current.length > 0) {
            const blockEntry = blockAyahsRef.current[currentBlockIndexRef.current];
            const item = quizItems[currentItemIndexRef.current];
            if (blockEntry && item) {
              const userId = await getCurrentUserId();
              await flagContextAyahIfNeeded(userId, item.surah_number, blockEntry.ayahNumber);
            }
          }
          await advanceToNextBlockAyah();
        } else {
          wrongIndicesRef.current = wrongIndices;
          mistakeStateRef.current = 'tier2_readback';
          setMistakeMessage('');
          setTier2TranscribedText(firstFailedTextRef.current);
          setTier2AyahDisplay(textDisplay);
          setTier2HighlightIndices(wrongIndices);
        }
        return;
      }

      if (mistakeStateRef.current === 'tier2_readback') {
        mistakeStateRef.current = 'none';
        setTier2AyahDisplay('');
        setTier2TranscribedText('');
        setTier2HighlightIndices([]);
        setConfirmedAyahs((prev) => [
          ...prev,
          { textDisplay, status: 'mistake', wrongIndices: wrongIndicesRef.current },
        ]);
        if (isTargetAyah) recordTargetAyahResult('wrong');
        await advanceToNextBlockAyah();
      }
    },
    [advanceToNextBlockAyah, buzzAndTone, quizItems, recordTargetAyahResult]
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
    const isTargetAyah = currentBlockIndexRef.current === targetAyahIndexRef.current;
    const from = Math.max(0, Math.min(prevMatchPosRef.current, words.length));
    const wrongIndices = [];
    for (let i = from; i < words.length; i += 1) wrongIndices.push(i);

    mistakeStateRef.current = 'none';
    setMistakeMessage('');
    setTier2AyahDisplay('');
    setTier2TranscribedText('');
    setTier2HighlightIndices([]);
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
        const items = await fetchDueQuizItems(userId);
        console.log('Quiz items fetched:', JSON.stringify(items));

        if (!mounted) return;

        if (items.length === 0) {
          await navigateToRecitation();
          return;
        }

        setQuizItems(items);
        currentItemIndexRef.current = 0;
        await loadBlockForItem(items[0]);

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
  }, [loadBlockForItem, navigateToRecitation, buzzAndTone]);

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

    (async () => {
      try {
      await startListening({
        getExpectedWords: () => {
          if (ayahDataRef.current?.isDisconnectedLetters) return [];
          return (ayahDataRef.current?.words ?? [])
            .map((w) => normalizeArabic(w.textCompare))
            .filter(Boolean);
        },
        onAyahComplete: (text) => onAyahCompleteRef.current(text),
        onPartial: (text) => {
          // Only look for a restart once something has already gone wrong on
          // this ayah. An ayah that repeats its own opening would otherwise
          // look like a restart in the middle of a flawless recitation.
          if (accumulatedWrongIndicesRef.current.size > 0) {
            const expected = ayahDataRef.current?.isDisconnectedLetters
              ? []
              : (ayahDataRef.current?.words ?? [])
                  .map((w) => normalizeArabic(w.textCompare))
                  .filter(Boolean);
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
        onCommit: (matchedCount) => {
          const prev = prevMatchPosRef.current;
          prevMatchPosRef.current = matchedCount;
          if (matchedCount > prev) {
            // After a restart the first commit re-covers ground in one go,
            // which is a jump in the numbers but not in the recitation.
            const afterRestart = justRestartedRef.current;
            justRestartedRef.current = false;

            if (!afterRestart && matchedCount > prev + 1) {
              const skipStart = prev;
              for (let i = skipStart; i < matchedCount - 1; i++) {
                accumulatedWrongIndicesRef.current.add(i);
                letterDiffRef.current[i] = null;
                // Words genuinely passed over. A restart does not undo them.
                stickyWrongIndicesRef.current.add(i);
                stickyLetterDiffRef.current[i] = null;
              }
              setLiveWrongIndices([...accumulatedWrongIndicesRef.current]);
              setLiveLetterDiff((existing) => {
                const next = { ...existing };
                for (let i = skipStart; i < matchedCount - 1; i++) next[i] = null;
                return next;
              });
              if (!ayahDataRef.current?.isDisconnectedLetters) buzzAndTone();
            }
            const newRevealed = Math.max(revealedWordCountRef.current, matchedCount);
            revealedWordCountRef.current = newRevealed;
            setRevealedWordCount(newRevealed);

            // Progress, so nobody is stuck. Withdraw the offer if it was out.
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
      });
      } catch (err) {
        // The screen turned the microphone off, or started again, before this
        // attempt finished. Nothing failed and nobody is waiting on it, so it
        // is neither an error to show nor one to report.
        if (err instanceof ListeningCancelled) return;
        reportHandledError('preQuiz.startListening', err);
        if (mounted) setError(err.message ?? 'Could not start listening.');
      }
    })();

    return () => {
      mounted = false;
      stopListening();
    };
  }, [hasStarted, isLoading, error, buzzAndTone, handleAyahRestart]);

  useEffect(() => {
    if (isLoading || error || showTransition || showNextItemTransition) {
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
  }, [isLoading, error, showTransition, showNextItemTransition, pulseAnim]);

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

    // Current block ayah: live reveal (or grey cue before recitation starts).
    const currentEntry = blockAyahsRef.current[currentBlockIndex];
    if (currentEntry) {
      const key = `${currentItem.surah_number}:${currentEntry.ayahNumber}`;
      if (!map[key]) {
        map[key] = revealedWordCount === 0
          ? { wrongIndices: [], cue: true }
          : {
              revealedCount: revealedWordCount,
              liveWrongIndices,
              skippedWordIndices: [],
              letterDiffByIndex: liveLetterDiff,
            };
      }
    }

    return map;
  }, [confirmedAyahs, currentItem, currentBlockIndex, revealedWordCount, liveWrongIndices, liveLetterDiff]);

  const isListening = hasStarted && !isLoading && !error && !showTransition && !showNextItemTransition;

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

  if (showNextItemTransition) {
    return (
      <View style={styles.transitionOverlay}>
        <Text style={styles.transitionText}>Next question</Text>
      </View>
    );
  }

  const hasFeedback = mistakeMessage || correctFeedback || tier2AyahDisplay;

  const quizProgress = quizItems.length > 0
    ? `Q ${currentItemIndex + 1} of ${quizItems.length}`
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
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              width: quizItems.length > 0
                ? `${((currentItemIndex + 1) / quizItems.length) * 100}%`
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

      {canSkip ? (
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
      ) : (!hasStarted || revealedWordCount === 0 || hasFeedback) ? (
        <View style={styles.feedbackPanel}>
          {!hasStarted && !hasFeedback ? (
            <Text style={styles.reciteHint}>Tap the mic to start reciting</Text>
          ) : revealedWordCount === 0 && !hasFeedback ? (
            <Text style={styles.reciteHint}>Recite from the gray portion</Text>
          ) : null}
          {mistakeMessage ? (
            <Text style={styles.mistakeMessage}>{mistakeMessage}</Text>
          ) : null}
          {correctFeedback ? (
            <Text style={styles.correctFeedback}>Correct</Text>
          ) : null}
          {tier2AyahDisplay ? (
            <ScrollView style={styles.tier2Scroll}>
              <View style={styles.tier2Frame}>
                <Text style={styles.tier2Label}>What you said:</Text>
                <Text style={styles.tier2TranscribedText}>{tier2TranscribedText}</Text>
                <Text style={styles.tier2Label}>Correct:</Text>
                <Text style={styles.tier2AyahText}>
                  {(() => {
                    const wrongSet = new Set(tier2HighlightIndices);
                    return tier2AyahDisplay.split(/\s+/).map((word, i) => (
                      <Text key={i} style={wrongSet.has(i) ? styles.tier2WordWrong : styles.tier2WordCorrect}>
                        {word}{' '}
                      </Text>
                    ));
                  })()}
                </Text>
                <Text style={styles.tier2Instruction}>Read the correct version above again</Text>
              </View>
            </ScrollView>
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
                    hasStarted && styles.micRingLive,
                    { opacity: isListening ? pulseAnim : 0.15, transform: [{ scale: isListening ? pulseAnim : 1 }] },
                  ]}
                />
                <View style={[styles.micCircle, hasStarted && styles.micCircleLive]}>
                  <Text style={styles.micEmoji}>🎙</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
          {/* Under the microphone it is labelling, and the slot is held open
              either way so the bar does not change height as it toggles. */}
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
  correctFeedback: {
    fontFamily: fonts.semiBold,
    color: colors.success,
    fontSize: 18,
    textAlign: 'center',
    paddingVertical: 10,
  },
  tier2Scroll: {
    maxHeight: 240,
  },
  tier2Frame: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 8,
    padding: 16,
    margin: 12,
    backgroundColor: colors.errorLight,
  },
  tier2Label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 4,
  },
  tier2TranscribedText: {
    fontSize: 18,
    lineHeight: 32,
    textAlign: 'right',
    writingDirection: 'rtl',
    color: colors.textMuted,
    marginBottom: 16,
    fontFamily: 'UthmanicHafs',
  },
  tier2AyahText: {
    fontSize: 22,
    lineHeight: 40,
    textAlign: 'right',
    writingDirection: 'rtl',
    fontFamily: 'UthmanicHafs',
  },
  tier2WordWrong: { color: colors.error },
  tier2WordCorrect: { color: colors.text },
  tier2Instruction: {
    fontSize: 14,
    color: colors.accent,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 12,
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
    color: colors.success,
    textAlign: 'center',
  },
});
