import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Audio } from 'expo-av';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

export default function WhisperTest() {
  const recordingRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [error, setError] = useState('');

  async function startRecording() {
    try {
      setError('');
      setTranscription('');

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

      const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('EXPO_PUBLIC_OPENAI_API_KEY is not set in .env');
      }

      const filename = uri.split('/').pop() ?? 'recording.m4a';
      const formData = new FormData();
      formData.append('file', {
        uri,
        type: Platform.OS === 'ios' ? 'audio/m4a' : 'audio/mp4',
        name: filename,
      });
      formData.append('model', 'whisper-1');
      formData.append('language', 'ar');

      const response = await fetch(WHISPER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error?.message ?? `Transcription failed (${response.status})`
        );
      }

      setTranscription(data.text ?? '');
    } catch (err) {
      setError(err.message ?? 'Transcription failed.');
    } finally {
      setIsTranscribing(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Whisper Test</Text>
      <Text style={styles.subtitle}>Record Arabic audio and transcribe with OpenAI</Text>

      <View style={styles.buttons}>
        <Button
          title="Start Recording"
          onPress={startRecording}
          disabled={isRecording || isTranscribing}
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
    marginBottom: 32,
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
});
