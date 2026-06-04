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
import {
  checkMistakeHealing,
  fetchDueQuizItems,
  flagContextAyahIfNeeded,
  updateQuizResult,
} from '../lib/quizEngine';
import { getAyah } from '../lib/quranApi';
import { supabase } from '../lib/supabase';
import { startListening, stopListening } from '../lib/silenceDetection';

const HARDCODED_USER_ID = '87ec942f-de08-4f9b-afe4-a33e31af56c5';

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

async function loadContextBlock(surahNumber, centerAyah) {
  const start = Math.max(1, centerAyah - 2);
  let end = centerAyah + 1;

  try {
    await getAyah(surahNumber, end);
  } catch {
    end = centerAyah;
  }

  const ayahNumbers = [];
  for (let n = start; n <= end; n++) {
    ayahNumbers.push(n);
  }

  const block = [];
  for (const ayahNumber of ayahNumbers) {
    const data = await getAyah(surahNumber, ayahNumber);
    block.push({ ayahNumber, ...data });
  }

  return block;
}

function getStartingCue(block) {
  if (!block.length) {
    return '';
  }
  const first = block[0];
  const text = first.isDisconnectedLetters
    ? first.textCompare
    : first.textDisplay;
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 3).join(' ');
}

export default function PreSessionQuizScreen(props) {
  const navigation = useNavigation();
  const sessionParams = props.route?.params ?? {};
  const { sessionId, juzNumber: sessionJuzNumber = 1 } = sessionParams;

  const [quizItems, setQuizItems] = useState([]);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [confirmedAyahs, setConfirmedAyahs] = useState([]);
  const [startingCue, setStartingCue] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTransition, setShowTransition] = useState(false);
  const [showNextItemTransition, setShowNextItemTransition] = useState(false);

  const blockAyahsRef = useRef([]);
  const targetAyahIndexRef = useRef(0);
  const targetAyahResultRef = useRef(null);
  const ayahDataRef = useRef({
    textDisplay: '',
    textCompare: '',
    words: [],
    isDisconnectedLetters: false,
  });
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const currentBlockIndexRef = useRef(0);
  const currentItemIndexRef = useRef(0);
  const mistakeStateRef = useRef('none');
  const wrongIndicesRef = useRef([]);
  const [mistakeMessage, setMistakeMessage] = useState('');
  const [tier2AyahDisplay, setTier2AyahDisplay] = useState('');
  const [tier2TranscribedText, setTier2TranscribedText] = useState('');
  const [tier2HighlightIndices, setTier2HighlightIndices] = useState([]);
  const startedRef = useRef(false);
  const onClipRecordedRef = useRef(null);
  const getExpectedWordCountRef = useRef(null);
  const onAyahCompleteRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const currentItem = quizItems[currentItemIndex];
  const blockLength = blockAyahsRef.current.length;

  const navigateToRecitation = useCallback(async () => {
    if (sessionParams.sessionId) {
      await supabase
        .from('sessions')
        .update({ phase: 'revision' })
        .eq('id', sessionParams.sessionId);
    }
    navigation.replace('Recitation', sessionParams);
  }, [navigation, sessionParams]);

  const finishAllQuizItems = useCallback(async () => {
    await stopListening();
    if (sessionParams.sessionId) {
      await supabase
        .from('sessions')
        .update({ phase: 'revision' })
        .eq('id', sessionParams.sessionId);
    }
    setShowTransition(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();
    setTimeout(() => {
      navigation.replace('Recitation', sessionParams);
    }, 3500);
  }, [fadeAnim, navigation, sessionParams]);

  const loadBlockForItem = useCallback(async (item) => {
    const block = await loadContextBlock(item.surah_number, item.ayah_number);
    blockAyahsRef.current = block;
    targetAyahIndexRef.current = block.findIndex(
      (b) => b.ayahNumber === item.ayah_number
    );
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
    setStartingCue(getStartingCue(block));

    const first = block[0];
    ayahDataRef.current = {
      textDisplay: first.textDisplay,
      textCompare: first.textCompare,
      words: first.words,
      isDisconnectedLetters: first.isDisconnectedLetters,
    };
  }, []);

  const loadBlockAyah = useCallback((blockIndex) => {
    const entry = blockAyahsRef.current[blockIndex];
    if (!entry) {
      return;
    }
    ayahDataRef.current = {
      textDisplay: entry.textDisplay,
      textCompare: entry.textCompare,
      words: entry.words,
      isDisconnectedLetters: entry.isDisconnectedLetters,
    };
  }, []);

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
      if (result === 'correct_first') {
        await checkMistakeHealing(
          HARDCODED_USER_ID,
          item.surah_number,
          item.ayah_number,
          sessionJuzNumber
        );
      }

      const nextItemIndex = currentItemIndexRef.current + 1;
      if (nextItemIndex >= quizItems.length) {
        await finishAllQuizItems();
        return;
      }

      setShowNextItemTransition(true);
      await new Promise((resolve) => setTimeout(resolve, 2500));
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
  }, [
    quizItems,
    loadBlockAyah,
    loadBlockForItem,
    finishAllQuizItems,
    sessionJuzNumber,
  ]);

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
      const isTargetAyah =
        currentBlockIndexRef.current === targetAyahIndexRef.current;

      if (ayahDataRef.current.isDisconnectedLetters) {
        const capturedDisplay = ayahDataRef.current.textCompare;
        setConfirmedAyahs((prev) => [
          ...prev,
          { textDisplay: capturedDisplay, status: 'correct' },
        ]);
        if (isTargetAyah && targetAyahResultRef.current === null) {
          recordTargetAyahResult('correct_first');
        }
        await advanceToNextBlockAyah();
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

      const wrongIndices = diff
        .map((item, i) =>
          item.status === 'wrong' || item.status === 'missing' ? i : -1
        )
        .filter((i) => i >= 0);

      if (mistakeStateRef.current === 'none') {
        if (allCorrect) {
          setMistakeMessage('');
          setConfirmedAyahs((prev) => [
            ...prev,
            { textDisplay, status: 'correct' },
          ]);
          if (isTargetAyah) {
            recordTargetAyahResult('correct_first');
          }
          await advanceToNextBlockAyah();
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
          if (isTargetAyah) {
            recordTargetAyahResult('correct_second');
          } else if (wrongIndicesRef.current.length > 0) {
            const blockEntry =
              blockAyahsRef.current[currentBlockIndexRef.current];
            const item = quizItems[currentItemIndexRef.current];
            if (blockEntry && item) {
              await flagContextAyahIfNeeded(
                HARDCODED_USER_ID,
                item.surah_number,
                blockEntry.ayahNumber
              );
            }
          }
          await advanceToNextBlockAyah();
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
        if (isTargetAyah) {
          recordTargetAyahResult('wrong');
        }
        await advanceToNextBlockAyah();
      }
    },
    [advanceToNextBlockAyah, buzzAndTone, quizItems, recordTargetAyahResult]
  );

  onClipRecordedRef.current = onClipRecorded;
  getExpectedWordCountRef.current = getExpectedWordCount;
  onAyahCompleteRef.current = onAyahComplete;

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);
        const items = await fetchDueQuizItems(HARDCODED_USER_ID);
        console.log('Quiz items fetched:', JSON.stringify(items));

        if (!mounted) {
          return;
        }

        if (items.length === 0) {
          await navigateToRecitation();
          return;
        }

        setQuizItems(items);
        currentItemIndexRef.current = 0;
        await loadBlockForItem(items[0]);

        if (!mounted) {
          return;
        }

        await startListening(
          (uri) => onClipRecordedRef.current(uri),
          () => getExpectedWordCountRef.current(),
          (accumulatedText) => onAyahCompleteRef.current(accumulatedText)
        );
      } catch (err) {
        if (mounted) {
          setError(err.message ?? 'Failed to start pre-session quiz.');
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
  }, [loadBlockForItem, navigateToRecitation]);

  useEffect(() => {
    if (isTranscribing || isLoading || error || showTransition || showNextItemTransition) {
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
  }, [isTranscribing, isLoading, error, showTransition, showNextItemTransition, pulseAnim]);

  useEffect(() => {
    currentBlockIndexRef.current = currentBlockIndex;
  }, [currentBlockIndex]);

  useEffect(() => {
    currentItemIndexRef.current = currentItemIndex;
  }, [currentItemIndex]);

  const displayAyahInBlock = currentBlockIndex + 1;
  const isListening =
    !isLoading && !error && !showTransition && !showNextItemTransition;

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

  if (showTransition) {
    return (
      <Animated.View
        style={[styles.transitionOverlay, { opacity: fadeAnim }]}
      >
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Pre-Session Quiz</Text>
      {currentItem ? (
        <Text style={styles.subtitle}>
          Item {currentItemIndex + 1} of {quizItems.length} — Ayah{' '}
          {currentItem.ayah_number}
        </Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {confirmedAyahs.length === 0 ? (
        <Text style={styles.reciteHint}>Recite from the grey ayah</Text>
      ) : null}

      <View style={styles.mushafFrame}>
        {startingCue ? (
          <Text style={styles.startingCue}>{startingCue}</Text>
        ) : null}
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

      {mistakeMessage ? (
        <Text style={styles.mistakeMessage}>{mistakeMessage}</Text>
      ) : null}

      {tier2AyahDisplay ? (
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
        {isLoading ? (
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

      {blockLength > 0 ? (
        <Text style={styles.progress}>
          {`Ayah ${displayAyahInBlock} of ${blockLength} in this quiz`}
        </Text>
      ) : null}

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
  reciteHint: {
    fontSize: 13,
    color: '#757575',
    textAlign: 'center',
    marginBottom: 8,
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
  startingCue: {
    fontSize: 22,
    lineHeight: 40,
    textAlign: 'right',
    writingDirection: 'rtl',
    color: '#757575',
    marginBottom: 12,
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
