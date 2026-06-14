import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { getCurrentUserId } from '../lib/auth';
import { normalizeArabic, wordDiff } from '../lib/arabicUtils';
import { getAyah } from '../lib/quranApi';
import { supabase } from '../lib/supabase';
import { startListening, stopListening, resetUtterance, resumeListening } from '../lib/realtimeTranscription';
import { createLiveJudge } from '../lib/liveWordJudge';
import { useSQLiteContext } from 'expo-sqlite';
import MushafPage from '../components/MushafPage';
import { getPageForAyah } from '../lib/mushafDb';

function getTodayDateString() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function RecitationScreen(props) {
  const params = props.route?.params ?? props;
  const {
    surahNumber,
    startAyah,
    endAyah,
    sessionId,
    juzNumber = 1,
    totalAyahsInJuz,
    resumeFromAyah = startAyah,
  } = params;

  const navigation = useNavigation();
  const db = useSQLiteContext();
  const totalAyahs = endAyah - startAyah + 1;
  const initialAyahIndex = resumeFromAyah - startAyah;
  const [currentAyahIndex, setCurrentAyahIndex] = useState(initialAyahIndex);
  const [confirmedAyahs, setConfirmedAyahs] = useState([]);
  const [currentAyahDisplay, setCurrentAyahDisplay] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const ayahDataRef = useRef({
    textDisplay: '',
    textCompare: '',
    words: [],
    isDisconnectedLetters: false,
  });
  const nextAyahCacheRef = useRef(null); // { index, data } — prefetched next ayah
  const mistakeStateRef = useRef('none'); // 'none' | 'has_mistakes' | 'awaiting_retry'
  const wrongIndicesRef = useRef([]);
  const retryTriggeredRef = useRef(false);
  const firstFailedTextRef = useRef('');
  const [mistakeMessage, setMistakeMessage] = useState('');
  const currentAyahIndexRef = useRef(initialAyahIndex);
  const startedRef = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [showTransition, setShowTransition] = useState(false);
  const finishRevisionRef = useRef(null);
  const liveJudgeRef = useRef(null);
  const [liveWrongIndices, setLiveWrongIndices] = useState([]);
  const [liveText, setLiveText] = useState('');
  const [revealedWordCount, setRevealedWordCount] = useState(0);

  const finishRevisionAndNavigate = useCallback(async () => {
    await stopListening();
    if (sessionId) {
      await supabase
        .from('sessions')
        .update({ phase: 'post_quiz' })
        .eq('id', sessionId);
    }
    // Gradual hand-off: fade in the transition screen, hold, then navigate.
    setShowTransition(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 1500,
      useNativeDriver: true,
    }).start();
    await new Promise((resolve) => setTimeout(resolve, 4000));
    navigation.replace('PostSessionQuiz', {
      sessionId,
      surahNumber,
      startAyah,
      endAyah,
      juzNumber,
      totalAyahsInJuz,
    });
  }, [
    navigation,
    sessionId,
    surahNumber,
    startAyah,
    endAyah,
    juzNumber,
    totalAyahsInJuz,
    fadeAnim,
  ]);

  finishRevisionRef.current = finishRevisionAndNavigate;

  // Returns normalized expected words for the current ayah.
  // The transcription module matches committed words against this list in order;
  // completion fires as soon as the last entry is matched (no silence wait).
  const getExpectedWords = useCallback(() => {
    // Disconnected letters (الم، يس، الر، etc.) can't be transcribed by STT
    // reliably. Return [] so processCommitWords advances on the first commit
    // without trying to match any specific word.
    if (ayahDataRef.current?.isDisconnectedLetters) return [];

    const words = ayahDataRef.current?.words ?? [];
    const normalized = words
      .map((w) => normalizeArabic(w.textDisplay))
      .filter(Boolean);
    return normalized;
  }, []);

  const loadAyah = useCallback(async (ayahIndex) => {
    const ayahNumber = startAyah + ayahIndex;

    let data;
    // Use prefetched data if it matches what we need
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

    // Kick off background prefetch of the next ayah
    const prefetchIndex = ayahIndex + 1;
    if (prefetchIndex < totalAyahs) {
      getAyah(surahNumber, startAyah + prefetchIndex)
        .then((data) => {
          nextAyahCacheRef.current = { index: prefetchIndex, data };
        })
        .catch(() => {}); // silent — will fetch on demand if prefetch fails
    }
  }, [surahNumber, startAyah, totalAyahs]);

  const buzzAndTone = useCallback(async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {
      // haptics not supported on this device
    }
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('../assets/beep.mp3')
      );
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (e) {
      console.log('Sound error:', e);
    }
  }, []);

  const recreateJudge = useCallback(() => {
    liveJudgeRef.current = createLiveJudge({
      getExpectedWords: () => {
        const norm = normalizeArabic(ayahDataRef.current.textCompare ?? '');
        return norm ? norm.split(/\s+/).filter(Boolean) : [];
      },
      onMistake: (wrongEntries, liveText) => {
        // Only act on the FIRST mistake of a new attempt. Subsequent calls are
        // ignored because the judge sets fired=true and becomes a no-op anyway.
        if (mistakeStateRef.current !== 'none' || ayahDataRef.current.isDisconnectedLetters) return;
        mistakeStateRef.current = 'has_mistakes';
        retryTriggeredRef.current = false;
        wrongIndicesRef.current = wrongEntries.map((e) => e.index);
        firstFailedTextRef.current = liveText; // tentative; confirmed in onAyahComplete
        buzzAndTone(); // fire-and-forget — don't await in sync callback
        setMistakeMessage('Mistake — try again from the beginning');
      },
      onMarksChange: (indices) => {
        // Only update live wrong slots when there's no active mistake being shown.
        // During has_mistakes / awaiting_retry, the slots are locked at the
        // confirmed wrong positions and must not be overwritten by the live judge.
        if (mistakeStateRef.current !== 'none') return;
        setLiveWrongIndices(indices);
      },
    });
  }, [buzzAndTone]);

  const onAyahComplete = useCallback(
    async (accumulatedText) => {
      try {
        setLiveText('');

        // ── Helper: advance to the next ayah ──
        // Called by all advance paths. Pauses STT immediately (before any async
        // work) so stale commits can't race against loadAyah / ayahDataRef update.
        const advanceAyah = async ({
          confirmedEntry, // object pushed to confirmedAyahs
          mistakeInsert = null, // optional { userId, ayahNumber, tier, wrong_words, transcribed_text }
          message = '', // feedback message ('' clears it)
          clearFirstFailed = false,
        }) => {
          const completedIndex = currentAyahIndexRef.current;
          const nextIndex = completedIndex + 1;

          // 1. Freeze STT before any state change — prevents commits from landing
          //    while ayahDataRef is stale (between now and loadAyah completing).
          resetUtterance({ discardMs: 30000 });

          // 2. All synchronous state updates in one batch before the first await.
          mistakeStateRef.current = 'none';
          retryTriggeredRef.current = false;
          if (clearFirstFailed) firstFailedTextRef.current = '';
          setRevealedWordCount(0);
          setLiveWrongIndices([]);
          setMistakeMessage(message);
          currentAyahIndexRef.current = nextIndex;
          setCurrentAyahIndex(nextIndex);
          setCurrentAyahDisplay('');
          setConfirmedAyahs((prev) => [...prev, confirmedEntry]);

          // Clear the feedback message after 2.5 s (only relevant for non-empty messages).
          if (message) setTimeout(() => setMistakeMessage(''), 2500);

          // 3. Handle session end before any DB writes to avoid unnecessary async work.
          if (nextIndex >= totalAyahs) {
            resumeListening();
            await finishRevisionRef.current();
            return;
          }

          // 4. Async DB writes.
          if (mistakeInsert && sessionId) {
            const { userId, ayahNumber, tier, wrong_words, transcribed_text } = mistakeInsert;
            await supabase.from('mistakes').insert({
              user_id: userId,
              session_id: sessionId,
              surah_number: surahNumber,
              ayah_number: ayahNumber,
              tier,
              wrong_words,
              transcribed_text,
            });
            await supabase.from('quiz_queue').upsert(
              { user_id: userId, surah_number: surahNumber, ayah_number: ayahNumber,
                box_level: 0, next_review_date: getTodayDateString() },
              { onConflict: 'user_id,surah_number,ayah_number' }
            );
          }
          await supabase
            .from('sessions')
            .update({ last_confirmed_ayah: startAyah + completedIndex })
            .eq('id', sessionId);

          // 5. Load new ayah data THEN resume STT — ensures getExpectedWords() and
          //    ayahDataRef are correct before any commit is processed.
          await loadAyah(nextIndex);
          recreateJudge();
          resumeListening();
        };

        // ── Disconnected letters (الم etc.): always advance ──
        if (ayahDataRef.current.isDisconnectedLetters) {
          await advanceAyah({
            confirmedEntry: { textDisplay: ayahDataRef.current.textCompare, status: 'correct' },
          });
          return;
        }

        const { textDisplay, textCompare, words } = ayahDataRef.current;

        // Compute letter-level diff from the first failed attempt (for mushaf display).
        const computeFirstAttemptInfo = () => {
          const fd = wordDiff(
            normalizeArabic(textCompare),
            normalizeArabic(firstFailedTextRef.current)
          );
          const letterDiffByIndex = {};
          const firstWrongIndices = [];
          fd.forEach((item, idx) => {
            if (item.status === 'wrong' || item.status === 'missing') {
              letterDiffByIndex[idx] = item.status === 'missing' ? null : (item.spoken ?? null);
              firstWrongIndices.push(idx);
            }
          });
          return { letterDiffByIndex, firstWrongIndices };
        };

        // ── has_mistakes: ayah completed after live-detected mistake ──
        if (mistakeStateRef.current === 'has_mistakes') {
          const diff = wordDiff(normalizeArabic(textCompare), normalizeArabic(accumulatedText));
          const wrongIndices = diff
            .map((item, i) => (item.status === 'wrong' || item.status === 'missing' ? i : -1))
            .filter((i) => i >= 0);

          if (wrongIndices.length === 0) {
            // Live judge false-positive — advance as correct.
            await advanceAyah({
              confirmedEntry: { textDisplay, status: 'correct' },
            });
            return;
          }

          // Real mistake confirmed — lock in definitive wrong positions and wait.
          wrongIndicesRef.current = wrongIndices;
          firstFailedTextRef.current = accumulatedText;
          setLiveWrongIndices(wrongIndices);
          retryTriggeredRef.current = false;
          // Short pause to drain any stale commits still in the Speechmatics pipeline.
          resetUtterance({ discardMs: 200 });
          return;
        }

        const diff = wordDiff(normalizeArabic(textCompare), normalizeArabic(accumulatedText));
        const wrongIndices = diff
          .map((item, i) => (item.status === 'wrong' || item.status === 'missing' ? i : -1))
          .filter((i) => i >= 0);
        const allCorrect = wrongIndices.length === 0;

        // ── none: first attempt ──
        if (mistakeStateRef.current === 'none') {
          if (allCorrect) {
            await advanceAyah({ confirmedEntry: { textDisplay, status: 'correct' } });
          } else {
            // Live judge missed the mistake — enter has_mistakes now.
            wrongIndicesRef.current = wrongIndices;
            firstFailedTextRef.current = accumulatedText;
            mistakeStateRef.current = 'has_mistakes';
            retryTriggeredRef.current = false;
            setRevealedWordCount(words.length); // restore full reveal (onCommit('') cleared it)
            setLiveWrongIndices(wrongIndices);
            resetUtterance({ discardMs: 200 });
            buzzAndTone();
            setMistakeMessage('Mistake — try again from the beginning');
          }
          return;
        }

        // ── awaiting_retry: second attempt — always advance ──
        if (mistakeStateRef.current === 'awaiting_retry') {
          const { letterDiffByIndex, firstWrongIndices } = computeFirstAttemptInfo();
          const isRetryCorrect = allCorrect;

          let mistakeInsert = null;
          if (sessionId) {
            const userId = await getCurrentUserId();
            mistakeInsert = {
              userId,
              ayahNumber: startAyah + currentAyahIndexRef.current,
              tier: isRetryCorrect ? 1 : 2,
              wrong_words: firstWrongIndices.map(
                (i) => ayahDataRef.current.words[i]?.textDisplay ?? ''
              ),
              transcribed_text: firstFailedTextRef.current,
            };
          }

          await advanceAyah({
            confirmedEntry: {
              textDisplay,
              status: isRetryCorrect ? 'correct' : 'mistake',
              wrongIndices: firstWrongIndices,
              letterDiffByIndex,
            },
            mistakeInsert,
            message: isRetryCorrect ? 'Correct' : 'Still incorrect — correct word shown',
            clearFirstFailed: true,
          });
        }
      } catch (err) {
        resumeListening(); // make sure STT isn't left frozen if something throws
        setError(err?.message ?? 'Failed to process ayah completion.');
      }
    },
    [loadAyah, buzzAndTone, recreateJudge, startAyah, sessionId, totalAyahs, surahNumber]
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);

        if (resumeFromAyah > startAyah) {
          const userId = await getCurrentUserId();

          const { data: priorMistakes } = await supabase
            .from('mistakes')
            .select('ayah_number, wrong_words, tier')
            .eq('session_id', sessionId)
            .order('ayah_number', { ascending: true });

          const mistakesByAyah = {};
          for (const m of priorMistakes ?? []) {
            mistakesByAyah[m.ayah_number] = m;
          }

          const priorConfirmed = [];
          for (let ayah = startAyah; ayah < resumeFromAyah; ayah++) {
            const data = await getAyah(surahNumber, ayah);
            const mistake = mistakesByAyah[ayah];
            let wrongIndices = [];

            if (mistake?.wrong_words?.length) {
              wrongIndices = mistake.wrong_words
                .map((w) =>
                  data.words.findIndex((word) => word.textDisplay === w)
                )
                .filter((i) => i >= 0);
            }

            priorConfirmed.push({
              textDisplay: data.isDisconnectedLetters
                ? data.textCompare
                : data.textDisplay,
              status: mistake?.tier === 2 ? 'mistake' : 'correct',
              wrongIndices,
            });
          }

          if (mounted) {
            setConfirmedAyahs(priorConfirmed);
          }
        }

        await loadAyah(initialAyahIndex);
        if (!mounted) {
          return;
        }
        recreateJudge();
        await startListening({
          getExpectedWords,
          onAyahComplete,
          // Partials arrive in real-time but Speechmatics over-predicts Arabic
          // Quran text — it shows future words before they're spoken. Use partials
          // only for the live mistake judge and retry detection, not for word reveal.
          // text = accumulatedText + partialText (for the live judge / display)
          // partialOnly = raw current speech fragment only (for retry detection)
          onPartial: (text, partialOnly) => {
            liveJudgeRef.current?.update(text);
            setLiveText(text);

            // Retry detection: fires when the user's CURRENT speech (partialOnly,
            // not the accumulated prefix) starts with the ayah's first word.
            // Using `text` here would always match because accumulatedText starts
            // with word1 — so we'd get a false trigger while still mid-first-attempt.
            if (
              mistakeStateRef.current === 'has_mistakes' &&
              !retryTriggeredRef.current &&
              !ayahDataRef.current?.isDisconnectedLetters &&
              partialOnly // only raw partials, not commit-triggered calls (which pass undefined)
            ) {
              const words = ayahDataRef.current?.words ?? [];
              if (words.length > 0) {
                const normFirst = normalizeArabic(words[0].textDisplay ?? '');
                const retryWords = normalizeArabic(partialOnly).split(/\s+/).filter(Boolean);
                if (normFirst && retryWords.length > 0 && retryWords[0] === normFirst) {
                  retryTriggeredRef.current = true;
                  mistakeStateRef.current = 'awaiting_retry';
                  setMistakeMessage('');
                  recreateJudge();
                  // Brief discard to drain any stale first-attempt commits that
                  // Speechmatics hasn't sent yet, before the retry commits arrive.
                  resetUtterance({ discardMs: 300 });
                }
              }
            }
          },
          // Committed words are stable (no prediction). Drive the reveal from
          // these so only actually-spoken words appear on the mushaf.
          // max_delay:1.0 in the WS config ensures commits arrive every ≤1 s
          // even without a pause, so the reveal stays close to real-time.
          onCommit: (text) => {
            const count = text
              ? (normalizeArabic(text)?.split(/\s+/).filter(Boolean).length ?? 0)
              : 0;
            // Empty commit after ayah completion fires before onAyahComplete —
            // don't blank the mushaf while a mistake is still being shown.
            if (count === 0 && mistakeStateRef.current === 'has_mistakes') return;
            // During retry the wrong-word slots are locked; liveWrongIndices
            // drives visibility instead of revealedWordCount.
            if (mistakeStateRef.current === 'awaiting_retry') return;
            setRevealedWordCount(count);
          },
          onError: (message) => {
            if (mounted) setError(message);
          },
        });
      } catch (err) {
        if (mounted) {
          setError(err.message ?? 'Failed to start recitation session.');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
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
    resumeFromAyah,
    startAyah,
    surahNumber,
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
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
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

  // --- Mushaf page state ---
  const [currentPage, setCurrentPage] = useState(null);

  useEffect(() => {
    let mounted = true;
    const ayahNumber = startAyah + Math.min(currentAyahIndex, totalAyahs - 1);
    getPageForAyah(db, surahNumber, ayahNumber)
      .then((page) => {
        if (mounted && page != null) setCurrentPage(page);
      })
      .catch(() => {}); // keep previous page on lookup failure
    return () => {
      mounted = false;
    };
  }, [db, surahNumber, startAyah, currentAyahIndex, totalAyahs]);

  // Confirmed ayahs → per-ayah word statuses. Unconfirmed ayahs are absent,
  // so the mushaf renders them invisible (unread words are never disclosed).
  const ayahStatuses = useMemo(() => {
    const map = {};
    confirmedAyahs.forEach((ayah, index) => {
      map[`${surahNumber}:${startAyah + index}`] = {
        wrongIndices: ayah.wrongIndices ?? [],
        letterDiffByIndex: ayah.letterDiffByIndex ?? null,
      };
    });
    const currentKey = `${surahNumber}:${startAyah + currentAyahIndex}`;
    if (!map[currentKey]) {
      // Current unconfirmed ayah: reveal words one-by-one as the STT picks
      // them up. revealedWordCount drives how many words are visible; words
      // in liveWrongIndices that have been revealed get a red tint.
      map[currentKey] = { revealedCount: revealedWordCount, liveWrongIndices };
    }
    return map;
  }, [confirmedAyahs, surahNumber, startAyah, currentAyahIndex, liveWrongIndices, revealedWordCount]);

  const displayAyahNumber = Math.min(currentAyahIndex + 1, totalAyahs);
  const isListening = !isLoading && !error && !showTransition;

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

      {/* Mushaf fills all available space */}
      <View style={styles.mushafArea}>
        {currentPage != null ? (
          <MushafPage pageNumber={currentPage} ayahStatuses={ayahStatuses} />
        ) : null}
      </View>

      {/* Feedback panel — small single-line status messages only */}
      {mistakeMessage ? (
        <View style={styles.feedbackPanel}>
          <Text style={[
            styles.feedbackMessage,
            mistakeMessage === 'Correct' && styles.feedbackCorrect,
          ]}>
            {mistakeMessage}
          </Text>
        </View>
      ) : null}

      {/* Bottom bar — always visible */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.pauseBtn, isLoading && styles.pauseBtnDisabled]}
          onPress={handlePauseSession}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          <Text style={styles.pauseBtnText}>Pause</Text>
        </TouchableOpacity>

        <View style={styles.micArea}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#8a6d2f" />
          ) : (
            <Animated.Text
              style={[styles.micIcon, { opacity: isListening ? pulseAnim : 1 }]}
            >
              🎤
            </Animated.Text>
          )}
        </View>

        <Text style={styles.progress}>
          {`Ayah ${displayAyahNumber} of ${totalAyahs}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: 56,
    backgroundColor: '#fff',
  },
  error: {
    color: '#c00',
    marginHorizontal: 16,
    marginBottom: 8,
  },
  mushafArea: {
    flex: 1,
  },
  feedbackPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d4c9a8',
  },
  feedbackMessage: {
    color: '#e65100',
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontWeight: '500',
  },
  feedbackCorrect: {
    color: '#2e7d32',
  },
  transitionOverlay: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  transitionText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1b5e20',
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
    borderTopColor: '#d4c9a8',
    backgroundColor: '#fff',
  },
  micArea: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  micIcon: {
    fontSize: 38,
  },
  progress: {
    fontSize: 14,
    color: '#8a6d2f',
    fontWeight: '500',
    textAlign: 'right',
  },
  pauseBtn: {
    backgroundColor: '#c62828',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  pauseBtnDisabled: {
    opacity: 0.5,
  },
  pauseBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
