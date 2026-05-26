import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { normalizeArabic, wordDiff } from '../lib/arabicUtils';
import { getAyah } from '../lib/quranApi';
import { startRealtime, stopRealtime } from '../lib/realtimeStt';

const SURAH_NUMBER = 2;
const START_AYAH = 1;
const TOTAL_AYAHS = 7;

export default function RecitationScreen() {
  const [currentAyahIndex, setCurrentAyahIndex] = useState(0);
  const [confirmedAyahs, setConfirmedAyahs] = useState([]);
  const [mistakeWords, setMistakeWords] = useState([]);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const ayahDataRef = useRef({
    textDisplay: '',
    textCompare: '',
    words: [],
    isDisconnectedLetters: false,
  });
  const nextAyahCacheRef = useRef(null); // { index, data } — prefetched next ayah
  const currentAyahIndexRef = useRef(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const getExpectedWordCount = useCallback(() => {
    return ayahDataRef.current.words.length;
  }, []);

  const loadAyah = useCallback(async (ayahIndex) => {
    const ayahNumber = START_AYAH + ayahIndex;

    // Use prefetched data if it matches what we need
    if (nextAyahCacheRef.current?.index === ayahIndex) {
      ayahDataRef.current = nextAyahCacheRef.current.data;
      nextAyahCacheRef.current = null;
    } else {
      const data = await getAyah(SURAH_NUMBER, ayahNumber);
      ayahDataRef.current = data;
    }

    // Kick off background prefetch of the next ayah
    const prefetchIndex = ayahIndex + 1;
    if (prefetchIndex < TOTAL_AYAHS) {
      getAyah(SURAH_NUMBER, START_AYAH + prefetchIndex)
        .then((data) => {
          nextAyahCacheRef.current = { index: prefetchIndex, data };
        })
        .catch(() => {}); // silent — will fetch on demand if prefetch fails
    }
  }, []);

  const onAyahComplete = useCallback(
    async (accumulatedText) => {
      if (ayahDataRef.current.isDisconnectedLetters) {
        setConfirmedAyahs((prev) => [
          ...prev,
          {
            textDisplay: ayahDataRef.current.textDisplay,
            status: 'correct',
          },
        ]);
        const nextIndex = currentAyahIndexRef.current + 1;
        if (nextIndex >= TOTAL_AYAHS) {
          setSessionComplete(true);
          await stopRealtime();
          return;
        }
        currentAyahIndexRef.current = nextIndex;
        setCurrentAyahIndex(nextIndex);
        await loadAyah(nextIndex);
        return;
      }

      const { textDisplay, textCompare, words } = ayahDataRef.current;
      const diff = wordDiff(
        normalizeArabic(textCompare),
        normalizeArabic(accumulatedText)
      );

      const wrongEntries = diff.filter(
        (item) => item.status === 'wrong' || item.status === 'missing'
      );
      const allCorrect = wrongEntries.length === 0;

      if (allCorrect) {
        setMistakeWords([]);
      } else {
        const wrongForDisplay = diff
          .map((item, index) => ({
            ...item,
            displayWord: words[index]?.textDisplay ?? item.word,
          }))
          .filter((item) => item.status === 'wrong' || item.status === 'missing')
          .map((item) => item.displayWord);
        setMistakeWords(wrongForDisplay);
        console.log('Mistake words:', wrongForDisplay);
      }

      setConfirmedAyahs((prev) => [
        ...prev,
        {
          textDisplay,
          status: allCorrect ? 'correct' : 'mistake',
        },
      ]);

      const nextIndex = currentAyahIndexRef.current + 1;
      if (nextIndex >= TOTAL_AYAHS) {
        setSessionComplete(true);
        await stopRealtime();
        return;
      }

      currentAyahIndexRef.current = nextIndex;
      setCurrentAyahIndex(nextIndex);
      await loadAyah(nextIndex);
    },
    [loadAyah]
  );

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);
        await loadAyah(0);
        if (!mounted) {
          return;
        }
        await startRealtime(getExpectedWordCount, onAyahComplete);
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
      stopRealtime();
    };
  }, [loadAyah, getExpectedWordCount, onAyahComplete]);

  useEffect(() => {
    currentAyahIndexRef.current = currentAyahIndex;
  }, [currentAyahIndex]);

  useEffect(() => {
    if (sessionComplete || isLoading || error) {
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
  }, [sessionComplete, isLoading, error, pulseAnim]);

  const handleStopSession = async () => {
    await stopRealtime();
    setSessionComplete(true);
  };

  const displayAyahNumber = Math.min(currentAyahIndex + 1, TOTAL_AYAHS);
  const isListening = !sessionComplete && !isLoading && !error;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Recitation</Text>
      <Text style={styles.subtitle}>Al-Baqarah 2:1–7</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.mushafFrame}>
        {confirmedAyahs.map((ayah, index) => (
          <Text
            key={`confirmed-${index}`}
            style={[
              styles.ayahLine,
              ayah.status === 'mistake'
                ? styles.ayahMistake
                : styles.ayahCorrect,
            ]}
          >
            {ayah.textDisplay}
          </Text>
        ))}
      </View>

      <View style={styles.micSection}>
        {isLoading ? (
          <ActivityIndicator size="large" />
        ) : (
          <Animated.Text
            style={[styles.micIcon, { opacity: isListening ? pulseAnim : 1 }]}
          >
            🎤
          </Animated.Text>
        )}
      </View>

      <Text style={styles.progress}>
        {sessionComplete
          ? 'Session complete'
          : `Ayah ${displayAyahNumber} of ${TOTAL_AYAHS}`}
      </Text>

      <Button
        title="Stop Session"
        onPress={handleStopSession}
        disabled={sessionComplete || isLoading}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 64,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },
  error: {
    color: '#c00',
    marginBottom: 16,
  },
  mushafFrame: {
    borderWidth: 2,
    borderColor: '#2e7d32',
    borderRadius: 8,
    padding: 20,
    minHeight: 200,
    marginBottom: 24,
    backgroundColor: '#fafaf8',
  },
  ayahLine: {
    fontSize: 22,
    lineHeight: 40,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 8,
  },
  ayahCorrect: {
    color: '#1b5e20',
  },
  ayahMistake: {
    color: '#c62828',
  },
  micSection: {
    alignItems: 'center',
    minHeight: 100,
    marginBottom: 24,
  },
  micIcon: {
    fontSize: 48,
  },
  progress: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
    color: '#333',
  },
});
