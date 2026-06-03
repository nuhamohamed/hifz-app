import { useCallback, useEffect, useRef, useState } from 'react';
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
import { getAyah } from '../lib/quranApi';
import { supabase } from '../lib/supabase';
import { startListening, stopListening } from '../lib/silenceDetection';

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

async function transcribeWithElevenLabs(uri) {
  const apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('EXPO_PUBLIC_ELEVENLABS_API_KEY is not set in .env');
  }

  const formData = new FormData();
  formData.append('file', {
    uri,
    type: 'audio/m4a',
    name: 'recording.m4a',
  });
  formData.append('model_id', 'scribe_v2');
  formData.append('language_code', 'ara');

  const response = await fetch(ELEVENLABS_STT_URL, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMessage =
      typeof data.detail === 'string'
        ? data.detail
        : `Transcription failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return data.text ?? '';
}

export default function RecitationScreen(props) {
  const params = props.route?.params ?? props;
  const {
    surahNumber,
    startAyah,
    endAyah,
    sessionId,
    resumeFromAyah = startAyah,
  } = params;

  const navigation = useNavigation();
  const totalAyahs = endAyah - startAyah + 1;
  const initialAyahIndex = resumeFromAyah - startAyah;
  const [currentAyahIndex, setCurrentAyahIndex] = useState(initialAyahIndex);
  const [confirmedAyahs, setConfirmedAyahs] = useState([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
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
  const mistakeStateRef = useRef('none'); // 'none' | 'awaiting_retry' | 'tier2_readback'
  const wrongIndicesRef = useRef([]);
  const [mistakeMessage, setMistakeMessage] = useState('');
  const [tier2AyahDisplay, setTier2AyahDisplay] = useState('');
  const [tier2TranscribedText, setTier2TranscribedText] = useState('');
  const [tier2HighlightIndices, setTier2HighlightIndices] = useState([]);
  const currentAyahIndexRef = useRef(initialAyahIndex);
  const startedRef = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const onClipRecorded = useCallback(async (uri) => {
    setIsTranscribing(true);
    try {
      return await transcribeWithElevenLabs(uri);
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const getExpectedWordCount = useCallback(() => {
    return ayahDataRef.current.words.length;
  }, []);

  const loadAyah = useCallback(async (ayahIndex) => {
    const ayahNumber = startAyah + ayahIndex;

    // Use prefetched data if it matches what we need
    if (nextAyahCacheRef.current?.index === ayahIndex) {
      ayahDataRef.current = nextAyahCacheRef.current.data;
      nextAyahCacheRef.current = null;
    } else {
      const data = await getAyah(surahNumber, ayahNumber);
      ayahDataRef.current = data;
    }

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

  const onAyahComplete = useCallback(
    async (accumulatedText) => {
      if (ayahDataRef.current.isDisconnectedLetters) {
        const capturedDisplay = ayahDataRef.current.textCompare;
        setConfirmedAyahs((prev) => [
          ...prev,
          {
            textDisplay: capturedDisplay,
            status: 'correct',
          },
        ]);
        await supabase
          .from('sessions')
          .update({
            last_confirmed_ayah: startAyah + currentAyahIndexRef.current,
          })
          .eq('id', sessionId);
        const nextIndex = currentAyahIndexRef.current + 1;
        if (nextIndex >= totalAyahs) {
          setSessionComplete(true);
          await supabase
            .from('sessions')
            .update({
              status: 'complete',
              completed_at: new Date().toISOString(),
            })
            .eq('id', sessionId);
          await stopListening();
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

      const wrongForDisplay = diff
        .map((item, index) => ({
          ...item,
          displayWord: words[index]?.textDisplay ?? item.word,
        }))
        .filter((item) => item.status === 'wrong' || item.status === 'missing')
        .map((item) => item.displayWord);

      const wrongIndices = diff
        .map((item, i) =>
          item.status === 'wrong' || item.status === 'missing' ? i : -1
        )
        .filter((i) => i >= 0);

      // --- Mistake state machine ---

      if (mistakeStateRef.current === 'none') {
        if (allCorrect) {
          setMistakeMessage('');
          setConfirmedAyahs((prev) => [
            ...prev,
            { textDisplay, status: 'correct' },
          ]);
          await supabase
            .from('sessions')
            .update({
              last_confirmed_ayah: startAyah + currentAyahIndexRef.current,
            })
            .eq('id', sessionId);
          const nextIndex = currentAyahIndexRef.current + 1;
          if (nextIndex >= totalAyahs) {
            setSessionComplete(true);
            await supabase
              .from('sessions')
              .update({
                status: 'complete',
                completed_at: new Date().toISOString(),
              })
              .eq('id', sessionId);
            await stopListening();
            return;
          }
          currentAyahIndexRef.current = nextIndex;
          setCurrentAyahIndex(nextIndex);
          await loadAyah(nextIndex);
        } else {
          wrongIndicesRef.current = wrongIndices;
          mistakeStateRef.current = 'awaiting_retry';
          await buzzAndTone();
          setMistakeMessage(
            'Possible mistake detected — please try again.'
          );
        }
        return;
      }

      if (mistakeStateRef.current === 'awaiting_retry') {
        if (allCorrect) {
          mistakeStateRef.current = 'none';
          setMistakeMessage('');
          setConfirmedAyahs((prev) => [
            ...prev,
            {
              textDisplay,
              status: 'correct',
              wrongIndices: wrongIndicesRef.current,
            },
          ]);
          // TODO: insert into quiz_cards at Box 0 — deferred until Supabase wiring sprint
          await supabase
            .from('sessions')
            .update({
              last_confirmed_ayah: startAyah + currentAyahIndexRef.current,
            })
            .eq('id', sessionId);
          const nextIndex = currentAyahIndexRef.current + 1;
          if (nextIndex >= totalAyahs) {
            setSessionComplete(true);
            await supabase
              .from('sessions')
              .update({
                status: 'complete',
                completed_at: new Date().toISOString(),
              })
              .eq('id', sessionId);
            await stopListening();
            return;
          }
          currentAyahIndexRef.current = nextIndex;
          setCurrentAyahIndex(nextIndex);
          await loadAyah(nextIndex);
        } else {
          wrongIndicesRef.current = wrongIndices;
          mistakeStateRef.current = 'tier2_readback';
          setMistakeMessage('');
          setTier2TranscribedText(accumulatedText);
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
          {
            textDisplay,
            status: 'mistake',
            wrongIndices: wrongIndicesRef.current,
          },
        ]);
        // TODO: insert into quiz_cards at Box 0, increment juz mistake count — deferred
        const nextIndex = currentAyahIndexRef.current + 1;
        if (nextIndex >= totalAyahs) {
          setSessionComplete(true);
          await supabase
            .from('sessions')
            .update({
              status: 'complete',
              completed_at: new Date().toISOString(),
            })
            .eq('id', sessionId);
          await stopListening();
          return;
        }
        currentAyahIndexRef.current = nextIndex;
        setCurrentAyahIndex(nextIndex);
        await loadAyah(nextIndex);
        return;
      }
    },
    [loadAyah, buzzAndTone, startAyah, sessionId, totalAyahs]
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);

        if (resumeFromAyah > startAyah) {
          const priorConfirmed = [];
          for (let ayah = startAyah; ayah < resumeFromAyah; ayah++) {
            const data = await getAyah(surahNumber, ayah);
            priorConfirmed.push({
              textDisplay: data.isDisconnectedLetters
                ? data.textCompare
                : data.textDisplay,
              status: 'correct',
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
        await startListening(
          onClipRecorded,
          getExpectedWordCount,
          onAyahComplete
        );
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
    onClipRecorded,
    getExpectedWordCount,
    onAyahComplete,
    initialAyahIndex,
    resumeFromAyah,
    startAyah,
    surahNumber,
  ]);

  useEffect(() => {
    currentAyahIndexRef.current = currentAyahIndex;
  }, [currentAyahIndex]);

  useEffect(() => {
    if (isTranscribing || sessionComplete || isLoading || error) {
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
  }, [isTranscribing, sessionComplete, isLoading, error, pulseAnim]);

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

  const handleBackToHome = () => {
    navigation.navigate('Today');
  };

  const displayAyahNumber = Math.min(currentAyahIndex + 1, totalAyahs);
  const isListening = !sessionComplete && !isLoading && !error;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Recitation</Text>
      <Text style={styles.subtitle}>Al-Baqarah 2:1–7</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.mushafFrame}>
        {confirmedAyahs.map((ayah, index) => {
          const hasWrongWords =
            ayah.wrongIndices && ayah.wrongIndices.length > 0;
          if (!hasWrongWords) {
            return (
              <Text
                key={`confirmed-${index}`}
                style={[styles.ayahLine, styles.ayahCorrect]}
              >
                {ayah.textDisplay}
              </Text>
            );
          }
          const wrongSet = new Set(ayah.wrongIndices);
          return (
            <Text
              key={`confirmed-${index}`}
              style={[styles.ayahLine, styles.ayahCorrect]}
            >
              {ayah.textDisplay.split(/\s+/).map((word, wi) => (
                <Text
                  key={wi}
                  style={
                    wrongSet.has(wi)
                      ? styles.mushafWordWrong
                      : styles.mushafWordCorrect
                  }
                >
                  {word}{' '}
                </Text>
              ))}
            </Text>
          );
        })}
      </View>

      {mistakeMessage && !sessionComplete ? (
        <Text style={styles.mistakeMessage}>{mistakeMessage}</Text>
      ) : null}

      {tier2AyahDisplay && !sessionComplete ? (
        <View style={styles.tier2Frame}>
          <Text style={styles.tier2Label}>What you said:</Text>
          <Text style={styles.tier2TranscribedText}>{tier2TranscribedText}</Text>
          <Text style={styles.tier2Label}>Correct:</Text>
          <Text style={styles.tier2AyahText}>
            {(() => {
              const wrongSet = new Set(tier2HighlightIndices);
              return tier2AyahDisplay.split(/\s+/).map((word, i) => (
                <Text
                  key={i}
                  style={
                    wrongSet.has(i)
                      ? styles.tier2WordWrong
                      : styles.tier2WordCorrect
                  }
                >
                  {word}{' '}
                </Text>
              ));
            })()}
          </Text>
        </View>
      ) : null}

      <View style={styles.micSection}>
        {sessionComplete ? (
          <View style={styles.sessionCompleteSection}>
            <Text style={styles.sessionCompleteTitle}>Session Complete</Text>
            <TouchableOpacity
              style={styles.backToHomeButton}
              onPress={handleBackToHome}
              activeOpacity={0.8}
            >
              <Text style={styles.backToHomeButtonText}>Back to Home</Text>
            </TouchableOpacity>
          </View>
        ) : isLoading ? (
          <ActivityIndicator size="large" />
        ) : (
          <>
            <Animated.Text
              style={[styles.micIcon, { opacity: isListening ? pulseAnim : 1 }]}
            >
              🎤
            </Animated.Text>
            {isTranscribing ? (
              <Text style={styles.checkingText}>checking...</Text>
            ) : null}
          </>
        )}
      </View>

      {!sessionComplete ? (
        <Text style={styles.progress}>
          {`Ayah ${displayAyahNumber} of ${totalAyahs}`}
        </Text>
      ) : null}

      {!sessionComplete ? (
        <TouchableOpacity
          style={[
            styles.endSessionButton,
            isLoading && styles.endSessionButtonDisabled,
          ]}
          onPress={handlePauseSession}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          <Text style={styles.endSessionButtonText}>Pause Session</Text>
        </TouchableOpacity>
      ) : null}
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
  mushafWordCorrect: {
    color: '#1b5e20',
  },
  mushafWordWrong: {
    color: '#c62828',
  },
  ayahMistake: {
    color: '#c62828',
  },
  mistakeMessage: {
    color: '#e65100',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '500',
  },
  tier2Frame: {
    borderWidth: 1,
    borderColor: '#c62828',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    backgroundColor: '#fff8f8',
  },
  tier2Label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  tier2TranscribedText: {
    fontSize: 18,
    lineHeight: 32,
    textAlign: 'right',
    writingDirection: 'rtl',
    color: '#757575',
    marginBottom: 16,
  },
  tier2AyahText: {
    fontSize: 22,
    lineHeight: 40,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  tier2WordWrong: {
    color: '#c62828',
  },
  tier2WordCorrect: {
    color: '#1b1b1b',
  },
  micSection: {
    alignItems: 'center',
    minHeight: 100,
    marginBottom: 24,
  },
  sessionCompleteSection: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  sessionCompleteTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1b5e20',
    marginBottom: 20,
  },
  backToHomeButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  backToHomeButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  micIcon: {
    fontSize: 48,
  },
  checkingText: {
    marginTop: 8,
    fontSize: 14,
    color: '#666',
  },
  progress: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
    color: '#333',
  },
  endSessionButton: {
    backgroundColor: '#c62828',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  endSessionButtonDisabled: {
    opacity: 0.5,
  },
  endSessionButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});
