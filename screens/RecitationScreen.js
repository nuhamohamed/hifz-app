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
import { todayString as getTodayDateString } from '../lib/dates';
import { getAyahLocation } from '../lib/juzSurahMap';
import { normalizeArabic } from '../lib/arabicUtils';
import { getAyah } from '../lib/quranApi';
import { supabase } from '../lib/supabase';
import {
  startListening,
  stopListening,
  resetUtterance,
  resumeListening,
} from '../lib/realtimeTranscription';
import { createLiveJudge } from '../lib/liveWordJudge';
import { useSQLiteContext } from 'expo-sqlite';
import MushafPage from '../components/MushafPage';
import { getPageForAyah } from '../lib/mushafDb';
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

// Tiers are dropped: every mistake now counts equally everywhere. The app
// reveals the correct word the instant you err, so there is no unaided
// recovery to observe and the slip-versus-gap split was guesswork.
//
// mistakes.tier is NOT NULL, so something has to go in it. This still writes
// the old severity heuristic, which drives nothing. It is due to be repurposed
// to record whether Reveal was pressed, which is a real signal worth having a
// few weeks of beta data on.
function classifyMistakeTier(wrongIndices, letterDiffByIndex) {
  if (wrongIndices.length >= 2) return 2;
  // spoken === null means the word was skipped rather than mispronounced.
  const skippedEntirely = wrongIndices.some(
    (i) => (letterDiffByIndex ?? {})[i] == null
  );
  return skippedEntirely ? 2 : 1;
}

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
  // Set when the microphone closed itself: 90 seconds of silence, or two hours
  // in one sitting. Null while listening.
  const [micClosedReason, setMicClosedReason] = useState(null);
  // Bumped to restart listening after the microphone closed itself. The whole
  // setup lives in one effect, so re-running it is the honest way back in
  // rather than duplicating the connection logic.
  const [listenAttempt, setListenAttempt] = useState(0);

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
  const mistakeMessageTimeoutRef = useRef(null);
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
  const [mistakeMessage, setMistakeMessage] = useState('');
  // Ordered list of unique mushaf pages visited this session, for swiping back.
  const [allPages, setAllPages] = useState([]);
  const pageListRef = useRef(null);
  const { width: screenWidth } = useWindowDimensions();

  const finishRevisionAndNavigate = useCallback(async () => {
    await stopListening();
    if (sessionId) {
      await supabase
        .from('sessions')
        .update({ phase: 'post_quiz' })
        .eq('id', sessionId);
    }
    setShowTransition(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 1500,
      useNativeDriver: true,
    }).start();
    await new Promise((resolve) => setTimeout(resolve, 4000));
    navigation.replace('PostSessionQuiz', {
      sessionId,
      startOffset,
      endOffset,
      juzNumber,
      totalAyahsInJuz,
    });
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

  const revealNextWord = useCallback(() => {
    const wordIndex = revealedWordCountRef.current;
    const words = ayahDataRef.current?.words;
    if (!words || wordIndex >= words.length) return;
    accumulatedWrongIndicesRef.current.add(wordIndex);
    letterDiffRef.current[wordIndex] = null;
    setLiveWrongIndices([...accumulatedWrongIndicesRef.current]);
    setLiveLetterDiff((prev) => ({ ...prev, [wordIndex]: null }));
    revealedWordCountRef.current = wordIndex + 1;
    setRevealedWordCount(wordIndex + 1);
  }, []);

  const getExpectedWords = useCallback(() => {
    if (ayahDataRef.current?.isDisconnectedLetters) return [];
    const words = ayahDataRef.current?.words ?? [];
    return words.map((w) => normalizeArabic(w.textCompare)).filter(Boolean);
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

  const showMistakeMessage = useCallback(() => {
    const ayahLabel = currentAyahIndexRef.current + 1;
    if (mistakeMessageTimeoutRef.current) clearTimeout(mistakeMessageTimeoutRef.current);
    setMistakeMessage(`Mistake in ayah ${ayahLabel}`);
    mistakeMessageTimeoutRef.current = setTimeout(() => setMistakeMessage(''), 3000);
  }, []);

  const recreateJudge = useCallback(() => {
    liveJudgeRef.current = createLiveJudge({
      getExpectedWords: () => {
        const norm = normalizeArabic(ayahDataRef.current.textCompare ?? '');
        return norm ? norm.split(/\s+/).filter(Boolean) : [];
      },
      onMistake: () => {
        if (ayahDataRef.current.isDisconnectedLetters) return;
        buzzAndTone();
        showMistakeMessage();
      },
      onMarksChange: (entries) => {
        // entries: [{index, status, spoken}] — discard if going-back detected.
        if (isGoingBackRef.current) return;
        entries.forEach(({ index }) => accumulatedWrongIndicesRef.current.add(index));
        const allWrong = [...accumulatedWrongIndicesRef.current];
        setLiveWrongIndices(allWrong);
        // Update ref synchronously so onAyahComplete can read the final diff
        // before React flushes the async setState below.
        entries.forEach(({ index, spoken }) => {
          letterDiffRef.current[index] = spoken ?? null;
        });
        // Store spoken word per index for letter-level diff rendering.
        setLiveLetterDiff((prev) => {
          const next = { ...prev };
          entries.forEach(({ index, spoken }) => { next[index] = spoken ?? null; });
          return next;
        });
        // Reveal any wrong word not yet reached by matchPos so it shows red now.
        if (allWrong.length > 0) {
          const maxWrong = Math.max(...allWrong);
          if (maxWrong >= revealedWordCountRef.current) {
            revealedWordCountRef.current = maxWrong + 1;
            setRevealedWordCount(maxWrong + 1);
          }
        }
      },
    });
  }, [buzzAndTone, showMistakeMessage]);

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
          isGoingBackRef.current = false;
          prevMatchPosRef.current = 0;
          revealedWordCountRef.current = 0;
          letterDiffRef.current = {};
          if (mistakeMessageTimeoutRef.current) {
            clearTimeout(mistakeMessageTimeoutRef.current);
            mistakeMessageTimeoutRef.current = null;
          }

          // Synchronous state batch before any await.
          setRevealedWordCount(0);
          setSkippedWordIndices([]);
          setLiveWrongIndices([]);
          setLiveLetterDiff({});
          setMistakeMessage('');
          currentAyahIndexRef.current = nextIndex;
          setCurrentAyahIndex(nextIndex);
          setCurrentAyahDisplay('');
          setConfirmedAyahs((prev) => [...prev, confirmedEntry]);

          if (nextIndex >= totalAyahs) {
            setIsRevisionComplete(true);
            await stopListening();
            return;
          }

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
            await supabase.from('quiz_queue').upsert(
              {
                user_id: userId,
                surah_number: surahNumber,
                ayah_number: ayahNumber,
                box_level: 0,
                next_review_date: getTodayDateString(),
              },
              { onConflict: 'user_id,surah_number,ayah_number' }
            );
          }
          await supabase
            .from('sessions')
            // A juz offset, matching sessions.portion_start_ayah. It used to be
            // a surah-relative ayah number, so resuming a portion that crossed a
            // surah restarted it in the wrong place.
            .update({ last_confirmed_ayah: startOffset + completedIndex })
            .eq('id', sessionId);

          await loadAyah(nextIndex);
          recreateJudge();
          resumeListening();
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
        liveJudgeRef.current?.finalUpdate(dedupeConsecutiveWords(accumulatedText));

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
            tier: classifyMistakeTier(wrongIndices, letterDiffByIndex),
            wrong_words: wrongIndices.map((i) => words[i]?.textDisplay ?? ''),
            transcribed_text: accumulatedText,
          };
        }

        await advanceAyah({ confirmedEntry, mistakeInsert });
      } catch (err) {
        resumeListening();
        setError(err?.message ?? 'Failed to process ayah completion.');
      }
    },
    [loadAyah, recreateJudge, locationAt, startOffset, sessionId, totalAyahs]
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);

        if (resumeFromOffset > startOffset) {
          const { data: priorMistakes } = await supabase
            .from('mistakes')
            .select('surah_number, ayah_number, wrong_words')
            .eq('session_id', sessionId)
            .order('ayah_number', { ascending: true });

          // Keyed on surah *and* ayah. Keyed on ayah alone, a portion spanning
          // two surahs would let Al-Baqarah 5's mistake mark Ali Imran 5.
          const mistakesByAyah = {};
          for (const m of priorMistakes ?? []) {
            mistakesByAyah[`${m.surah_number}:${m.ayah_number}`] = m;
          }

          const priorConfirmed = [];
          for (let offset = startOffset; offset < resumeFromOffset; offset++) {
            const loc = getAyahLocation(juzNumber, offset);
            const data = await getAyah(loc.surahNumber, loc.ayahNumber);
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
        }

        await loadAyah(initialAyahIndex);
        if (!mounted) return;
        recreateJudge();

        await startListening({
          getExpectedWords,
          onAyahComplete,
          onPartial: (text) => {
            if (isGoingBack(text, confirmedAyahWordsRef.current)) {
              if (!isGoingBackRef.current) {
                isGoingBackRef.current = true;
                // Scrub indices at or beyond current matchPos — those came from
                // going-back words misread against this ayah, not real mistakes.
                const pos = prevMatchPosRef.current;
                [...accumulatedWrongIndicesRef.current].forEach((i) => {
                  if (i >= pos) accumulatedWrongIndicesRef.current.delete(i);
                });
                setLiveWrongIndices([...accumulatedWrongIndicesRef.current]);
              }
              return;
            }
            // Going-back window ended — user is speaking current ayah again.
            isGoingBackRef.current = false;
            liveJudgeRef.current?.update(dedupeConsecutiveWords(text));
            setLiveText(text);
          },
          onCommit: (matchedCount) => {
            const prev = prevMatchPosRef.current;
            prevMatchPosRef.current = matchedCount;

            if (matchedCount > prev) {
              // matchPos advanced — user is on current ayah.
              isGoingBackRef.current = false;

              if (matchedCount > prev + 1) {
                // Jump of >1: skipped word(s) — reveal in red immediately.
                // spoken = null signals the whole word was omitted (no partial diff).
                const skipStart = prev;
                for (let i = skipStart; i < matchedCount - 1; i++) {
                  accumulatedWrongIndicesRef.current.add(i);
                }
                setLiveWrongIndices([...accumulatedWrongIndicesRef.current]);
                setLiveLetterDiff((existing) => {
                  const next = { ...existing };
                  for (let i = skipStart; i < matchedCount - 1; i++) next[i] = null;
                  return next;
                });
                if (!ayahDataRef.current?.isDisconnectedLetters) {
                  buzzAndTone();
                  showMistakeMessage();
                }
              }
              const newRevealed = Math.max(revealedWordCountRef.current, matchedCount);
              revealedWordCountRef.current = newRevealed;
              setRevealedWordCount(newRevealed);
            }
          },
          onError: (message) => {
            if (mounted) setError(message);
          },
          onAutoStop: (reason) => {
            if (mounted) setMicClosedReason(reason);
          },
        });
      } catch (err) {
        if (mounted) {
          setError(err.message ?? 'Failed to start recitation session.');
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
      startedRef.current = false;
      stopListening();
    };
  }, [
    loadAyah,
    getExpectedWords,
    onAyahComplete,
    recreateJudge,
    initialAyahIndex,
    resumeFromOffset,
    startOffset,
    listenAttempt,
    juzNumber,
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

  useEffect(() => {
    let mounted = true;
    const loc = locationAt(Math.min(currentAyahIndex, totalAyahs - 1));
    getPageForAyah(db, loc.surahNumber, loc.ayahNumber)
      .then((page) => {
        if (!mounted || page == null) return;
        setCurrentPage(page);
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
    const cur = locationAt(currentAyahIndex);
    const currentKey = `${cur.surahNumber}:${cur.ayahNumber}`;
    if (!map[currentKey]) {
      if (revealedWordCount > 0) {
        map[currentKey] = {
          revealedCount: revealedWordCount,
          liveWrongIndices,
          skippedWordIndices,
          letterDiffByIndex: liveLetterDiff,
        };
      } else if (currentAyahIndex === 0) {
        map[currentKey] = { wrongIndices: [], cue: true };
      }
      // ayahs after the first stay hidden until the user starts reciting them
    }
    return map;
  }, [
    confirmedAyahs,
    locationAt,
    currentAyahIndex,
    liveWrongIndices,
    liveLetterDiff,
    revealedWordCount,
    skippedWordIndices,
  ]);

  const displayAyahNumber = Math.min(currentAyahIndex + 1, totalAyahs);
  const isListening = !isLoading && !error && !showTransition && !isRevisionComplete;

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
              : 'The microphone turned itself off after a quiet minute and a half. Tap to carry on.'}
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
            <Text style={styles.doneBtnText}>Done — continue to quiz</Text>
          </TouchableOpacity>
        </View>
      ) : (currentAyahIndex === 0 && revealedWordCount === 0) || mistakeMessage ? (
        <View style={styles.feedbackPanel}>
          {currentAyahIndex === 0 && revealedWordCount === 0 && !mistakeMessage ? (
            <Text style={styles.reciteHint}>Recite from the grey ayah</Text>
          ) : (
            <Text style={styles.feedbackMessage}>{mistakeMessage}</Text>
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
            <View style={styles.micWrap}>
              <Animated.View
                style={[styles.micRing, { opacity: isListening ? pulseAnim : 0.15, transform: [{ scale: isListening ? pulseAnim : 1 }] }]}
              />
              <View style={styles.micCircle}>
                <Text style={styles.micEmoji}>🎙</Text>
              </View>
            </View>
          )}
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
  feedbackMessage: {
    fontFamily: fonts.medium,
    color: colors.accent,
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
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
  micRing: {
    position: 'absolute', width: 42, height: 42,
    borderRadius: 21, backgroundColor: colors.primaryDim,
  },
  micCircle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
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
