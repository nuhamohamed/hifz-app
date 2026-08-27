import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Button,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import TabBar from '../components/TabBar';
import { getCurrentUserId } from '../lib/auth';
import { todayString as getTodayDateString, tomorrowString as getTomorrowDateString } from '../lib/dates';
import { getAyahLocation, getJuzTotalAyahs } from '../lib/juzSurahMap';
import { getTodayPortion } from '../lib/planEngine';
import {
  cancelEveningNudge,
  scheduleDailyNotification,
  scheduleEveningNudge,
  scheduleTestNotification,
} from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { colors, fonts, spacing } from '../lib/theme';

function formatSessionDate(dateStr) {
  const [, month, day] = dateStr.split('-').map(Number);
  const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1];
  return `${monthName} ${day}`;
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

// Passes juz-relative offsets straight through. It used to flatten them into a
// single surah, taking the surah of the *start* and the ayah number of the
// *end*, which silently corrupted every portion spanning two surahs. 28 of the
// 30 juz contain more than one surah, so that was most portions.
function buildSessionParams(sessionId, resumeFromOffset, portion) {
  const juzNumber = portion.juzNumber ?? 1;
  return {
    juzNumber,
    startOffset: portion.portionStartAyah,
    endOffset: portion.portionEndAyah,
    totalAyahsInJuz: getJuzTotalAyahs(juzNumber),
    sessionId,
    resumeFromOffset,
  };
}

function portionSummary(todayPortion) {
  if (!todayPortion || todayPortion.type === 'quiz_only') return null;
  const { juzNumber, portionStartAyah, portionEndAyah } = todayPortion;
  const start = getAyahLocation(juzNumber, portionStartAyah);
  const end = getAyahLocation(juzNumber, portionEndAyah);
  return {
    juzNumber,
    // One label rather than a surah name and a pair of numbers. Reading the
    // start's surah beside the end's ayah number produced "Al-Fatiha 1-88"
    // for a portion that actually ends in Al-Baqarah.
    label:
      start.surahNumber === end.surahNumber
        ? `${start.surahName} ${start.ayahNumber}\u2013${end.ayahNumber}`
        : `${start.surahName} ${start.ayahNumber} to ${end.surahName} ${end.ayahNumber}`,
    ayahCount: portionEndAyah - portionStartAyah + 1,
  };
}

function getResumeHint(pausedSession) {
  if (!pausedSession) return null;
  const phase = pausedSession.phase ?? 'pre_quiz';
  if (phase === 'pre_quiz') return 'Resuming pre-session quiz';
  if (phase === 'revision') {
    // last_confirmed_ayah is a juz offset, so it has to be resolved to a real
    // surah and ayah before it means anything to a person.
    try {
      const at = getAyahLocation(
        pausedSession.juz_number ?? 1,
        (pausedSession.last_confirmed_ayah ?? 0) + 1
      );
      return `Resuming revision from ${at.surahName} ${at.ayahNumber}`;
    } catch {
      return 'Resuming revision';
    }
  }
  if (phase === 'post_quiz') return 'Resuming post-session quiz';
  return null;
}

// Two-half overlay technique: right clip shows 0→180°, left clip adds 180→360°.
function SessionRing({ completedAyahs = 0, todayAyahs = 7, size = 80, stroke = 7 }) {
  const fraction = Math.min(1, completedAyahs / Math.max(todayAyahs, 1));
  const half = size / 2;
  const angle = fraction * 360;

  const rightRotation = `${Math.min(angle, 180) - 180}deg`;
  const leftRotation = `${Math.max(0, angle - 180)}deg`;

  const ringBase = {
    position: 'absolute', width: size, height: size,
    borderRadius: half, borderWidth: stroke,
  };

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[ringBase, { borderColor: colors.primaryDim }]} />
      {angle > 0 && (
        <View style={{ position: 'absolute', left: half, width: half, height: size, overflow: 'hidden' }}>
          <View style={[ringBase, { left: -half, borderColor: colors.primary, transform: [{ rotate: rightRotation }] }]} />
        </View>
      )}
      {angle > 180 && (
        <View style={{ position: 'absolute', left: 0, width: half, height: size, overflow: 'hidden' }}>
          <View style={[ringBase, { borderColor: colors.primary, transform: [{ rotate: leftRotation }] }]} />
        </View>
      )}
      <Text style={{ fontFamily: fonts.regular, fontSize: 7.5, color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center', lineHeight: 12 }}>{'Session\nProgress'}</Text>
    </View>
  );
}

