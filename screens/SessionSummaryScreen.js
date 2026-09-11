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
import { useSQLiteContext } from 'expo-sqlite';
import { CommonActions, useNavigation } from '@react-navigation/native';
import TabBar from '../components/TabBar';
import { getCurrentUserId } from '../lib/auth';
import {
  addDays,
  formatDayLabel as formatSessionDate,
  todayString as getTodayDateString,
  tomorrowString as getTomorrowDateString,
} from '../lib/dates';
import { getAyahLocation, getJuzTotalAyahs } from '../lib/juzSurahMap';
import { cancelEveningNudge } from '../lib/notifications';
import { getPortionsForDate, previewNextInterval } from '../lib/planEngine';
import { supabase } from '../lib/supabase';
import { colors, fonts, radius, spacing } from '../lib/theme';

/**
 * What to call the session on screen.
 *
 * This tab keeps showing the last completed session until a new one is
 * finished, so the day after a session it is showing yesterday's work. "Session
 * 28 Aug" is accurate and tells you nothing; a day close enough to have a name
 * gets its name.
 */
function sessionHeading(dateStr) {
  if (!dateStr) return 'Session';
  const today = getTodayDateString();
  if (dateStr === today) return "Today's session";
  if (dateStr === addDays(today, -1)) return "Yesterday's session";
  return `Session · ${formatSessionDate(dateStr)}`;
}

/**
 * What to call the portion in the up-next card.
 *
 * It was hardcoded to TOMORROW, but the query behind it takes the earliest
 * pending portion due up to and including tomorrow. Viewing yesterday's summary
 * today, or having a backlog, therefore labelled work that is due now as
 * tomorrow's.
 */
function upNextLabel(scheduledDate) {
  if (!scheduledDate) return 'TOMORROW';
  const today = getTodayDateString();
  if (scheduledDate <= today) return 'TODAY';
  if (scheduledDate === getTomorrowDateString()) return 'TOMORROW';
  return formatSessionDate(scheduledDate).toUpperCase();
}

function formatPortionLine(portion) {
  const start = getAyahLocation(portion.juzNumber, portion.portionStartAyah);
  const end = getAyahLocation(portion.juzNumber, portion.portionEndAyah);
  if (start.surahNumber === end.surahNumber) {
    return `${start.surahName} · ${start.ayahNumber}–${end.ayahNumber}`;
  }
  return `${start.surahName} ${start.ayahNumber} to ${end.surahName} ${end.ayahNumber}`;
}

