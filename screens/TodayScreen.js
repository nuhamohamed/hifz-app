import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  ScrollView,
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
import {
  formatDayLabel as formatSessionDate,
  todayString as getTodayDateString,
} from '../lib/dates';
import { getAyahLocation, getJuzTotalAyahs } from '../lib/juzSurahMap';
import { getTodayPlan } from '../lib/planEngine';
import { roundedEstimateMinutes } from '../lib/portionMath';
import {
  cancelDailyNotification,
  cancelEveningNudge,
  scheduleDailyNotification,
  scheduleEveningNudge,
} from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { colors, fonts, spacing } from '../lib/theme';

// Passes juz-relative offsets straight through. It used to flatten them into a
// single surah, taking the surah of the *start* and the ayah number of the
// *end*, which silently corrupted every portion spanning two surahs. 28 of the
// 30 juz contain more than one surah, so that was most portions.
function buildSessionParams(sessionId, resumeFromOffset, portion, sessionType = 'revision') {
  const juzNumber = portion.juzNumber ?? 1;
  return {
    juzNumber,
    startOffset: portion.portionStartAyah,
    endOffset: portion.portionEndAyah,
    totalAyahsInJuz: getJuzTotalAyahs(juzNumber),
    sessionId,
    resumeFromOffset,
    // 'quiz_only' means the day ends when the quiz does. The offsets above are
    // then meaningless and nothing downstream may act on them.
    sessionType,
  };
}