function StepCard({ step, icon, title, desc, iconBg, iconColor }) {
  return (
    <View style={styles.stepCard}>
      <View style={styles.stepNumCircle}>
        <Text style={styles.stepNumText}>{step}</Text>
      </View>
      <View style={[styles.stepIconWrap, { backgroundColor: iconBg }]}>
        <Text style={[styles.stepIcon, { color: iconColor }]}>{icon}</Text>
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepDesc}>{desc}</Text>
      </View>
    </View>
  );
}

export default function TodayScreen() {
  // Portion size is read off the real mushaf, so the planner needs the
  // bundled page data. Provided by SQLiteProvider in App.js.
  const db = useSQLiteContext();
  const navigation = useNavigation();
  // Bumped whenever this screen comes back into focus, so the plan is re-read.
  // It used to load once on mount and never again, so pausing a session and
  // coming back still showed "Start session" with no sign anything was in
  // progress, and finishing one still showed the portion you had just done.
  // Only a full restart of the app corrected it.
  const [refreshKey, setRefreshKey] = useState(0);
  const [name, setName] = useState('');
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

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const cardTranslate = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(cardTranslate, { toValue: 0, duration: 600, delay: 100, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, cardTranslate]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setPortionLoading(true);
        setError('');

        const today = getTodayDateString();
        const userId = await getCurrentUserId();

        const [userResult, portion, pausedResult, quizResult, completedResult, tomorrowResult] = await Promise.all([
          supabase.from('users').select('name, notification_time').eq('id', userId).maybeSingle(),
          getTodayPortion(db, userId),
          supabase
            .from('sessions')
            .select('id, last_confirmed_ayah, phase, juz_number, portion_start_ayah, portion_end_ayah, date')
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

        if (!mounted) return;

        setName(userResult.data?.name ?? '');
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
            const [remHour, remMin] = userResult.data?.notification_time
              ? userResult.data.notification_time.split(':').map(Number)
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
        if (mounted) setError(err.message ?? "Failed to load today's plan.");
      } finally {
        if (mounted) setPortionLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  // Skips the first focus, since the effect above has already run on mount.
  // Without that guard every launch would load the plan twice.
  const hasFocusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true;
        return;
      }
      setRefreshKey((n) => n + 1);
    }, [])
  );

  const navigateForPausedSession = (session) => {
    const resumeFromOffset = (session.last_confirmed_ayah ?? 0) + 1;
    const params = buildSessionParams(session.id, resumeFromOffset, {
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
        .select('id, last_confirmed_ayah, phase, juz_number, portion_start_ayah, portion_end_ayah, date')
        .eq('user_id', userId)
        .in('status', ['paused', 'in_progress'])
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) throw new Error(fetchError.message);

      if (paused) {
        if (paused.date !== today) {
          await supabase.from('sessions').update({ date: today }).eq('id', paused.id);
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

        if (insertError) throw new Error(insertError.message);

        navigation.navigate(
          'PreSessionQuiz',
          buildSessionParams(newSession.id, 1, { juzNumber: 1, portionStartAyah: 1, portionEndAyah: 1 })
        );
        return;
      }

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
          // A juz offset, matching portion_start_ayah above. It used to be a
          // surah-relative ayah number, which made resume restart a
          // cross-surah portion in the wrong place.
          last_confirmed_ayah: todayPortion.portionStartAyah - 1,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError) throw new Error(insertError.message);
      navigation.navigate(
        'PreSessionQuiz',
        buildSessionParams(newSession.id, todayPortion.portionStartAyah, todayPortion)
      );
    } catch (err) {
      setError(err.message ?? 'Failed to start session.');
    } finally {
      setIsStarting(false);
    }
  };

  const resumeHint = getResumeHint(pausedSession);
  const isCarriedOver = !!(pausedSession && pausedSession.date !== getTodayDateString());
  const summary = portionSummary(todayPortion);
  const quizOnly = todayPortion?.type === 'quiz_only';

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.inner, { opacity: fadeAnim }]}>
        <View style={styles.topRow}>
          <Text style={styles.bismillah}>بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ</Text>
          <Text style={styles.greet}>As-salāmu ʿalaykum{name ? `, ${name}` : ''}</Text>
        </View>

        {notifDenied ? (
          <TouchableOpacity style={styles.notifBanner} onPress={() => Linking.openSettings()} activeOpacity={0.8}>
            <Text style={styles.notifBannerText}>
              Notifications are off — tap to enable reminders in Settings.
            </Text>
          </TouchableOpacity>
        ) : null}

        {sessionDoneToday ? (
          <View style={styles.doneCard}>
            <Text style={styles.doneTitle}>All done for today!</Text>
            {tomorrowText ? <Text style={styles.tomorrowText}>{tomorrowText}</Text> : null}
          </View>
        ) : (
          <>
            <Animated.View style={[styles.portionCard, { transform: [{ translateY: cardTranslate }] }]}>
              <View style={styles.portionLeft}>
                <SessionRing completedAyahs={0} todayAyahs={summary?.ayahCount ?? 7} />
              </View>
              <View style={styles.portionRight}>
                <Text style={styles.portionEyebrow}>
                  {isCarriedOver
                    ? `UNFINISHED · ${formatSessionDate(pausedSession.date)}`
                    : summary
                    ? `JUZ ${summary.juzNumber} · TODAY'S PORTION`
                    : "TODAY'S PORTION"}
                </Text>
                {portionLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ alignSelf: 'flex-start', marginVertical: 4 }} />
                ) : quizOnly ? (
                  <Text style={styles.portionTitle}>Quiz only today</Text>
                ) : summary ? (
                  <>
                    <Text style={styles.portionTitle}>{summary.label}</Text>
                    <Text style={styles.portionSub}>{summary.ayahCount} ayat</Text>
                  </>
                ) : (
                  <Text style={styles.portionTitle}>Unable to load portion</Text>
                )}
              </View>
            </Animated.View>

            <Text style={styles.sectionLabel}>TODAY'S AGENDA</Text>
            <View style={styles.steps}>
              <StepCard
                step={1} icon="◈" title="Mistake Review"
                desc="Primes what you'll revise"
                iconBg={colors.ice} iconColor={colors.primary}
              />
              <StepCard
                step={2}
                icon="◉"
                title={summary ? `Recite ${summary.label}` : 'Recite today\'s portion'}
                desc="We follow along as you go"
                iconBg={colors.parchment} iconColor={colors.brown}
              />
              <StepCard
                step={3} icon="◆" title="Recap quiz"
                desc="Locks it in for next time"
                iconBg={colors.parchment} iconColor={colors.accent}
              />
            </View>

            {resumeHint ? <Text style={styles.resumeHint}>{resumeHint}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {quizCount > 0 ? (
              <Text style={styles.quizCountHint}>{quizCount} item{quizCount === 1 ? '' : 's'} due for mistake review</Text>
            ) : null}

            <View style={styles.spacer} />

            {isStarting || portionLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: spacing.md }} />
            ) : (
              <TouchableOpacity style={styles.startBtn} onPress={handleStartSession} activeOpacity={0.88}>
                <Text style={styles.startBtnIcon}>▶</Text>
                <Text style={styles.startBtnText}>{pausedSession ? 'Resume session' : 'Start session'}</Text>
              </TouchableOpacity>
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
              title="[Dev] PreSessionQuiz"
              color="#888"
              onPress={() => navigation.navigate('PreSessionQuiz', { sessionId: null, juzNumber: 1 })}
            />
            <Button
              title="[Dev] Recitation (Al-Baqarah 1–7)"
              color="#888"
              onPress={() =>
                navigation.navigate('Recitation', {
                  // Offsets 1-14 of juz 1: Al-Fatiha 1-7 then Al-Baqarah 1-7,
                  // deliberately spanning the surah boundary so this dev jump
                  // exercises the case that used to break.
                  startOffset: 1, endOffset: 14, sessionId: null,
                  juzNumber: 1, totalAyahsInJuz: 148, resumeFromOffset: 1,
                })
              }
            />
            <Button
              title="[Dev] PostSessionQuiz"
              color="#888"
              onPress={() => navigation.navigate('PostSessionQuiz', { sessionId: null, juzNumber: 1 })}
            />
            <Button
              title="[Dev] SessionSummary (latest session)"
              color="#888"
              onPress={async () => {
                // Uses the most recent session rather than a null id, so the
                // mistake cards actually have something to render.
                const userId = await getCurrentUserId();
                const { data } = await supabase
                  .from('sessions')
                  .select('id, juz_number')
                  .eq('user_id', userId)
                  .order('date', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                navigation.navigate('SessionSummary', {
                  sessionId: data?.id ?? null,
                  totalAyahsInJuz: getJuzTotalAyahs(data?.juz_number ?? 1),
                });
              }}
            />
            <Button
              title="[Dev] ✦ Design Mockups (Dawrah)"
              color={colors.primary}
              onPress={() => navigation.navigate('Mockups')}
            />
          </View>
        )}
      </Animated.View>

      <TabBar active="home" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  inner: { flex: 1, paddingTop: 64, paddingHorizontal: spacing.lg },

  topRow: { marginBottom: spacing.lg, paddingTop: spacing.xl },
  bismillah: { fontSize: 18, color: colors.textMid, textAlign: 'center', marginBottom: 4, fontWeight: '300' },
  greet: { fontFamily: fonts.regular, fontSize: 16, color: colors.textMid, textAlign: 'center' },

  notifBanner: {
    backgroundColor: colors.accentLight,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    padding: 12,
    marginBottom: spacing.md,
  },
  notifBannerText: { fontFamily: fonts.regular, fontSize: 14, color: colors.accent, textAlign: 'center' },

  doneCard: {
    backgroundColor: colors.successLight,
    borderWidth: 2,
    borderColor: colors.success,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
  },
  doneTitle: { fontFamily: fonts.semiBold, fontSize: 22, color: colors.success, marginBottom: 16, textAlign: 'center' },
  tomorrowText: { fontFamily: fonts.regular, fontSize: 16, color: colors.textMid, textAlign: 'center', lineHeight: 24 },

  portionCard: {
    backgroundColor: colors.ice,
    borderRadius: 20, padding: spacing.md,
    flexDirection: 'row', alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.primaryDim,
  },
  portionLeft: { marginRight: spacing.md },
  portionRight: { flex: 1 },
  portionEyebrow: {
    fontFamily: fonts.semiBold, fontSize: 10, color: colors.textMuted,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4,
  },
  portionTitle: { fontFamily: fonts.semiBold, fontSize: 20, color: colors.text, letterSpacing: -0.3, marginBottom: 4 },
  portionSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMid },

  sectionLabel: {
    fontFamily: fonts.semiBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: spacing.sm,
  },
  steps: { gap: 8 },
  stepCard: {
    backgroundColor: colors.white, borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  stepNumCircle: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  stepNumText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.white },
  stepIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepIcon: { fontSize: 18 },
  stepBody: { flex: 1 },
  stepTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text, marginBottom: 2 },
  stepDesc: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMid },

  resumeHint: {
    fontFamily: fonts.medium, fontSize: 14, color: colors.accent,
    textAlign: 'center', marginTop: spacing.md,
  },
  quizCountHint: {
    fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted,
    textAlign: 'center', marginTop: spacing.sm,
  },
  error: {
    fontFamily: fonts.regular, color: colors.error,
    textAlign: 'center', marginTop: spacing.md,
  },

  spacer: { flex: 1, minHeight: spacing.lg },

  startBtn: {
    backgroundColor: 'rgba(26,61,138,0.92)',
    borderRadius: 18,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  },
  startBtnIcon: { fontSize: 14, color: colors.white },
  startBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white, letterSpacing: 0.2 },
});
