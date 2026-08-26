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
import { normalizeArabic } from '../../lib/arabicUtils';
import { getAyah } from '../../lib/quranApi';
import {
  startListening,
  stopListening,
  resetUtterance,
  resumeListening,
} from '../../lib/realtimeTranscription';
import { createLiveJudge } from '../../lib/liveWordJudge';
import { useSQLiteContext } from 'expo-sqlite';
import MushafPage from '../../components/MushafPage';
import { getPageForAyah } from '../../lib/mushafDb';
import { C, F, S } from './design';

const SURAH_NUMBER = 67;
const START_AYAH = 1;
const TOTAL_AYAHS = 7;

function dedupeConsecutiveWords(text) {
  if (!text) return text;
  const words = normalizeArabic(text).split(/\s+/).filter(Boolean);
  return words.filter((w, i) => i === 0 || w !== words[i - 1]).join(' ');
}

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

export default function RecitationDemoScreen() {
  const navigation = useNavigation();
  const db = useSQLiteContext();
  const { width: screenWidth } = useWindowDimensions();

  const [currentAyahIndex, setCurrentAyahIndex] = useState(0);
  const [confirmedAyahs, setConfirmedAyahs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [skippedWordIndices, setSkippedWordIndices] = useState([]);
  const [liveWrongIndices, setLiveWrongIndices] = useState([]);
  const [liveLetterDiff, setLiveLetterDiff] = useState({});
  const [revealedWordCount, setRevealedWordCount] = useState(0);
  const [mistakeMessage, setMistakeMessage] = useState('');
  const [allPages, setAllPages] = useState([]);
  const [isRevisionComplete, setIsRevisionComplete] = useState(false);

  const ayahDataRef = useRef({ textDisplay: '', textCompare: '', words: [], isDisconnectedLetters: false });
  const nextAyahCacheRef = useRef(null);
  const currentAyahIndexRef = useRef(0);
  const accumulatedWrongIndicesRef = useRef(new Set());
  const confirmedAyahWordsRef = useRef([]);
  const isGoingBackRef = useRef(false);
  const prevMatchPosRef = useRef(0);
  const revealedWordCountRef = useRef(0);
  const letterDiffRef = useRef({});
  const mistakeMessageTimeoutRef = useRef(null);
  const startedRef = useRef(false);
  const liveJudgeRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pageListRef = useRef(null);

  const loadAyah = useCallback(async (ayahIndex) => {
    const ayahNumber = START_AYAH + ayahIndex;
    let data;
    if (nextAyahCacheRef.current?.index === ayahIndex) {
      data = nextAyahCacheRef.current.data;
      ayahDataRef.current = data;
      nextAyahCacheRef.current = null;
    } else {
      data = await getAyah(SURAH_NUMBER, ayahNumber);
      ayahDataRef.current = data;
    }
    const prefetchIndex = ayahIndex + 1;
    if (prefetchIndex < TOTAL_AYAHS) {
      getAyah(SURAH_NUMBER, START_AYAH + prefetchIndex)
        .then((d) => { nextAyahCacheRef.current = { index: prefetchIndex, data: d }; })
        .catch(() => {});
    }
  }, []);

  const getExpectedWords = useCallback(() => {
    if (ayahDataRef.current?.isDisconnectedLetters) return [];
    return (ayahDataRef.current?.words ?? []).map((w) => normalizeArabic(w.textCompare)).filter(Boolean);
  }, []);

  const buzzAndTone = useCallback(async () => {
    try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
    try {
      const { sound } = await Audio.Sound.createAsync(require('../../assets/beep.mp3'));
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((s) => { if (s.didJustFinish) sound.unloadAsync(); });
    } catch {}
  }, []);

  const showMistakeMessage = useCallback(() => {
    if (mistakeMessageTimeoutRef.current) clearTimeout(mistakeMessageTimeoutRef.current);
    setMistakeMessage(`Mistake in ayah ${currentAyahIndexRef.current + 1}`);
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
        if (isGoingBackRef.current) return;
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
  }, [buzzAndTone, showMistakeMessage]);

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

  const onAyahComplete = useCallback(async (accumulatedText) => {
    try {
      const advanceAyah = async ({ confirmedEntry }) => {
        const completedIndex = currentAyahIndexRef.current;
        const nextIndex = completedIndex + 1;

        const completedNorm = normalizeArabic(ayahDataRef.current.textCompare ?? '');
        if (completedNorm) {
          confirmedAyahWordsRef.current = [
            ...confirmedAyahWordsRef.current,
            completedNorm.split(/\s+/).filter(Boolean),
          ];
        }

        resetUtterance({ discardMs: 30000 });
        accumulatedWrongIndicesRef.current = new Set();
        isGoingBackRef.current = false;
        prevMatchPosRef.current = 0;
        revealedWordCountRef.current = 0;
        letterDiffRef.current = {};
        if (mistakeMessageTimeoutRef.current) {
          clearTimeout(mistakeMessageTimeoutRef.current);
          mistakeMessageTimeoutRef.current = null;
        }

        setRevealedWordCount(0);
        setSkippedWordIndices([]);
        setLiveWrongIndices([]);
        setLiveLetterDiff({});
        setMistakeMessage('');
        currentAyahIndexRef.current = nextIndex;
        setCurrentAyahIndex(nextIndex);
        setConfirmedAyahs((prev) => [...prev, confirmedEntry]);

        if (nextIndex >= TOTAL_AYAHS) {
          setIsRevisionComplete(true);
          await stopListening();
          return;
        }

        await loadAyah(nextIndex);
        recreateJudge();
        resumeListening();
      };

      if (ayahDataRef.current.isDisconnectedLetters) {
        await advanceAyah({ confirmedEntry: { textDisplay: ayahDataRef.current.textCompare, status: 'correct', wrongIndices: [] } });
        return;
      }

      const { textDisplay } = ayahDataRef.current;
      liveJudgeRef.current?.finalUpdate(dedupeConsecutiveWords(accumulatedText));
      const wrongIndices = [...accumulatedWrongIndicesRef.current].sort((a, b) => a - b);
      const letterDiffByIndex = wrongIndices.length > 0 ? { ...letterDiffRef.current } : undefined;
      await advanceAyah({ confirmedEntry: { textDisplay, status: 'correct', wrongIndices, letterDiffByIndex } });
    } catch (err) {
      resumeListening();
      setError(err?.message ?? 'Failed to process ayah completion.');
    }
  }, [loadAyah, recreateJudge]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);
        await loadAyah(0);
        if (!mounted) return;
        recreateJudge();
        await startListening({
          getExpectedWords,
          onAyahComplete,
          onPartial: (text) => {
            if (isGoingBack(text, confirmedAyahWordsRef.current)) {
              if (!isGoingBackRef.current) {
                isGoingBackRef.current = true;
                const pos = prevMatchPosRef.current;
                [...accumulatedWrongIndicesRef.current].forEach((i) => {
                  if (i >= pos) accumulatedWrongIndicesRef.current.delete(i);
                });
                setLiveWrongIndices([...accumulatedWrongIndicesRef.current]);
              }
              return;
            }
            isGoingBackRef.current = false;
            liveJudgeRef.current?.update(dedupeConsecutiveWords(text));
          },
          onCommit: (matchedCount) => {
            const prev = prevMatchPosRef.current;
            prevMatchPosRef.current = matchedCount;
            if (matchedCount > prev) {
              isGoingBackRef.current = false;
              if (matchedCount > prev + 1) {
                for (let i = prev; i < matchedCount - 1; i++) {
                  accumulatedWrongIndicesRef.current.add(i);
                }
                setLiveWrongIndices([...accumulatedWrongIndicesRef.current]);
                setLiveLetterDiff((existing) => {
                  const next = { ...existing };
                  for (let i = prev; i < matchedCount - 1; i++) next[i] = null;
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
          onError: (message) => { if (mounted) setError(message); },
        });
      } catch (err) {
        if (mounted) setError(err.message ?? 'Failed to start recitation session.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
      startedRef.current = false;
      stopListening();
    };
  }, [loadAyah, getExpectedWords, onAyahComplete, recreateJudge]);

  useEffect(() => { currentAyahIndexRef.current = currentAyahIndex; }, [currentAyahIndex]);

  useEffect(() => {
    if (isLoading || error) { pulseAnim.stopAnimation(); pulseAnim.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [isLoading, error, pulseAnim]);

  useEffect(() => {
    let mounted = true;
    const ayahNumber = START_AYAH + Math.min(currentAyahIndex, TOTAL_AYAHS - 1);
    getPageForAyah(db, SURAH_NUMBER, ayahNumber)
      .then((page) => {
        if (!mounted || page == null) return;
        setAllPages((prev) => {
          if (prev[prev.length - 1] === page) return prev;
          return [...prev, page];
        });
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [db, currentAyahIndex]);

  useEffect(() => {
    if (allPages.length === 0) return;
    pageListRef.current?.scrollToIndex({ index: allPages.length - 1, animated: true });
  }, [allPages.length]);

  const ayahStatuses = useMemo(() => {
    const map = {};
    confirmedAyahs.forEach((ayah, index) => {
      map[`${SURAH_NUMBER}:${START_AYAH + index}`] = {
        wrongIndices: ayah.wrongIndices ?? [],
        letterDiffByIndex: ayah.letterDiffByIndex,
      };
    });
    const currentKey = `${SURAH_NUMBER}:${START_AYAH + currentAyahIndex}`;
    if (!map[currentKey]) {
      if (revealedWordCount > 0) {
        map[currentKey] = { revealedCount: revealedWordCount, liveWrongIndices, skippedWordIndices, letterDiffByIndex: liveLetterDiff };
      } else if (currentAyahIndex === 0) {
        map[currentKey] = { wrongIndices: [], cue: true };
      }
    }
    return map;
  }, [confirmedAyahs, currentAyahIndex, liveWrongIndices, liveLetterDiff, revealedWordCount, skippedWordIndices]);

  const isListening = !isLoading && !error && !isRevisionComplete;

  const handleStop = useCallback(async () => {
    await stopListening();
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Recitation</Text>
        <Text style={styles.headerSub}>Al-Mulk · {START_AYAH}–{START_AYAH + TOTAL_AYAHS - 1}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(currentAyahIndex / TOTAL_AYAHS) * 100}%` }]} />
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
        getItemLayout={(_, index) => ({ length: screenWidth, offset: screenWidth * index, index })}
        renderItem={({ item: pageNum }) => (
          <View style={{ width: screenWidth, flex: 1 }}>
            <MushafPage pageNumber={pageNum} ayahStatuses={ayahStatuses} />
          </View>
        )}
      />

      {isRevisionComplete ? (
        <View style={styles.feedbackPanel}>
          <TouchableOpacity style={styles.doneBtn} onPress={handleStop} activeOpacity={0.85}>
            <Text style={styles.doneBtnText}>Session complete — done</Text>
          </TouchableOpacity>
        </View>
      ) : mistakeMessage ? (
        <View style={styles.feedbackPanel}>
          <Text style={styles.mistakeText}>⚠ {mistakeMessage}</Text>
        </View>
      ) : currentAyahIndex === 0 && revealedWordCount === 0 ? (
        <View style={styles.feedbackPanel}>
          <Text style={styles.hintText}>Recite from the grey ayah</Text>
        </View>
      ) : null}

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.sideBtn, isLoading && { opacity: 0.5 }]}
          onPress={handleStop}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          <Text style={styles.sideBtnText}>✕ Pause</Text>
        </TouchableOpacity>

        <View style={styles.micCol}>
          <View style={styles.micWrap}>
            <Animated.View style={[styles.micRing, { opacity: isListening ? pulseAnim : 0.2 }]} />
            {isLoading ? (
              <ActivityIndicator size="small" color={C.cobalt} />
            ) : (
              <View style={styles.micCircle}>
                <Text style={styles.micEmoji}>🎙</Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={handleStop} activeOpacity={0.7}>
            <Text style={styles.skipText}>Skip to recap</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[styles.sideBtn, styles.revealBtn]} onPress={revealNextWord} activeOpacity={0.8}>
          <Text style={styles.revealBtnText}>Reveal</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background, paddingTop: 56 },
  header: { alignItems: 'center', paddingBottom: S.sm },
  headerTitle: { fontFamily: F.semiBold, fontSize: 16, color: C.navy },
  headerSub: { fontFamily: F.regular, fontSize: 12, color: C.navyLight, marginTop: 2 },
  progressTrack: {
    height: 3, backgroundColor: 'rgba(6,21,44,0.08)',
    marginHorizontal: S.md, borderRadius: 2, marginBottom: S.md,
  },
  progressFill: { height: 3, backgroundColor: C.cobalt, borderRadius: 2 },
  error: { fontFamily: F.regular, color: C.error, marginHorizontal: S.md, marginBottom: 8 },
  mushafArea: { flex: 1 },
  feedbackPanel: { paddingVertical: 10, paddingHorizontal: S.lg },
  mistakeText: { fontFamily: F.medium, fontSize: 13, color: C.error, textAlign: 'center' },
  hintText: { fontFamily: F.regular, fontSize: 13, color: C.navyLight, textAlign: 'center' },
  doneBtn: { backgroundColor: C.cobalt, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  doneBtnText: { fontFamily: F.semiBold, fontSize: 16, color: C.white },
  micCol: { alignItems: 'center', gap: 6 },
  skipText: { fontFamily: F.regular, fontSize: 11, color: C.navyLight },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.cardBorder, backgroundColor: C.white,
  },
  sideBtn: {
    backgroundColor: 'rgba(6,21,44,0.07)', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  sideBtnText: { fontFamily: F.medium, fontSize: 13, color: C.navyMid },
  revealBtn: { backgroundColor: C.goldLight },
  revealBtnText: { fontFamily: F.semiBold, fontSize: 13, color: C.brown },
  micWrap: { alignItems: 'center', justifyContent: 'center', width: 48, height: 48 },
  micRing: { position: 'absolute', width: 42, height: 42, borderRadius: 21, backgroundColor: C.cobaltDim },
  micCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.cobalt, alignItems: 'center', justifyContent: 'center' },
  micEmoji: { fontSize: 16 },
});