function portionSummary(todayPortion) {
  if (!todayPortion || todayPortion.type === 'quiz_only') return null;
  const { juzNumber, portionStartAyah, portionEndAyah, pages } = todayPortion;
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
    // Pages rather than ayahs. An ayah count says nothing about how long
    // something takes, since a page holds anywhere from 1 to 40 of them.
    pages: pages ?? 0,
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

function StepCard({ step, icon, title, desc, iconBg, iconColor, done }) {
  return (
    <View style={[styles.stepCard, done && styles.stepCardDone]}>
      <View style={[styles.stepNumCircle, done && styles.stepNumCircleDone]}>
        <Text style={styles.stepNumText}>{done ? '✓' : step}</Text>
      </View>
      <View style={[styles.stepIconWrap, { backgroundColor: iconBg }]}>
        <Text style={[styles.stepIcon, { color: iconColor }]}>{icon}</Text>
      </View>
      {/* A step with no second line centres on the box rather than sitting
          against the top of it, where an empty description used to hold space. */}
      <View style={styles.stepBody}>
        <Text style={[styles.stepTitle, done && styles.stepTextDone]}>{title}</Text>
        {desc ? (
          <Text style={[styles.stepDesc, done && styles.stepTextDone]}>{desc}</Text>
        ) : null}
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
  // Every portion due today, one per juz, in mushaf order. Usually one.
  const [portions, setPortions] = useState([]);
  const [quizCount, setQuizCount] = useState(0);
  const [estimateMinutes, setEstimateMinutes] = useState(null);
  const [portionsWaiting, setPortionsWaiting] = useState(0);
  // Only set on a day that holds nothing: the portion waiting in the future,
  // carrying the date it is booked for.
  const [nextSession, setNextSession] = useState(null);
  // The length they chose, so the screen can tell a heavy day from a normal one.
  const [sessionMinutes, setSessionMinutes] = useState(null);
  // What was recited today, once the day is finished. The agenda crosses this
  // out rather than the next session's portion, which nobody has done yet.
  const [donePortion, setDonePortion] = useState(null);
  const [portionLoading, setPortionLoading] = useState(true);
  const [pausedSession, setPausedSession] = useState(null);
  const [sessionDoneToday, setSessionDoneToday] = useState(false);
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

        // The plan is one call rather than a query in the Promise.all, because
        // the portion cannot be sized until the due quiz has been costed: the
        // quiz is never cut, so it is paid for first and the portion takes what
        // is left. Everything that does not depend on that still runs alongside.
        const [userResult, plan, pausedResult, completedResult] = await Promise.all([
          supabase
            .from('users')
            .select('name, notification_time, session_minutes')
            .eq('id', userId)
            .maybeSingle(),
          getTodayPlan(db, userId),
          supabase
            .from('sessions')
            .select('id, last_confirmed_ayah, phase, juz_number, portion_start_ayah, portion_end_ayah, date, type')
            .eq('user_id', userId)
            .in('status', ['paused', 'in_progress'])
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('sessions')
            .select('id, juz_number, portion_start_ayah, portion_end_ayah')
            .eq('user_id', userId)
            .eq('status', 'complete')
            .eq('date', today)
            .limit(1)
            .maybeSingle(),
        ]);

        if (!mounted) return;

        const portion = plan.portions[0] ?? null;
        setName(userResult.data?.name ?? '');
        setSessionMinutes(userResult.data?.session_minutes ?? null);
        setPortions(plan.portions);
        // The length of the quiz that will actually run, after the overlap
        // dedupe and the leech cap, rather than the raw row count.
        setQuizCount(plan.quizItemCount);
        setEstimateMinutes(roundedEstimateMinutes(plan.estimateMinutes));
        setPortionsWaiting(plan.portionsWaiting);
        setNextSession(plan.nextSession ?? null);

        // Finished today AND nothing further due. A day carrying two juz is not
        // over when the first is done, so this cannot key on the session alone.
        const isDone =
          !completedResult.error && !!completedResult.data && plan.portions.length === 0;
        setSessionDoneToday(isDone);
        setDonePortion(
          isDone && completedResult.data
            ? {
                juzNumber: completedResult.data.juz_number,
                portionStartAyah: completedResult.data.portion_start_ayah,
                portionEndAyah: completedResult.data.portion_end_ayah,
              }
            : null
        );

        if (!notificationsScheduledRef.current) {
          notificationsScheduledRef.current = true;
          try {
            // Only when tomorrow actually holds something. Someone whose juz
            // is finished and not due back for three weeks was still being
            // asked every morning to open an app with nothing in it.
            if (plan.hasWorkTomorrow) {
              const [remHour, remMin] = userResult.data?.notification_time
                ? userResult.data.notification_time.split(':').map(Number)
                : [9, 0];
              await scheduleDailyNotification(remHour, remMin);
            } else {
              await cancelDailyNotification();
            }

            const isOverdue = !!(portion?.scheduledDate && portion.scheduledDate < today);
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
    const params = buildSessionParams(
      session.id,
      resumeFromOffset,
      {
        juzNumber: session.juz_number ?? 1,
        portionStartAyah: session.portion_start_ayah,
        portionEndAyah: session.portion_end_ayah,
      },
      session.type ?? 'revision'
    );
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
        .select('id, last_confirmed_ayah, phase, juz_number, portion_start_ayah, portion_end_ayah, date, type')
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

      if (!nextPortion) {
        // There is nothing to recite, so the day is the quiz and then it ends.
        //
        // This used to invent a one-ayah portion of juz 1 purely so the session
        // flow had something to hand the recitation screen. The screen said
        // "Quiz only today" and then walked people into reciting Al-Fatihah 1,
        // and finishing the day advanced the recitation plan off the back of it:
        // a juz already completed and not due for three weeks came back the next
        // morning, starting at ayah 2. The columns below are still written
        // because they are NOT NULL, but `type` is what anything downstream
        // reads, and nothing acts on the offsets for a quiz-only day.
        const { data: newSession, error: insertError } = await supabase
          .from('sessions')
          .insert({
            user_id: userId,
            date: today,
            status: 'in_progress',
            phase: 'pre_quiz',
            type: 'quiz_only',
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
          buildSessionParams(
            newSession.id,
            1,
            { juzNumber: 1, portionStartAyah: 1, portionEndAyah: 1 },
            'quiz_only'
          )
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
          juz_number: nextPortion.juzNumber,
          portion_start_ayah: nextPortion.portionStartAyah,
          portion_end_ayah: nextPortion.portionEndAyah,
          // A juz offset, matching portion_start_ayah above. It used to be a
          // surah-relative ayah number, which made resume restart a
          // cross-surah portion in the wrong place.
          last_confirmed_ayah: nextPortion.portionStartAyah - 1,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError) throw new Error(insertError.message);
      navigation.navigate(
        'PreSessionQuiz',
        buildSessionParams(newSession.id, nextPortion.portionStartAyah, nextPortion)
      );
    } catch (err) {
      setError(err.message ?? 'Failed to start session.');
    } finally {
      setIsStarting(false);
    }
  };

  /**
   * Bring a future session forward and begin it now.
   *
   * The row itself is left alone: the session records which portion was worked,
   * and the plan update finds it by juz and starting offset when the session
   * completes, then moves the rest of the pass earlier to match. Nothing is
   * rewritten here on the strength of a session that has not happened yet.
   */
  const handleStartEarly = async () => {
    if (!nextSession) return;
    setIsStarting(true);
    setError('');
    try {
      const userId = await getCurrentUserId();
      const { data: newSession, error: insertError } = await supabase
        .from('sessions')
        .insert({
          user_id: userId,
          date: getTodayDateString(),
          status: 'in_progress',
          phase: 'pre_quiz',
          type: 'revision',
          juz_number: nextSession.juzNumber,
          portion_start_ayah: nextSession.portionStartAyah,
          portion_end_ayah: nextSession.portionEndAyah,
          last_confirmed_ayah: nextSession.portionStartAyah - 1,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError) throw new Error(insertError.message);

      navigation.navigate(
        'PreSessionQuiz',
        buildSessionParams(newSession.id, nextSession.portionStartAyah, nextSession)
      );
    } catch (err) {
      setError(err.message ?? 'Failed to start session.');
    } finally {
      setIsStarting(false);
    }
  };

  const resumeHint = getResumeHint(pausedSession);
  const isCarriedOver = !!(pausedSession && pausedSession.date !== getTodayDateString());
  // The first portion is the one Start begins; the rest are listed and come
  // after it, one session each.
  const nextPortion = portions[0] ?? null;
  const summary = portionSummary(nextPortion);
  const quizOnly = portions.length === 0;
  // Nothing to recite and nothing due: a genuinely empty day. Saying "Quiz only"
  // and offering a Start button would be two lies in a row.
  const nothingDue = quizOnly && quizCount === 0 && !pausedSession;
  // A day with nothing due but a session booked ahead. The screen shows that
  // session rather than a dead end, and offers to bring it forward.
  const showingNext = nothingDue && !!nextSession && !sessionDoneToday;
  const nextSummary = portionSummary(nextSession);
  // Above the length they asked for, so the day genuinely overruns.
  const isHeavyDay = !!(estimateMinutes && sessionMinutes && estimateMinutes > sessionMinutes);

  // ── What the banner is carrying ───────────────────────────────────────────
  // One card, one message: whatever the person most needs to know right now.
  // It used to be a fixed "today's portion" plus a separate all-done card that
  // replaced the whole screen, so a paused session said nothing at the top and
  // a finished day threw the agenda away.
  const displayPortion = showingNext ? nextSession : nextPortion;
  const displaySummary = showingNext ? nextSummary : summary;

  let bannerEyebrow = "TODAY'S PORTION";
  let bannerSub = null;
  // When the subtitle carries *when* rather than *how much*, it is the more
  // important half of the card and is set to look like it. A date whispered
  // under a large portion range reads as though the portion were today's.
  let bannerSubStrong = false;
  if (sessionDoneToday) {
    bannerEyebrow = 'ALL DONE FOR TODAY';
    bannerSub = nextSession
      ? `Next session · ${formatSessionDate(nextSession.scheduledDate)}`
      : 'Nothing scheduled yet';
    bannerSubStrong = true;
  } else if (pausedSession) {
    bannerEyebrow = isCarriedOver
      ? `UNFINISHED · ${formatSessionDate(pausedSession.date)}`
      : 'IN PROGRESS';
    bannerSub = resumeHint;
  } else if (showingNext) {
    bannerEyebrow = 'NOTHING DUE TODAY';
    bannerSub = `Next session · ${formatSessionDate(nextSession.scheduledDate)}`;
    bannerSubStrong = true;
  } else if (summary) {
    bannerEyebrow =
      portions.length > 1
        ? `JUZ ${summary.juzNumber} · FIRST OF ${portions.length}`
        : `JUZ ${summary.juzNumber} · TODAY'S PORTION`;
    bannerSub =
      estimateMinutes && summary.pages
        ? `about ${Math.max(1, Math.round(summary.pages))} page${
            Math.round(summary.pages) === 1 ? '' : 's'
          } · ${estimateMinutes} min`
        : null;
  }

  // When all done, the banner names what is coming rather than what was done.
  const bannerTitle = sessionDoneToday
    ? nextSession
      ? nextSummary.label
      : 'Nothing scheduled yet'
    : displaySummary
    ? displaySummary.label
    : nothingDue
    ? 'Nothing due today'
    : quizOnly
    ? 'Quiz only today'
    : 'Unable to load portion';

  // ── How far through the day they are ──────────────────────────────────────
  // The ring was hardcoded to zero, so "session progress" never moved. It now
  // follows the resume marker, which is written after every confirmed ayah.
  const portionLength = summary ? summary.ayahCount : 0;
  const recitedSoFar =
    pausedSession && nextPortion
      ? Math.max(0, (pausedSession.last_confirmed_ayah ?? 0) - nextPortion.portionStartAyah + 1)
      : 0;
  const ringDone = sessionDoneToday ? portionLength || 1 : recitedSoFar;
  const ringTotal = sessionDoneToday ? portionLength || 1 : portionLength || 1;

  // ── Which agenda steps are behind them ────────────────────────────────────
  // Phase is written as the session moves, so a paused session already knows
  // how far it reached. Finishing the day crosses everything out.
  const phase = pausedSession?.phase ?? null;
  const quizStepDone = sessionDoneToday || phase === 'revision' || phase === 'post_quiz';
  const reciteStepDone = sessionDoneToday || phase === 'post_quiz';
  const recapStepDone = sessionDoneToday;
  // The agenda belongs to whichever session is on screen.
  const agendaPortions = sessionDoneToday && donePortion
    ? [donePortion]
    : showingNext
    ? [nextSession]
    : portions;

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
              Notifications are off. Tap to enable reminders in Settings.
            </Text>
          </TouchableOpacity>
        ) : null}

        {(
          <>
            <Animated.View style={[styles.portionCard, { transform: [{ translateY: cardTranslate }] }]}>
              <View style={styles.portionLeft}>
                <SessionRing completedAyahs={ringDone} todayAyahs={ringTotal} />
              </View>
              <View style={styles.portionRight}>
                <Text style={styles.portionEyebrow}>{bannerEyebrow}</Text>
                {portionLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ alignSelf: 'flex-start', marginVertical: 4 }} />
                ) : (
                  <>
                    <Text style={styles.portionTitle}>{bannerTitle}</Text>
                    {bannerSub ? (
                      <Text
                        style={[
                          styles.portionSub,
                          bannerSubStrong && styles.portionSubStrong,
                        ]}
                      >
                        {bannerSub}
                      </Text>
                    ) : null}
                  </>
                )}
              </View>
            </Animated.View>

            {!portionLoading && portionsWaiting > 0 ? (
              <View style={styles.costRow}>
                {portionsWaiting > 0 ? (
                  /* A fact, not a warning. No badge and nothing dropped: a
                     backlog is worked oldest first and shrinks by being done.
                     Counted in portions, because a juz count read zero for
                     someone days behind inside the juz they were being served. */
                  <Text style={styles.waitingText}>
                    {portionsWaiting} portion{portionsWaiting === 1 ? '' : 's'} waiting
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* The agenda scrolls and the button does not. A day carrying two
                juz, or a long portion label wrapping to three lines, used to
                push the button past the bottom of the screen where the tab bar
                clipped it: the whole layout was one fixed column with a spacer
                doing the pushing, so it only fitted while the content stayed
                short. */}
            <ScrollView
              style={styles.agendaScroll}
              contentContainerStyle={styles.agendaContent}
              showsVerticalScrollIndicator={false}
            >
            {nothingDue && !showingNext && !sessionDoneToday ? null : (
              <>
                <Text style={styles.sectionLabel}>
                  {showingNext ? "NEXT SESSION'S AGENDA" : "TODAY'S AGENDA"}
                </Text>
                <View style={styles.steps}>
                  <StepCard
                    step={1} icon="◈" title="Mistake Review"
                    iconBg={colors.ice} iconColor={colors.primary}
                    done={quizStepDone}
                  />
                  {/* A quiz-only day has no portion, so it has no recitation and
                      no recap of one. Listing three steps and then ending after
                      the first was the screen contradicting itself.

                      When two juz fall on the same day both are listed here, in
                      mushaf order, each as its own step. They are done one after
                      the other, and stopping after the first leaves the second
                      waiting rather than losing it. */}
                  {agendaPortions.map((p, i) => {
                    const label = portionSummary(p)?.label;
                    return (
                      <StepCard
                        key={`${p.juzNumber}-${p.portionStartAyah}`}
                        step={i + 2}
                        icon="◉"
                        title={label ? `Recite ${label}` : "Recite today's portion"}
                        desc={
                          agendaPortions.length > 1
                            ? `Juz ${p.juzNumber}`
                            : 'We follow along as you go'
                        }
                        iconBg={colors.parchment} iconColor={colors.brown}
                        done={reciteStepDone}
                      />
                    );
                  })}
                  {quizOnly && !showingNext && !sessionDoneToday ? null : (
                    <StepCard
                      step={agendaPortions.length + 2} icon="◆" title="Recap quiz"
                      desc="Locks it in for next time"
                      iconBg={colors.parchment} iconColor={colors.accent}
                      done={recapStepDone}
                    />
                  )}
                </View>
              </>
            )}

            {/* The resume point lives in the banner now, which is the one
                place the main update belongs. It was printed here too. */}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {quizCount > 0 ? (
              <Text style={styles.quizCountHint}>{quizCount} item{quizCount === 1 ? '' : 's'} due for mistake review</Text>
            ) : null}
            </ScrollView>

            <View style={styles.footer}>
            {/* True rather than a nudge: step 1 above genuinely is the quiz, so
                five minutes really does buy the highest-value part of a day.
                Shown only when the day is actually above the length they chose,
                which is when it is worth saying: a heavy review, or ground they
                have fallen behind on. On an ordinary day it is noise. */}
            {!portionLoading && !quizOnly && isHeavyDay ? (
              <Text style={styles.shortOnTime}>
                Short on time? Start anyway. The review comes first and is the
                part that matters most.
              </Text>
            ) : null}

            {isStarting || portionLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: spacing.md }} />
            ) : sessionDoneToday ? null : showingNext ? (
              <>
                {/* Working ahead moves the whole rotation earlier rather than
                    banking a free day, so it is offered plainly and named for
                    what it is rather than dressed up as today's work. */}
                <TouchableOpacity
                  style={styles.startBtn}
                  onPress={handleStartEarly}
                  activeOpacity={0.88}
                >
                  <Text style={styles.startBtnIcon}>▶</Text>
                  <Text style={styles.startBtnText}>Start this session early</Text>
                </TouchableOpacity>
                <Text style={styles.earlyNote}>
                  Doing it now moves the rest of your schedule earlier to match.
                </Text>
              </>
            ) : nothingDue ? (
              <Text style={styles.restDay}>
                Nothing is due today. Rest, and come back tomorrow.
              </Text>
            ) : (
              <TouchableOpacity style={styles.startBtn} onPress={handleStartSession} activeOpacity={0.88}>
                <Text style={styles.startBtnIcon}>▶</Text>
                <Text style={styles.startBtnText}>
                  {pausedSession ? 'Resume session' : quizOnly ? 'Start review' : 'Start session'}
                </Text>
              </TouchableOpacity>
            )}
            </View>
          </>
        )}

      </Animated.View>

      <TabBar active="home" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  inner: { flex: 1, paddingTop: 64, paddingHorizontal: spacing.lg },
  // The scrolling middle, and the footer that never moves.
  agendaScroll: { flex: 1 },
  agendaContent: { paddingBottom: spacing.md },
  footer: { paddingTop: spacing.sm, paddingBottom: spacing.md },

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
  portionSubStrong: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.primary,
    marginTop: 2,
  },

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
  stepCardDone: { opacity: 0.55 },
  stepNumCircleDone: { backgroundColor: colors.success },
  stepTextDone: { textDecorationLine: 'line-through', color: colors.textMuted },
  stepBody: { flex: 1, justifyContent: 'center' },
  stepTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text, marginBottom: 2 },
  stepDesc: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMid },

  costRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: spacing.sm, marginBottom: spacing.md,
  },
  costText: {
    fontFamily: fonts.semiBold, fontSize: 15, color: colors.text,
  },
  waitingText: {
    fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted,
  },

  earlyNote: {
    fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted,
    textAlign: 'center', lineHeight: 19, marginTop: spacing.sm,
  },
  restDay: {
    fontFamily: fonts.regular, fontSize: 15, color: colors.textMid,
    textAlign: 'center', lineHeight: 22, marginBottom: spacing.lg,
  },

  shortOnTime: {
    fontFamily: fonts.regular, fontSize: 13, color: colors.textMid,
    textAlign: 'center', lineHeight: 19, marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
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
