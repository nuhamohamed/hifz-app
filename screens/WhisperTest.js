import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import { normalizeArabic, wordDiff } from '../lib/arabicUtils';
import { getAyah } from '../lib/quranApi';

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

export default function WhisperTest() {
  const recordingRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isLoadingAyah, setIsLoadingAyah] = useState(true);
  const [expectedDisplay, setExpectedDisplay] = useState('');
  const [expectedCompare, setExpectedCompare] = useState('');
  const [ayahWords, setAyahWords] = useState([]);
  const [transcription, setTranscription] = useState('');
  const [wordResults, setWordResults] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setIsLoadingAyah(true);
        const { textDisplay, textCompare, words } = await getAyah(2, 255);
        setExpectedDisplay(textDisplay);
        setExpectedCompare(textCompare);
        setAyahWords(words);
      } catch (err) {
        setError(err.message ?? 'Failed to load expected ayah text.');
      } finally {
        setIsLoadingAyah(false);
      }
    })();
  }, []);

  async function startRecording() {
    try {
      setError('');
      setTranscription('');
      setWordResults(null);

      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone permission is required to record audio.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      setIsRecording(true);
    } catch (err) {
      setError(err.message ?? 'Failed to start recording.');
    }
  }

  async function stopAndTranscribe() {
    const recording = recordingRef.current;
    if (!recording) {
      return;
    }

    try {
      setIsTranscribing(true);
      setError('');
      setWordResults(null);

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });

      if (!uri) {
        throw new Error('No recording file was created.');
      }

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

      const whisperText = data.text ?? '';
      setTranscription(whisperText);

      if (expectedCompare) {
        const normalizedExpected = normalizeArabic(expectedCompare);
        const normalizedWhisper = normalizeArabic(whisperText);

        const diff = wordDiff(normalizedExpected, normalizedWhisper);
        setWordResults(
          diff.map((item, index) => ({
            status: item.status,
            word: ayahWords[index]?.textDisplay ?? item.word,
          }))
        );
      }
    } catch (err) {
      setError(err.message ?? 'Transcription failed.');
    } finally {
      setIsTranscribing(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Whisper Test</Text>
      <Text style={styles.subtitle}>Record Arabic audio and transcribe with ElevenLabs</Text>

      <View style={styles.expected}>
        <Text style={styles.resultLabel}>Expected (Ayat Al-Kursi 2:255)</Text>
        {isLoadingAyah ? (
          <ActivityIndicator style={styles.ayahLoader} />
        ) : (
          <Text style={styles.resultText}>{expectedDisplay}</Text>
        )}
      </View>

      <View style={styles.buttons}>
        <Button
          title="Start Recording"
          onPress={startRecording}
          disabled={isRecording || isTranscribing || isLoadingAyah}
        />
        <View style={styles.spacer} />
        <Button
          title="Stop & Transcribe"
          onPress={stopAndTranscribe}
          disabled={!isRecording || isTranscribing}
        />
      </View>

      {isRecording && <Text style={styles.status}>Recording…</Text>}

      {isTranscribing && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
          <Text style={styles.status}>Transcribing…</Text>
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {transcription ? (
        <View style={styles.result}>
          <Text style={styles.resultLabel}>Transcription</Text>
          <Text style={styles.resultText}>{transcription}</Text>
        </View>
      ) : null}

      {wordResults ? (
        <View style={styles.result}>
          <Text style={styles.resultLabel}>Word comparison</Text>
          <View style={styles.wordRow}>
            {wordResults.map((item, index) => (
              <View
                key={`${item.word}-${index}`}
                style={[
                  styles.wordChip,
                  item.status === 'correct'
                    ? styles.wordCorrect
                    : styles.wordWrong,
                ]}
              >
                <Text style={styles.wordChipText}>{item.word}</Text>
              </View>
            ))}
          </View>
        </View>
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },
  expected: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  ayahLoader: {
    marginTop: 8,
  },
  buttons: {
    marginBottom: 24,
  },
  spacer: {
    height: 12,
  },
  status: {
    fontSize: 16,
    color: '#333',
    marginTop: 8,
    textAlign: 'center',
  },
  loading: {
    alignItems: 'center',
    marginVertical: 16,
  },
  error: {
    color: '#c00',
    fontSize: 14,
    marginTop: 16,
  },
  result: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  resultLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  resultText: {
    fontSize: 18,
    lineHeight: 28,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  wordRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  wordChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  wordCorrect: {
    backgroundColor: '#c8e6c9',
  },
  wordWrong: {
    backgroundColor: '#ffcdd2',
  },
  wordChipText: {
    fontSize: 18,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
