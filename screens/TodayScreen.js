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
import {
  applyPendingSessionPlans,
  getTodayPlan,
  portionPagesFor,
} from '../lib/planEngine';
import {
  postSessionQuizMinutes,
  roundedEstimateMinutes,
} from '../lib/portionMath';
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
  // Named as the agenda names them. 'pre_quiz' and 'post_quiz' are the column
  // values; nobody using the app has seen those words, and the banner is the
  // one line telling them what the button does.
  if (phase === 'pre_quiz') return 'Resuming mistake review';
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
  if (phase === 'post_quiz') return 'Resuming recap quiz';
  return null;
}

// Two-half overlay technique: right clip shows 0→180°, left clip adds 180→360°.
/**
 * Progress through the whole session, not through the portion.
 *
 * It used to be handed an ayah count, which meant the ring measured only the
 * recitation: a day whose mistake review was the bulk of the work showed no
 * movement for finishing it. The caller now works out one fraction across
 * every part of the day and passes that.
 */
function SessionRing({ fraction: rawFraction = 0, size = 80, stroke = 7 }) {
  const fraction = Math.max(0, Math.min(1, rawFraction));
  const half = size / 2;
  const angle = fraction * 360;

  // +45 because the coloured arc below is not where you would guess.
  //
  // A CSS-style border mitres at the diagonals, so borderTop spans 315 to 45
  // degrees and borderRight spans 45 to 135. Together they are a true half
  // circle, but centred on 45 rather than on 90, so without this offset the
  // arc sits a corner short at the top and a corner long at the bottom.
  const ARC_OFFSET = 45;

  const rightRotation = `${Math.min(angle, 180) - 180 + ARC_OFFSET}deg`;
  const leftRotation = `${Math.max(0, angle - 180) + ARC_OFFSET}deg`;

  const ringBase = {
    position: 'absolute', width: size, height: size,
    borderRadius: half, borderWidth: stroke,
  };

  // Half a ring, not a whole one. This is the entire fix for a ring that used
  // to report three states.
  //
  // Both rotating halves carried borderColor: primary, which colours all four
  // sides, and a complete circle is unchanged by rotation. So the clip showed a
  // full half ring the instant the fraction went above zero, whatever the
  // fraction was: 1% and 49% both rendered as exactly half. Colouring only the
  // top and right gives a 180 degree arc that rotation can actually sweep.
  const arc = {
    ...ringBase,
    borderColor: 'transparent',
    borderTopColor: colors.primary,
    borderRightColor: colors.primary,
  };

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[ringBase, { borderColor: colors.primaryDim }]} />
      {angle > 0 && (
        <View style={{ position: 'absolute', left: half, width: half, height: size, overflow: 'hidden' }}>
          <View style={[arc, { left: -half, transform: [{ rotate: rightRotation }] }]} />
        </View>
      )}
      {angle > 180 && (
        <View style={{ position: 'absolute', left: 0, width: half, height: size, overflow: 'hidden' }}>
          <View style={[arc, { transform: [{ rotate: leftRotation }] }]} />
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
  // Mistakes made during today's finished session. Decides whether the recap
  // quiz actually ran, and so whether it belongs on the agenda at all.
  const [doneMistakeCount, setDoneMistakeCount] = useState(0);
  const [portionLoading, setPortionLoading] = useState(true);
  const [pausedSession, setPausedSession] = useState(null);
  // Pages in the paused session's OWN range, which the portion list cannot
  // supply because it re-sizes every row for today.
  const [pausedPortionPages, setPausedPortionPages] = useState(0);
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
        // Only blank the screen when there is nothing on it yet. A refocus
        // refreshes in place instead.
        //
        // This effect re-runs on every return to the tab, and the work below is
        // four sequential network legs: the user id, then scoring any finished
        // session on its own, then the batched reads, then the mistake count.
        // Clearing to a spinner first meant an unchanged screen looked like it
        // was loading for about a second every time somebody switched tabs and
        // came back. The queries still run; the screen just keeps showing the
        // last good answer until the new one arrives.
        if (refreshKey === 0) setPortionLoading(true);
        setError('');

        const today = getTodayDateString();
        const userId = await getCurrentUserId();

        // The plan is one call rather than a query in the Promise.all, because
        // the portion cannot be sized until the due quiz has been costed: the
        // quiz is never cut, so it is paid for first and the portion takes what
        // is left. Everything that does not depend on that still runs alongside.
        // Before the plan, not alongside it. A session finished but not yet
        // scored has not moved its juz on, so planning first would build
        // today from progress that is one session out of date. Awaited on its
        // own for the same reason: Promise.all would race it against the very
        // query that reads what it writes.
        //
        // This is also where a session gets scored at all now. The summary
        // screen used to do it on mount, before the person could clear a
        // misflag, so corrections never undid what the misflag cost.
        try {
          await applyPendingSessionPlans(db, userId);
        } catch (planErr) {
          // A failed scoring leaves the session unscored and it is retried on
          // the next load. Better than blanking the screen over it.
          console.error('[Today] could not score a finished session:', planErr?.message);
        }

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
            .select('id, juz_number, portion_start_ayah, portion_end_ayah, type')
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
        // Deliberately not filtered to revision in the query above: a finished
        // quiz-only day is still a finished day, and excluding it there would
        // stop the screen ever saying "all done" after one. It is filtered
        // here instead, where the columns are actually read. A quiz-only row
        // carries juz 1 and portion 1-1 as filler, so building a portion from
        // it put a phantom "Recite Al-Fatihah 1-1" step on the finished agenda.
        setDonePortion(
          isDone && completedResult.data && completedResult.data.type !== 'quiz_only'
            ? {
                juzNumber: completedResult.data.juz_number,
                portionStartAyah: completedResult.data.portion_start_ayah,
                portionEndAyah: completedResult.data.portion_end_ayah,
              }
            : null
        );

        // Whether the recap actually ran. fetchPostSessionItems pulls mistakes
        // for that session alone and returns nothing when there are none, so a
        // clean recitation skips straight to the summary. Counting them here
        // lets the agenda agree with what happened instead of listing a step
        // that was never shown.
        if (isDone && completedResult.data) {
          const { count: mistakeCount } = await supabase
            .from('mistakes')
            .select('ayah_number', { count: 'exact', head: true })
            .eq('session_id', completedResult.data.id)
            .is('dismissed_at', null);
          if (mounted) setDoneMistakeCount(mistakeCount ?? 0);
        } else if (mounted) {
          setDoneMistakeCount(0);
        }

        if (!notificationsScheduledRef.current) {
          notificationsScheduledRef.current = true;
          try {
            // Two ways to end up with no reminder, and both are respected.
            // A null notification_time means reminders are switched off, which
            // used to fall back to 9am and schedule one anyway. And a tomorrow
            // that holds nothing gets none either: someone whose juz is
            // finished and not due back for three weeks was still asked every
            // morning to open an app with nothing in it.
            const reminderTime = userResult.data?.notification_time;
            if (reminderTime && plan.hasWorkTomorrow) {
              const [remHour, remMin] = reminderTime.split(':').map(Number);
              await scheduleDailyNotification(remHour, remMin);
            } else {
              await cancelDailyNotification();
            }

            // The nudge answers to the same switch as the 9am reminder. It
            // used to be scheduled whenever the day was unfinished, without
            // consulting notification_time at all, so someone who had turned
            // reminders off still got an 8pm notification. That is the same
            // bug the morning reminder had, in the one path that was missed.
            const isOverdue = !!(portion?.scheduledDate && portion.scheduledDate < today);
            if (isDone || !reminderTime) {
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

          const p = pausedResult.data;
          if (p.type !== 'quiz_only' && p.portion_start_ayah && p.portion_end_ayah) {
            try {
              const pages = await portionPagesFor(
                db,
                p.juz_number ?? 1,
                p.portion_start_ayah,
                p.portion_end_ayah
              );
              if (mounted) setPausedPortionPages(pages);
            } catch {
              // A missing page count costs a detail line, not the screen.
              if (mounted) setPausedPortionPages(0);
            }
          }
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
        const resumedOnNewDay = paused.date !== today;
        if (resumedOnNewDay) {
          await supabase.from('sessions').update({ date: today }).eq('id', paused.id);
        }

        // Resuming across a day boundary is not the same as resuming later the
        // same day. The review a session passed through was answered against
        // the due list of the day it started on, and anything that has fallen
        // due since, including the mistakes made in this very session, was not
        // in it. Walking straight back into the portion steps over all of it.
        //
        // Only from 'revision'. A session paused inside the recap quiz has
        // already finished reciting, and the pre-quiz exits to Recitation, so
        // sending it there would restart a portion that was done.
        //
        // The place in the portion is safe: navigateForPausedSession puts
        // last_confirmed_ayah + 1 into resumeFromOffset, the pre-quiz replaces
        // to Recitation with those same params, and Recitation reads
        // resumeFromOffset for its starting index. The quiz is a detour, not a
        // restart.
        const needsTodaysReview =
          resumedOnNewDay && quizCount > 0 && (paused.phase ?? 'pre_quiz') === 'revision';

        if (needsTodaysReview) {
          await supabase
            .from('sessions')
            .update({ phase: 'pre_quiz' })
            .eq('id', paused.id);
          navigateForPausedSession({ ...paused, date: today, phase: 'pre_quiz' });
          return;
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
  // A session already under way is today's work, whatever the schedule says.
  //
  // Starting a portion early creates a session dated today while its scheduled
  // row stays pending on its original date. The schedule then reports nothing
  // due today, so the day was read as quiz-only: the agenda emptied itself and
  // the banner said "Quiz only today" directly above an offer to resume a
  // revision of Al-Fatihah 1. Both statements came from the same screen.
  const pausedPortion =
    pausedSession && pausedSession.type !== 'quiz_only'
      ? {
          juzNumber: pausedSession.juz_number,
          portionStartAyah: pausedSession.portion_start_ayah,
          portionEndAyah: pausedSession.portion_end_ayah,
          pages: pausedPortionPages,
        }
      : null;

  // Falls back to the session in progress. Safe for the start path too:
  // handleStartSession looks for a paused session first and resumes it, so it
  // only ever reaches nextPortion when there is nothing paused.
  // The paused session first, not the plan's portion.
  //
  // This was the other way round, and it made the progress ring wrong in a way
  // that read as roughly half done for someone barely started. A session that
  // is paused is committed to the range on its own row, but the portion list is
  // re-sized for today every time it is read, so the two are different lengths.
  // Progress was then the ayahs recited under the paused range divided by the
  // length of a freshly-sized one: 19 of 139 recited, but shown against a
  // portion re-cut to about 40, which is half. The numerator and the
  // denominator have to come from the same portion.
  const nextPortion = pausedPortion ?? portions[0] ?? null;
  const summary = portionSummary(nextPortion);
  const quizOnly = portions.length === 0 && !pausedPortion;
  // Nothing to recite and nothing due: a genuinely empty day. Saying "Quiz only"
  // and offering a Start button would be two lies in a row.
  const nothingDue = quizOnly && quizCount === 0 && !pausedSession;
  // A day with nothing due but a session booked ahead. The screen shows that
  // session rather than a dead end, and offers to bring it forward.
  const showingNext = nothingDue && !!nextSession && !sessionDoneToday;
  const nextSummary = portionSummary(nextSession);
  // Above the length they asked for, so the day genuinely overruns.
  const isHeavyDay = !!(estimateMinutes && sessionMinutes && estimateMinutes > sessionMinutes);

  // ── How far into the portion they already are ─────────────────────────────
  // Hoisted above the banner because the banner and the progress ring both
  // need it, and two copies of this arithmetic is how two numbers on the same
  // screen start disagreeing.
  const portionLength = summary ? summary.ayahCount : 0;
  const recitedSoFar =
    pausedSession && nextPortion
      ? Math.max(0, (pausedSession.last_confirmed_ayah ?? 0) - nextPortion.portionStartAyah + 1)
      : 0;
  const portionDoneFraction =
    portionLength > 0 ? Math.min(1, recitedSoFar / portionLength) : 0;

  // What is left of the day, for a session already under way.
  //
  // The day's estimate less the share already recited. Approximate on purpose,
  // and it has to be: the estimate covers the review, the portion and the recap
  // together, and only the portion's progress is known mid-session. It is the
  // same number the banner shows before starting, reduced by the part now
  // behind them, which is the honest reading of "left".
  const minutesLeft =
    estimateMinutes && portionLength > 0
      ? Math.max(1, Math.round(estimateMinutes * (1 - portionDoneFraction)))
      : estimateMinutes;

  // Pages still to recite. What is left is the useful half: someone resuming
  // wants to know the size of what is in front of them, not to be scored on
  // what is behind.
  const pagesLeft = summary
    ? Math.max(1, Math.round(summary.pages * (1 - portionDoneFraction)))
    : 0;
  const pagesTotal = summary ? Math.max(1, Math.round(summary.pages)) : 0;

  // ── What the banner is carrying ───────────────────────────────────────────
  // One card, one message: whatever the person most needs to know right now.
  // It used to be a fixed "today's portion" plus a separate all-done card that
  // replaced the whole screen, so a paused session said nothing at the top and
  // a finished day threw the agenda away.
  const displayPortion = showingNext ? nextSession : nextPortion;
  const displaySummary = showingNext ? nextSummary : summary;

  let bannerEyebrow = "TODAY'S PORTION";
  let bannerSub = null;
  // On a day whose point is *when* rather than *what*, the date is the
  // headline and the portion is the detail under it. Reading the portion first
  // made it look like today's work.
  let bannerTitleOverride = null;
  if (sessionDoneToday) {
    bannerEyebrow = 'ALL DONE FOR TODAY';
    bannerTitleOverride = nextSession
      ? `Next session · ${formatSessionDate(nextSession.scheduledDate)}`
      : 'Nothing scheduled yet';
    bannerSub = nextSession ? nextSummary.label : null;
  } else if (pausedSession) {
    // A status banner, not a description of the work. Someone returning to a
    // half-finished session needs one sentence telling them what happens when
    // they press the button, and the portion range is not it: it was the bold
    // line here, which put "Al-Fatihah 1 to Al-Baqarah 139" in front of someone
    // who is resuming at Al-Baqarah 20 and had already recited the first
    // nineteen. The range is the whole job, and the whole job is not the
    // status.
    bannerEyebrow = isCarriedOver
      ? `UNFINISHED · ${formatSessionDate(pausedSession.date)}`
      : 'IN PROGRESS';
    bannerTitleOverride = resumeHint;
    // What is left, in the unit that matches the phase they stopped in. Someone
    // paused inside the review is not part-way through a portion, so pages
    // would be answering a question they did not ask.
    const pausedPhase = pausedSession.phase ?? 'pre_quiz';
    if (pausedPhase === 'pre_quiz') {
      // Answering an item moves its due date off today, so the due count is
      // already the count still to do rather than the count it started with.
      // The time is the whole day's, undiminished: nothing has been recited
      // yet, so there is no share to take off it.
      bannerSub =
        quizCount > 0 && minutesLeft
          ? `${quizCount} question${quizCount === 1 ? '' : 's'} · about ${minutesLeft} min left`
          : quizCount > 0
          ? `${quizCount} question${quizCount === 1 ? '' : 's'} left`
          : minutesLeft
          ? `about ${minutesLeft} min left`
          : null;
    } else if (pausedPhase === 'revision') {
      bannerSub =
        pagesLeft > 0 && minutesLeft
          ? `${pagesLeft} page${pagesLeft === 1 ? '' : 's'} · about ${minutesLeft} min left`
          : minutesLeft
          ? `about ${minutesLeft} min left`
          : null;
    } else {
      // The recap. Its items come from this session's mistakes rather than from
      // a due date, so answering one does not remove it from the list and there
      // is nothing here that can honestly be called a count "left".
      //
      // A time still can be. minutesLeft is no use here: the portion is fully
      // recited by this phase, so it scales the day's estimate by zero and
      // clamps to a flat "1 min" that is not a measurement of anything. The
      // recap's own allowance is, and it is the one part of the day still
      // ahead of them.
      const recapMinutes = roundedEstimateMinutes(
        postSessionQuizMinutes(summary?.pages ?? 0)
      );
      bannerSub = recapMinutes ? `about ${recapMinutes} min left` : null;
    }
  } else if (showingNext) {
    bannerEyebrow = 'NOTHING DUE TODAY';
    bannerTitleOverride = `Next session · ${formatSessionDate(nextSession.scheduledDate)}`;
    bannerSub = nextSummary.label;
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
  } else if (quizOnly && quizCount > 0) {
    // The eyebrow defaults to "TODAY'S PORTION", which sat above the words
    // "Quiz only today" and contradicted them in the same breath. A day with no
    // portion should not be announcing one.
    bannerEyebrow = 'MISTAKE REVIEW';
    // A quiz-only day was also the one shape of day that priced itself and then
    // said nothing. There is no portion, so the branch above it never ran, and
    // this line was left empty even though the estimate is real: it is costed
    // from the ayahs actually due.
    bannerSub =
      estimateMinutes
        ? `${quizCount} question${quizCount === 1 ? '' : 's'} · about ${estimateMinutes} min`
        : `${quizCount} question${quizCount === 1 ? '' : 's'}`;
  }

  const bannerTitle =
    bannerTitleOverride ??
    (displaySummary
      ? displaySummary.label
      : nothingDue
      ? 'Nothing due today'
      : quizOnly
      ? 'Quiz only today'
      : 'Unable to load portion');

  // ── Which agenda steps are behind them ────────────────────────────────────
  // Phase is written as the session moves, so a paused session already knows
  // how far it reached. Finishing the day crosses everything out.
  // Only today's session may say anything about today's progress.
  //
  // The paused-session query has no date filter, so this used to read the phase
  // of a session paused on an earlier day. Pause mid-recitation on Monday, and
  // the mistakes made in it fall due on Tuesday: Tuesday's agenda then showed
  // Mistake Review and immediately crossed it off, because Monday's session was
  // still sitting at phase 'revision'. The step was reported done by a value
  // from a day that had already ended, for a review that had never run.
  const phase =
    pausedSession && pausedSession.date === getTodayDateString()
      ? pausedSession.phase ?? null
      : null;
  const quizStepDone = sessionDoneToday || phase === 'revision' || phase === 'post_quiz';
  const reciteStepDone = sessionDoneToday || phase === 'post_quiz';
  const recapStepDone = sessionDoneToday;

  // ── Which agenda steps exist at all ───────────────────────────────────────
  // Mistake review is a step only when something is genuinely due. It used to
  // be printed unconditionally, so a new account was told to review mistakes it
  // could not yet have made. Worse, the empty quiz auto-skips and writes phase
  // 'revision', which crossed the step off: a review both invented and marked
  // complete without anyone having done anything.
  const hasReviewStep = quizCount > 0;

  // The recap quizzes the mistakes made while reciting, so it only runs when
  // the portion was recited and produced some. A finished day with none never
  // saw it, so listing it would be inventing a step after the fact. A session
  // paused part way keeps it: the portion is unfinished, and whether it earns a
  // recap cannot be known until it is.
  // Whether the agenda *on screen* involves reciting. When the next session is
  // being previewed this is not today's answer: `quizOnly` is true precisely
  // because today has no portion, which is the reason the preview is showing at
  // all. Reading it directly listed a recitation step with no recap under it.
  const agendaIsQuizOnly = showingNext ? false : quizOnly;

  const hasRecapStep = !agendaIsQuizOnly && (sessionDoneToday ? doneMistakeCount > 0 : true);

  // Numbering follows what is actually shown rather than fixed positions.
  const firstPortionStep = hasReviewStep ? 2 : 1;

  // ── How far through the day they are ──────────────────────────────────────
  // The ring covers the whole session, not just the recitation. Shares are
  // fixed rather than proportional to item counts, so finishing a three-item
  // review still visibly moves it: proportionally it would be worth about 3%
  // against a ninety-ayah portion, which reads as no progress for real work.
  // Only the parts that exist are counted, and the weights are normalised
  // against those, so a day without a recap can still fill the ring.
  const RING_WEIGHT = { review: 25, recite: 65, recap: 10 };

  const reciteFraction = sessionDoneToday ? 1 : portionDoneFraction;

  const ringParts = [];
  if (hasReviewStep) ringParts.push([RING_WEIGHT.review, quizStepDone ? 1 : 0]);
  if (!agendaIsQuizOnly) ringParts.push([RING_WEIGHT.recite, reciteFraction]);
  if (hasRecapStep) ringParts.push([RING_WEIGHT.recap, recapStepDone ? 1 : 0]);

  const ringWeightTotal = ringParts.reduce((sum, [w]) => sum + w, 0);
  // A quiz-only day that is finished has no weighted parts at all, so it is
  // reported full rather than as a divide by zero.
  const ringFraction = ringWeightTotal
    ? ringParts.reduce((sum, [w, done]) => sum + w * done, 0) / ringWeightTotal
    : sessionDoneToday
    ? 1
    : 0;
  // The agenda belongs to whichever session is on screen.
  const agendaPortions = sessionDoneToday && donePortion
    ? [donePortion]
    : showingNext
    ? [nextSession]
    : portions.length
    ? portions
    : pausedPortion
    ? [pausedPortion]
    : [];

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
                <SessionRing fraction={ringFraction} />
              </View>
              <View style={styles.portionRight}>
                <Text style={styles.portionEyebrow}>{bannerEyebrow}</Text>
                {portionLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ alignSelf: 'flex-start', marginVertical: 4 }} />
                ) : (
                  <>
                    <Text style={styles.portionTitle}>{bannerTitle}</Text>
                    {bannerSub ? <Text style={styles.portionSub}>{bannerSub}</Text> : null}
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
                  {hasReviewStep ? (
                    <StepCard
                      step={1} icon="◈" title="Mistake Review"
                      desc={`${quizCount} ayah${quizCount === 1 ? '' : 's'} to go over`}
                      iconBg={colors.ice} iconColor={colors.primary}
                      done={quizStepDone}
                    />
                  ) : null}
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
                        step={i + firstPortionStep}
                        icon="◉"
                        title={label ? `Recite ${label}` : "Recite today's portion"}
                        desc={(() => {
                          // The size of the thing, in the unit the rest of the
                          // screen uses. Mistake Review states its count and
                          // this said "We follow along as you go", which is a
                          // reassurance rather than an answer to "how much?".
                          const pg = Math.max(1, Math.round(p.pages ?? 0));
                          const size = p.pages ? `${pg} page${pg === 1 ? '' : 's'}` : null;
                          if (agendaPortions.length > 1) {
                            return size ? `Juz ${p.juzNumber} · ${size}` : `Juz ${p.juzNumber}`;
                          }
                          return size ?? 'We follow along as you go';
                        })()}
                        iconBg={colors.parchment} iconColor={colors.brown}
                        done={reciteStepDone}
                      />
                    );
                  })}
                  {hasRecapStep ? (
                    <StepCard
                      step={agendaPortions.length + firstPortionStep} icon="◆" title="Recap quiz"
                      desc="Goes over any mistakes"
                      iconBg={colors.parchment} iconColor={colors.accent}
                      done={recapStepDone}
                    />
                  ) : null}
                </View>
              </>
            )}

            {/* The resume point lives in the banner now, which is the one
                place the main update belongs. It was printed here too. */}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {/* The count moved onto the Mistake Review step itself, where the
                other steps carry their detail. Printed twice, it read as two
                different facts. */}
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
