import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getCurrentUserId } from '../lib/auth';
import { getAyahLocation, getJuzTotalAyahs } from '../lib/juzSurahMap';
import { getTodayPortion } from '../lib/planEngine';
import {
  scheduleDailyNotification,
  scheduleOverdueNotification,
} from '../lib/notifications';
import { supabase } from '../lib/supabase';

function getTodayDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildSessionParams(sessionId, resumeFromAyah, portion) {
  const juzNumber = portion.juzNumber ?? 1;
  const start = getAyahLocation(juzNumber, portion.portionStartAyah);
  const end = getAyahLocation(juzNumber, portion.portionEndAyah);
  return {
    surahNumber: start.surahNumber,
    startAyah: start.ayahNumber,
    endAyah: end.ayahNumber,
    juzNumber,
    totalAyahsInJuz: getJuzTotalAyahs(juzNumber),
    sessionId,
    resumeFromAyah,
  };
}

function formatPortionDisplay(todayPortion) {
  if (!todayPortion) {
    return null;
  }
  if (todayPortion.type === 'quiz_only') {
    return 'Quiz only — no revision today';
  }
  const { juzNumber, portionStartAyah, portionEndAyah } = todayPortion;
  const start = getAyahLocation(juzNumber, portionStartAyah);
  const end = getAyahLocation(juzNumber, portionEndAyah);
  if (start.surahNumber === end.surahNumber) {
    return `Juz ${juzNumber}: ${start.surahName} ${start.ayahNumber}–${end.ayahNumber}`;
  }
  return `Juz ${juzNumber}: ${start.surahName} ${start.ayahNumber} to ${end.surahName} ${end.ayahNumber}`;
}

function estimateSessionMinutes(todayPortion, quizCount) {
  let mins = 0;
  if (todayPortion && todayPortion.type !== 'quiz_only') {
    const ayahCount =
      todayPortion.portionEndAyah - todayPortion.portionStartAyah + 1;
    mins += ayahCount * 1;
  }
  mins += (quizCount ?? 0) * 1;
  const rounded = Math.max(5, Math.ceil(mins / 5) * 5);
  return `~${rounded} mins`;
}

function getResumeHint(pausedSession) {
  if (!pausedSession) {
    return null;
  }
  const phase = pausedSession.phase ?? 'pre_quiz';
  if (phase === 'pre_quiz') {
    return 'Resuming pre-session quiz';
  }
  if (phase === 'revision') {
    return `Resuming revision from Ayah ${(pausedSession.last_confirmed_ayah ?? 0) + 1}`;
  }
  if (phase === 'post_quiz') {
    return 'Resuming post-session quiz';
  }
  return null;
}