function StatPill({ value, label, color }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * One mistake, openable on its own.
 *
 * A day with several mistakes was several full comparisons stacked up, and the
 * list scrolled past the one being looked for. Closed, a card is its ayah and
 * its word count, which is enough to find the right one; open, it is the whole
 * comparison. The first opens by default so the common case, a single mistake,
 * does not cost a second tap.
 */

export default function SessionSummaryScreen({ route }) {
  const navigation = useNavigation();
  // Tomorrow's portion is sized from the real mushaf, so scheduling it needs
  // the bundled page data. Provided by SQLiteProvider in App.js.
  const db = useSQLiteContext();
  const sessionId = route?.params?.sessionId;
  const totalAyahsInJuzParam = route?.params?.totalAyahsInJuz;

  // Bumped when this screen comes back into view, so the counts and the date
  // it quotes are re-read.
  //
  // They were read once on mount and never again. Correcting mistakes happens
  // on a page opened from here, so coming back showed the numbers from before
  // the corrections: five mistakes when four had just been cleared, and, on a
  // finished juz, a return date worked out from all five. The schedule itself
  // was always computed later and correctly. This screen was simply quoting
  // something that had stopped being true while it sat there.
  const [reloadKey, setReloadKey] = useState(0);
  // The first focus is this screen arriving, which the load below is already
  // doing. Only a return to it is news.
  const seenFirstFocusRef = useRef(false);

  useEffect(
    () =>
      navigation.addListener('focus', () => {
        if (!seenFirstFocusRef.current) {
          seenFirstFocusRef.current = true;
          return;
        }
        setReloadKey((n) => n + 1);
      }),
    [navigation]
  );

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [mistakeCounts, setMistakeCounts] = useState({ recitation: 0, review: 0 });
  // Whether there is anything at all to offer for correction, across both parts.
  const totalMistakes = mistakeCounts.recitation + mistakeCounts.review;
  const [tomorrowText, setTomorrowText] = useState(null);
  const [nextLabel, setNextLabel] = useState('TOMORROW');
  const [juzComplete, setJuzComplete] = useState(false);
  // Collapsed to begin with. Opening the tab to check on a day should not lead
  // with a wall of red; the count is the summary and the detail is a choice.
  const [returnsInDays, setReturnsInDays] = useState(null);
  // Null when opened from the tab, which is the entry point with no route
  // params. Resolved below to the most recent session.
  const [resolvedSessionId, setResolvedSessionId] = useState(sessionId ?? null);
  const opacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.5)).current;

  // Opened from the tab rather than at the end of a session, so there is no id
  // in the route. Fall back to the most recent one: this screen is now the only
  // place mistakes can be corrected, and that window must not be a single
  // screen someone can swipe past.
  useEffect(() => {
    if (sessionId) return;
    let mounted = true;
    (async () => {
      try {
        const userId = await getCurrentUserId();
        // Completed only. This took the most recent session of any status, so
        // a paused one counted: a session someone had started and walked away
        // from was presented as a finished one, and because a paused portion
        // can run to the end of its juz it drew "Juz 1 Complete!" for work
        // nobody had done.
        const { data } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'complete')
          .order('date', { ascending: false })
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (mounted) {
          setResolvedSessionId(data?.id ?? null);
          if (!data?.id) setIsLoading(false);
        }
      } catch {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [sessionId]);

  // The screen fades in once loading ends, whatever the outcome. This used to
  // live inside the session-loading effect, which returns early when there is
  // no session to load, so the "nothing to review yet" state was rendered at
  // opacity zero: a blank grey screen. It was unreachable until the fallback
  // stopped accepting paused sessions, and then it was the first thing a new
  // person saw.
  useEffect(() => {
    if (isLoading) return;
    Animated.timing(opacity, {
      toValue: 1, duration: 600, useNativeDriver: true,
    }).start();
  }, [isLoading, opacity]);

  useEffect(() => {
    if (!resolvedSessionId) return;

    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);
        setError('');

        const { data: sessionData, error: sessionError } = await supabase
          .from('sessions')
          .select(
            'id, date, portion_start_ayah, portion_end_ayah, juz_number, completed_at, status, plan_applied, type'
          )
          .eq('id', resolvedSessionId)
          .single();

        if (sessionError) {
          throw new Error(sessionError.message);
        }

        const userId = await getCurrentUserId();

        // A quiz-only day has no portion, so the offsets on its row are filler
        // and nothing may be concluded from them. Read the type first.
        const isQuizOnly = sessionData.type === 'quiz_only';

        const totalAyahsInJuz =
          totalAyahsInJuzParam ?? getJuzTotalAyahs(sessionData.juz_number);
        const isJuzComplete =
          !isQuizOnly && sessionData.portion_end_ayah >= totalAyahsInJuz;

        // plan_applied is persisted, not held in state. A React ref resets on
        // every mount, so reopening this screen for the same session used to
        // double-count its mistakes, multiply the review interval twice, and
        // write a second scheduled row. Harmless when the screen was only ever
        // reached once at the end of a session; not harmless now it is a tab.
        // The guard matters here and not only in the flow: this screen is also
        // a tab, and opening it resolves to the most recent session whatever
        // that session was. Without it, visiting the tab after a quiz-only day
        // would advance the recitation plan off a portion nobody recited.
        // Scoring deliberately does NOT happen here any more.
        //
        // It used to run on mount, which put it before the one thing this
        // screen exists for. Someone misheard five times had the session judged
        // as five mistakes, the portion halved and the juz pulled forward, and
        // was only then shown the list and invited to say the app had misheard
        // them. Clearing all five removed the mistakes and left every
        // consequence of them standing.
        //
        // applyPendingSessionPlans() on the Today screen does it instead, on
        // the way back, by which point the corrections are in the table.
        // plan_applied still guards it, so a session is scored exactly once.

        // The pass/fail gate is gone. Finishing a juz is finishing a juz; what
        // is worth telling someone is when it comes back, which the spaced
        // repetition schedule has just worked out.
        let returnsIn = null;
        if (isJuzComplete && !isQuizOnly) {
          // Computed rather than read. juz_progress still holds the previous
          // pass's interval until scoring runs, so reading it would tell
          // someone the wrong day. Same function the real scoring uses.
          try {
            returnsIn = await previewNextInterval(
              db,
              userId,
              resolvedSessionId,
              sessionData.juz_number
            );
          } catch {
            returnsIn = null;
          }
        }

        // Asked of the same engine the agenda asks, rather than queried out of
        // scheduled_portions here. The old query disagreed with the agenda in
        // three ways: `.limit(1)` announced a two-juz day as one juz, it read
        // the stored range while the agenda re-sizes every row to fit the day,
        // and it costed nothing for the review while the agenda pays for the
        // quiz first and gives the portion what is left. Two screens quietly
        // disagreeing about the same day is worse than either being wrong,
        // because nothing looks broken.
        //
        // This session is passed in because it has finished but is not yet
        // scored, scoring having been moved after the corrections below. Its
        // rows are still pending, so without this the preview would offer back
        // the portion just recited.
        let nextTomorrowText = null;
        try {
          const tomorrowPortions = await getPortionsForDate(
            db,
            userId,
            getTomorrowDateString(),
            isQuizOnly
              ? null
              : {
                  juzNumber: sessionData.juz_number,
                  portionStartAyah: sessionData.portion_start_ayah,
                  portionEndAyah: sessionData.portion_end_ayah,
                }
          );

          nextTomorrowText = tomorrowPortions.length
            ? tomorrowPortions.map(formatPortionLine).join('\n')
            : 'Quiz only';
        } catch {
          nextTomorrowText = 'Quiz only';
        }

        // Only the counts. The ayah text behind each mistake is loaded by the
        // page that shows them, which is the one that needs it: fetching every
        // ayah here made the summary wait on work it then did not display.
        const { data: mistakesData, error: mistakesError } = await supabase
          .from('mistakes')
          .select('source')
          .eq('session_id', resolvedSessionId)
          .is('dismissed_at', null);

        if (mistakesError) {
          throw new Error(mistakesError.message);
        }

        const counts = { recitation: 0, review: 0 };
        for (const m of mistakesData ?? []) {
          const key = m.source === 'review' ? 'review' : 'recitation';
          counts[key] += 1;
        }

        if (!mounted) {
          return;
        }

        setSession(sessionData);
        setMistakeCounts(counts);
        setTomorrowText(nextTomorrowText);
        setNextLabel(upNextLabel(tomorrow?.scheduled_date));
        setJuzComplete(isJuzComplete);
        setReturnsInDays(returnsIn);
      } catch (err) {
        if (mounted) {
          setError(err.message ?? 'Failed to load session summary.');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
          Animated.spring(checkScale, {
            toValue: 1, friction: 6, tension: 50, useNativeDriver: true,
          }).start();
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [resolvedSessionId, totalAyahsInJuzParam, reloadKey]);

  // Tiers are dropped, so there is one count, not two.


  // Arriving at the end of a session gets a "back to home" button, since there
  // is a flow to leave. Arriving from the tab gets the tab bar instead.
  const cameFromSession = Boolean(sessionId);

  const handleBackToHome = () => {
    cancelEveningNudge().catch(() => {});
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Today' }],
      })
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
        {cameFromSession ? (
          <TouchableOpacity style={styles.homeBtn} onPress={handleBackToHome} activeOpacity={0.88}>
            <Text style={styles.homeBtnText}>Back to home</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  // Opened from the tab before any session has been done. Without this it
  // would fall through and claim "No mistakes this session", which is true but
  // misleading when there has been no session at all.
  if (!session) {
    return (
      <Animated.View style={[styles.screen, { opacity }]}>
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>✦</Text>
          <Text style={styles.emptyText}>
            Nothing to review yet. Finish a session and your mistakes will show up here.
          </Text>
        </View>
        <TabBar active="summary" navigation={navigation} />
      </Animated.View>
    );
  }

  let portionLabel = '';
  if (session) {
    const start = getAyahLocation(session.juz_number, session.portion_start_ayah);
    const end = getAyahLocation(session.juz_number, session.portion_end_ayah);
    portionLabel =
      start.surahNumber === end.surahNumber
        ? `${start.surahName} · Ayahs ${start.ayahNumber}–${end.ayahNumber}`
        : `${start.surahName} ${start.ayahNumber} to ${end.surahName} ${end.ayahNumber}`;
  }

  // Zero on a quiz-only day. Its portion columns are filler, so subtracting them
  // would report an ayah recited that nobody recited.
  const ayahCount =
    session && session.type !== 'quiz_only'
      ? session.portion_end_ayah - session.portion_start_ayah + 1
      : 0;

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <View style={styles.content}>
        {juzComplete ? (
          <View style={styles.juzCompleteCard}>
            <Text style={styles.juzCompleteTitle}>Juz {session?.juz_number} Complete!</Text>
            <Text style={styles.gateText}>
              {returnsInDays
                ? returnsInDays === 1
                  ? 'You will see it again tomorrow.'
                  : `You will see it again in ${returnsInDays} days.`
                : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.successSection}>
            {/* The tick used to stand down while the list was open, to hand the
                list the room it takes. That was solving a problem the list does
                not have: it scrolls, so a shorter region shows fewer mistakes
                rather than losing any. What it cost was the one element that
                says the session is finished, on the screen whose whole job is
                to say so, and only on the days there was something to review. */}
            <Animated.View style={[styles.checkCircle, { transform: [{ scale: checkScale }] }]}>
              <Text style={styles.checkIcon}>✓</Text>
            </Animated.View>
            {/* The tab is opened on days after the session as well, so the
                heading names the day it belongs to rather than announcing a
                completion that may have happened last week. */}
            <Text style={styles.successTitle}>{sessionHeading(session?.date)}</Text>
            <Text style={styles.successSub}>{portionLabel}</Text>
          </View>
        )}

        <View style={styles.statsRow}>
          <StatPill value={String(ayahCount)} label="ayat recited" color={colors.primary} />
          <View style={styles.statDivider} />
          {/* Recitation only, which is what this number has always counted and
              what the one beside it measures. Review mistakes are made in ayahs
              outside the portion, and blocks overlap each other and the portion,
              so folding them in gives a rate over the wrong denominator and
              quietly changes what every past session's figure meant. The review
              has its own count in the rows below. */}
          <StatPill
            value={String(mistakeCounts.recitation)}
            // Named for the portion, because that is all it counts. Unqualified,
            // a green zero here sat directly above a Mistake Review row holding
            // three ayahs, and the two read as contradicting each other.
            label={mistakeCounts.recitation === 1 ? 'portion mistake' : 'portion mistakes'}
            color={mistakeCounts.recitation === 0 ? colors.success : colors.error}
          />
        </View>

        {/* One row per part of the session, each opening the page where those
            mistakes are corrected. They used to be one list of recitation
            mistakes inline, which left no room for the Mistake Review's own and
            pushed up next off the bottom on a bad day. A count apiece keeps the
            summary a fixed height and gives the review somewhere to live. */}
        {totalMistakes > 0 ? (
          <>
            <Text style={styles.sectionLabel}>TO REVIEW</Text>
            {[
              { key: 'review', label: 'Mistake Review', count: mistakeCounts.review },
              { key: 'recitation', label: 'Recitation', count: mistakeCounts.recitation },
            ]
              // A part with nothing flagged is not worth a row to tap into.
              .filter((row) => row.count > 0)
              .map((row) => (
                <TouchableOpacity
                  key={row.key}
                  style={styles.sourceCard}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.label}, ${row.count} ${
                    row.count === 1 ? 'ayah' : 'ayahs'
                  } to review`}
                  onPress={() =>
                    navigation.navigate('SessionMistakes', {
                      sessionId: resolvedSessionId,
                      source: row.key,
                    })
                  }
                >
                  <View>
                    <Text style={styles.sourceCardTitle}>{row.label}</Text>
                    <Text style={styles.sourceCardCount}>
                      {row.count} {row.count === 1 ? 'ayah' : 'ayahs'}
                    </Text>
                  </View>
                  <Text style={styles.cardChevron}>{'\u25b8'}</Text>
                </TouchableOpacity>
              ))}
            <View style={styles.filler} />
          </>
        ) : (
          <>
            <View style={styles.cleanCard}>
              <Text style={styles.cleanIcon}>✦</Text>
              <Text style={styles.cleanText}>No mistakes this session. Excellent work.</Text>
            </View>
            <View style={styles.filler} />
          </>
        )}

        {tomorrowText ? (
          <View>
            <Text style={styles.sectionLabel}>UP NEXT</Text>
            <View style={styles.nextCard}>
              <Text style={styles.nextLabel}>{nextLabel}</Text>
              <Text style={styles.nextTitle}>{tomorrowText}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {cameFromSession ? (
        <View style={styles.cta}>
          <TouchableOpacity style={styles.homeBtn} onPress={handleBackToHome} activeOpacity={0.88}>
            <Text style={styles.homeBtnText}>Back to home</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TabBar active="summary" navigation={navigation} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  sourceCardTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.text },
  sourceCardCount: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted, marginTop: 2 },
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  // The page no longer scrolls as a whole. This is a fixed-height column:
  // header, then the mistake region which takes whatever is left, then up next
  // pinned above the button or the tab bar.
  content: {
    flex: 1,
    paddingTop: 64,
    paddingHorizontal: spacing.lg,
    paddingBottom: 16,
  },
  // Holds the same space open when the list is closed, so up next does not
  filler: { flex: 1 },
  successSection: { alignItems: 'center', marginBottom: spacing.lg },
  checkCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.success,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  checkIcon: { fontSize: 32, color: colors.white, fontWeight: '700' },
  successTitle: {
    fontFamily: fonts.semiBold, fontSize: 26, color: colors.text,
    letterSpacing: -0.3, marginBottom: 6,
  },
  successSub: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMid },

  juzCompleteCard: {
    backgroundColor: colors.successLight,
    borderWidth: 2,
    borderColor: colors.success,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  juzCompleteTitle: {
    fontFamily: fonts.semiBold, fontSize: 24, color: colors.success,
    marginBottom: 10, textAlign: 'center',
  },
  gateText: { fontFamily: fonts.regular, fontSize: 15, color: colors.text, textAlign: 'center', lineHeight: 22 },

  statsRow: {
    flexDirection: 'row', backgroundColor: colors.card, borderRadius: 16,
    padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  statPill: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: fonts.semiBold, fontSize: 24, letterSpacing: -0.5, marginBottom: 2 },
  statLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMid },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },

  sectionLabel: {
    fontFamily: fonts.semiBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: spacing.sm,
  },

  cardChevron: { fontSize: 14, color: colors.textMuted },

  cleanCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.successLight, borderRadius: 14, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.success,
  },
  emptyIcon: { fontSize: 30, color: colors.textMuted, marginBottom: spacing.md },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMid,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  cleanIcon: { fontSize: 18, color: colors.success },
  cleanText: { fontFamily: fonts.medium, fontSize: 14, color: colors.success, flex: 1 },

  // Brown, not blue: the button under it is the primary blue, and two filled
  // blue blocks stacked read as one control split in two.
  nextCard: {
    backgroundColor: colors.brown, borderRadius: 16, padding: spacing.md,
    marginBottom: spacing.md,
  },
  nextLabel: {
    fontFamily: fonts.semiBold, fontSize: 10, color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4,
  },
  // Optical, not layout: both lines are laid out at the same x, but measured in
  // ink the eyebrow's T starts 0.1px in and the portion's A starts 1.6px in, so
  // the two read as stepped. The nudge puts them on one edge.
  nextTitle: {
    fontFamily: fonts.semiBold, fontSize: 20, color: colors.white,
    letterSpacing: -0.2, marginLeft: -1.5,
  },

  error: {
    fontFamily: fonts.regular,
    color: colors.error,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  cta: {
    // Was absolute, which needed a spacer inside the old page-wide ScrollView
    // to stop content hiding behind it. In a flex column it is simply the last
    // child, the same as the tab bar it stands in for.
    paddingHorizontal: spacing.lg,
    paddingBottom: 48,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  homeBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  homeBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
});
