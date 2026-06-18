import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentUserId } from '../lib/auth';
import { getAyahLocation, getJuzTotalAyahs } from '../lib/juzSurahMap';
import { getTodayPortion } from '../lib/planEngine';
import {
  cancelEveningNudge,
  scheduleDailyNotification,
  scheduleEveningNudge,
  scheduleTestNotification,
} from '../lib/notifications';
import { supabase } from '../lib/supabase';

function formatSessionDate(dateStr) {
  const [, month, day] = dateStr.split('-').map(Number);
  const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1];
  return `${monthName} ${day}`;
}

function getTodayDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getTomorrowDateString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTomorrowLine(tomorrow) {
  if (!tomorrow) return 'Tomorrow: Quiz only';
  if (tomorrow.type === 'quiz_only') return 'Tomorrow: Quiz only';
  const start = getAyahLocation(tomorrow.juz_number, tomorrow.portion_start_ayah);
  const end = getAyahLocation(tomorrow.juz_number, tomorrow.portion_end_ayah);
  if (start.surahNumber === end.surahNumber) {
    return `Tomorrow: Juz ${tomorrow.juz_number} — ${start.surahName} ${start.ayahNumber}–${end.ayahNumber}`;
  }
  return `Tomorrow: Juz ${tomorrow.juz_number} — ${start.surahName} ${start.ayahNumber} to ${end.surahName} ${end.ayahNumber}`;
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
  const [sessionDoneToday, setSessionDoneToday] = useState(false);
  const [tomorrowText, setTomorrowText] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');
  const [notifDenied, setNotifDenied] = useState(false);
  const notificationsScheduledRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setPortionLoading(true);
        setError('');

        const today = getTodayDateString();
        const userId = await getCurrentUserId();

        const [portion, pausedResult, quizResult, completedResult, tomorrowResult] = await Promise.all([
          getTodayPortion(userId),
          supabase
            .from('sessions')
            .select(
              'id, last_confirmed_ayah, phase, juz_number, portion_start_ayah, portion_end_ayah, date'
            )
            .eq('user_id', userId)
            .in('status', ['paused', 'in_progress'])
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('quiz_queue')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .lte('next_review_date', today),
          supabase
            .from('sessions')
            .select('id')
            .eq('user_id', userId)
            .eq('status', 'complete')
            .eq('date', today)
            .limit(1)
            .maybeSingle(),
          supabase
            .from('scheduled_portions')
            .select('juz_number, portion_start_ayah, portion_end_ayah, type')
            .eq('user_id', userId)
            .eq('scheduled_date', getTomorrowDateString())
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (!mounted) {
          return;
        }

        setTodayPortion(portion);
        setQuizCount(quizResult.count ?? 0);

        const isDone = !completedResult.error && !!completedResult.data;
        if (isDone) {
          setSessionDoneToday(true);
          setTomorrowText(formatTomorrowLine(tomorrowResult.data ?? null));
        }

        if (!notificationsScheduledRef.current) {
          notificationsScheduledRef.current = true;
          try {
            // Fetch the user's saved reminder time
            const { data: userData } = await supabase
              .from('users')
              .select('notification_time')
              .eq('id', userId)
              .maybeSingle();
            const [remHour, remMin] = userData?.notification_time
              ? userData.notification_time.split(':').map(Number)
              : [9, 0];
            await scheduleDailyNotification(remHour, remMin);

            const isOverdue = !!(portion.scheduledDate && portion.scheduledDate < today);
            if (isDone) {
              await cancelEveningNudge();
            } else {
              await scheduleEveningNudge(isOverdue);
            }
          } catch (notifErr) {
            console.warn('Failed to schedule notifications:', notifErr);
          }

          const { status } = await Notifications.getPermissionsAsync();
          if (mounted) setNotifDenied(status === 'denied');
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
          'id, last_confirmed_ayah, phase, juz_number, portion_start_ayah, portion_end_ayah, date'
        )
        .eq('user_id', userId)
        .in('status', ['paused', 'in_progress'])
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      if (paused) {
        if (paused.date !== today) {
          await supabase
            .from('sessions')
            .update({ date: today })
            .eq('id', paused.id);
        }
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
  const isCarriedOver = !!(pausedSession && pausedSession.date !== getTodayDateString());
  const carriedOverPortion = isCarriedOver
    ? {
        juzNumber: pausedSession.juz_number,
        portionStartAyah: pausedSession.portion_start_ayah,
        portionEndAyah: pausedSession.portion_end_ayah,
      }
    : null;
  const portionDisplay = formatPortionDisplay(carriedOverPortion ?? todayPortion);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Today's Revision</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          activeOpacity={0.7}
        >
          <Ionicons name="settings-outline" size={24} color="#2e7d32" />
        </TouchableOpacity>
      </View>

      {notifDenied && (
        <TouchableOpacity
          style={styles.notifBanner}
          onPress={() => Linking.openSettings()}
          activeOpacity={0.8}
        >
          <Text style={styles.notifBannerText}>
            Notifications are off — tap to enable reminders in Settings.
          </Text>
        </TouchableOpacity>
      )}

      {sessionDoneToday ? (
        <View style={styles.doneCard}>
          <Text style={styles.doneTitle}>All done for today!</Text>
          {tomorrowText ? (
            <Text style={styles.tomorrowText}>{tomorrowText}</Text>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.portionLabel}>
              {isCarriedOver
                ? `Unfinished session — ${formatSessionDate(pausedSession.date)}`
                : "Today's portion"}
            </Text>
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
        </>
      )}

      {/* DEV ONLY — remove before release */}
      {__DEV__ && (
        <View style={{ gap: 8, marginTop: 16 }}>
          <Button
            title="[Dev] Notify: scheduled reminder (5s)"
            color="#888"
            onPress={() => scheduleTestNotification('Hifz Revision', '⏰ Time for your Quran revision. Start now.')}
          />
          <Button
            title="[Dev] Notify: evening nudge A (5s)"
            color="#888"
            onPress={() => scheduleTestNotification('Hifz Revision', "The day isn't over yet. A few minutes is all it takes.")}
          />
          <Button
            title="[Dev] Notify: evening nudge B (5s)"
            color="#888"
            onPress={() => scheduleTestNotification('Hifz Revision', "Still time to revise. You got this.")}
          />
          <Button
            title="[Dev] Notify: evening nudge overdue (5s)"
            color="#888"
            onPress={() => scheduleTestNotification('Hifz Revision', "You missed yesterday's revision, but you still have today. Start now.")}
          />
          <Button
            title="[Dev] Onboarding (SignIn)"
            color="#888"
            onPress={() => navigation.navigate('SignIn')}
          />
          <Button
            title="[Dev] Onboarding (MemorizedJuz)"
            color="#888"
            onPress={() => navigation.navigate('MemorizedJuz')}
          />
          <Button
            title="[Dev] Onboarding (Schedule)"
            color="#888"
            onPress={() => navigation.navigate('Schedule')}
          />
          <Button
            title="[Dev] PreSessionQuiz"
            color="#888"
            onPress={() => navigation.navigate('PreSessionQuiz', { sessionId: null, juzNumber: 1 })}
          />
          <Button
            title="[Dev] Recitation (Al-Baqarah 1–7)"
            color="#888"
            onPress={() =>
              navigation.navigate('Recitation', {
                surahNumber: 2,
                startAyah: 1,
                endAyah: 7,
                sessionId: null,
                juzNumber: 1,
                totalAyahsInJuz: 286,
                resumeFromAyah: 1,
              })
            }
          />
          <Button
            title="[Dev] PostSessionQuiz"
            color="#888"
            onPress={() => navigation.navigate('PostSessionQuiz', { sessionId: null, juzNumber: 1 })}
          />
          <Button
            title="[Dev] SessionSummary"
            color="#888"
            onPress={() => navigation.navigate('SessionSummary', { sessionId: null, totalAyahsInJuz: 286 })}
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
  doneCard: {
    backgroundColor: '#f1f8f1',
    borderWidth: 2,
    borderColor: '#2e7d32',
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
  },
  doneTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1b5e20',
    marginBottom: 16,
    textAlign: 'center',
  },
  tomorrowText: {
    fontSize: 16,
    color: '#555',
    textAlign: 'center',
    lineHeight: 24,
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  notifBanner: {
    backgroundColor: '#fff3e0',
    borderWidth: 1,
    borderColor: '#e65100',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  notifBannerText: {
    fontSize: 14,
    color: '#e65100',
    textAlign: 'center',
  },
});