export default function TodayScreen() {
  const navigation = useNavigation();
  const [todayPortion, setTodayPortion] = useState(null);
  const [quizCount, setQuizCount] = useState(0);
  const [portionLoading, setPortionLoading] = useState(true);
  const [pausedSession, setPausedSession] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');
  const notificationsScheduledRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setPortionLoading(true);
        setError('');

        const today = getTodayDateString();
        const userId = await getCurrentUserId();

        const [portion, pausedResult, quizResult] = await Promise.all([
          getTodayPortion(userId),
          supabase
            .from('sessions')
            .select(
              'id, last_confirmed_ayah, phase, juz_number, portion_start_ayah, portion_end_ayah'
            )
            .eq('user_id', userId)
            .eq('status', 'paused')
            .eq('date', today)
            .maybeSingle(),
          supabase
            .from('quiz_queue')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .lte('next_review_date', today),
        ]);

        if (!mounted) {
          return;
        }

        setTodayPortion(portion);
        setQuizCount(quizResult.count ?? 0);

        if (!notificationsScheduledRef.current) {
          notificationsScheduledRef.current = true;
          try {
            if (portion.type === 'quiz_only') {
              await scheduleDailyNotification(9, 0, null, null, null);
            } else {
              const { juzNumber, portionStartAyah, portionEndAyah } = portion;
              const start = getAyahLocation(juzNumber, portionStartAyah);
              const end = getAyahLocation(juzNumber, portionEndAyah);
              await scheduleDailyNotification(
                9,
                0,
                start.surahName,
                start.ayahNumber,
                end.ayahNumber
              );
            }

            if (
              portion.scheduledDate &&
              portion.scheduledDate < today
            ) {
              await scheduleOverdueNotification();
            }
          } catch (notifErr) {
            console.warn('Failed to schedule notifications:', notifErr);
          }
        }

        if (!pausedResult.error && pausedResult.data) {
          setPausedSession(pausedResult.data);
        }
      } catch (err) {
        if (mounted) {
          setError(err.message ?? 'Failed to load today\'s plan.');
        }
      } finally {
        if (mounted) {
          setPortionLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const navigateForPausedSession = (session) => {
    const resumeFromAyah = (session.last_confirmed_ayah ?? 0) + 1;
    const params = buildSessionParams(session.id, resumeFromAyah, {
      juzNumber: session.juz_number ?? 1,
      portionStartAyah: session.portion_start_ayah,
      portionEndAyah: session.portion_end_ayah,
    });
    const phase = session.phase ?? 'pre_quiz';

    if (phase === 'pre_quiz') {
      navigation.navigate('PreSessionQuiz', params);
    } else if (phase === 'revision') {
      navigation.navigate('Recitation', params);
    } else if (phase === 'post_quiz') {
      navigation.navigate('PostSessionQuiz', params);
    } else {
      navigation.navigate('Recitation', params);
    }
  };

  const handleStartSession = async () => {
    setIsStarting(true);
    setError('');

    try {
      const today = getTodayDateString();
      const userId = await getCurrentUserId();

      const { data: paused, error: fetchError } = await supabase
        .from('sessions')
        .select(
          'id, last_confirmed_ayah, phase, juz_number, portion_start_ayah, portion_end_ayah'
        )
        .eq('user_id', userId)
        .eq('status', 'paused')
        .eq('date', today)
        .maybeSingle();

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      if (paused) {
        navigateForPausedSession(paused);
        return;
      }

      if (!todayPortion || todayPortion.type === 'quiz_only') {
        const { data: newSession, error: insertError } = await supabase
          .from('sessions')
          .insert({
            user_id: userId,
            date: today,
            status: 'in_progress',
            phase: 'pre_quiz',
            juz_number: 1,
            portion_start_ayah: 1,
            portion_end_ayah: 1,
            last_confirmed_ayah: 0,
            started_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (insertError) {
          throw new Error(insertError.message);
        }

        navigation.navigate(
          'PreSessionQuiz',
          buildSessionParams(newSession.id, 1, {
            juzNumber: 1,
            portionStartAyah: 1,
            portionEndAyah: 1,
          })
        );
        return;
      }

      const startLoc = getAyahLocation(
        todayPortion.juzNumber,
        todayPortion.portionStartAyah
      );

      const { data: newSession, error: insertError } = await supabase
        .from('sessions')
        .insert({
          user_id: userId,
          date: today,
          status: 'in_progress',
          phase: 'pre_quiz',
          juz_number: todayPortion.juzNumber,
          portion_start_ayah: todayPortion.portionStartAyah,
          portion_end_ayah: todayPortion.portionEndAyah,
          last_confirmed_ayah: startLoc.ayahNumber - 1,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }
      navigation.navigate(
        'PreSessionQuiz',
        buildSessionParams(newSession.id, startLoc.ayahNumber, todayPortion)
      );
    } catch (err) {
      setError(err.message ?? 'Failed to start session.');
    } finally {
      setIsStarting(false);
    }
  };

  const resumeHint = getResumeHint(pausedSession);
  const portionDisplay = formatPortionDisplay(todayPortion);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Today's Revision</Text>

      <View style={styles.card}>
        <Text style={styles.portionLabel}>Today's portion</Text>
        {portionLoading ? (
          <ActivityIndicator
            size="small"
            color="#2e7d32"
            style={styles.portionLoader}
          />
        ) : (
          <Text style={styles.portionText}>
            {portionDisplay ?? 'Unable to load portion'}
          </Text>
        )}
        <Text style={styles.timeText}>
          {estimateSessionMinutes(todayPortion, quizCount)}
        </Text>
      </View>

      {resumeHint ? (
        <Text style={styles.resumeHint}>{resumeHint}</Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isStarting || portionLoading ? (
        <ActivityIndicator size="large" style={styles.loader} />
      ) : (
        <View style={styles.buttonWrap}>
          <Button
            title={pausedSession ? 'Resume Session' : 'Start Session'}
            onPress={handleStartSession}
          />
        </View>
      )}

      {/* DEV ONLY — remove before release */}
      <View style={styles.buttonWrap}>
        <Button
          title="[Dev] Test Recitation (Al-Baqarah 1–7)"
          color="#888"
          onPress={() =>
            navigation.navigate('Recitation', {
              surahNumber: 2,
              startAyah: 1,
              endAyah: 7,
              sessionId: null,
              juzNumber: 1,
              totalAyahsInJuz: 7,
              resumeFromAyah: 1,
            })
          }
        />
      </View>
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
  portionLoader: {
    alignSelf: 'flex-start',
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
