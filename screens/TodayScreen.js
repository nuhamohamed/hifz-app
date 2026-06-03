import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const HARDCODED_USER_ID = '87ec942f-de08-4f9b-afe4-a33e31af56c5';

const SURAH_NUMBER = 2;
const START_AYAH = 1;
const END_AYAH = 7;

function getTodayDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function TodayScreen() {
  const navigation = useNavigation();
  const [pausedSession, setPausedSession] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const today = getTodayDateString();

      const { data, error: fetchError } = await supabase
        .from('sessions')
        .select('id, last_confirmed_ayah')
        .eq('user_id', HARDCODED_USER_ID)
        .eq('status', 'paused')
        .eq('date', today)
        .maybeSingle();

      if (!fetchError && data) {
        setPausedSession(data);
      }
    })();
  }, []);

  const navigateToRecitation = (sessionId, resumeFromAyah) => {
    navigation.navigate('Recitation', {
      surahNumber: SURAH_NUMBER,
      startAyah: START_AYAH,
      endAyah: END_AYAH,
      sessionId,
      resumeFromAyah,
    });
  };

  const handleStartSession = async () => {
    setIsStarting(true);
    setError('');

    try {
      const today = getTodayDateString();

      const { data: pausedSession, error: fetchError } = await supabase
        .from('sessions')
        .select('id, last_confirmed_ayah')
        .eq('user_id', HARDCODED_USER_ID)
        .eq('status', 'paused')
        .eq('date', today)
        .maybeSingle();

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      if (pausedSession) {
        const resumeFromAyah = (pausedSession.last_confirmed_ayah ?? 0) + 1;
        navigateToRecitation(pausedSession.id, resumeFromAyah);
        return;
      }

      const { data: newSession, error: insertError } = await supabase
        .from('sessions')
        .insert({
          user_id: HARDCODED_USER_ID,
          date: today,
          status: 'in_progress',
          juz_number: 1,
          portion_start_ayah: START_AYAH,
          portion_end_ayah: END_AYAH,
          last_confirmed_ayah: 0,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      navigateToRecitation(newSession.id, START_AYAH);
    } catch (err) {
      setError(err.message ?? 'Failed to start session.');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Today's Revision</Text>

      <View style={styles.card}>
        <Text style={styles.portionLabel}>Today's portion</Text>
        <Text style={styles.portionText}>Al-Baqarah 2:1–7</Text>
        <Text style={styles.timeText}>~5 mins</Text>
      </View>

      {pausedSession ? (
        <Text style={styles.resumeHint}>
          Resuming from Ayah {(pausedSession.last_confirmed_ayah ?? 0) + 1}
        </Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isStarting ? (
        <ActivityIndicator size="large" style={styles.loader} />
      ) : (
        <View style={styles.buttonWrap}>
          <Button
            title={pausedSession ? 'Resume Session' : 'Start Session'}
            onPress={handleStartSession}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    paddingTop: 64,
    backgroundColor: '#fff',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 32,
    textAlign: 'center',
    color: '#1b1b1b',
  },
  card: {
    backgroundColor: '#fafaf8',
    borderWidth: 2,
    borderColor: '#2e7d32',
    borderRadius: 12,
    padding: 24,
    marginBottom: 32,
  },
  portionLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  portionText: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1b5e20',
    marginBottom: 12,
  },
  timeText: {
    fontSize: 16,
    color: '#757575',
  },
  resumeHint: {
    fontSize: 15,
    color: '#e65100',
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '500',
  },
  error: {
    color: '#c00',
    textAlign: 'center',
    marginBottom: 16,
  },
  loader: {
    marginTop: 8,
  },
  buttonWrap: {
    paddingHorizontal: 16,
  },
});
