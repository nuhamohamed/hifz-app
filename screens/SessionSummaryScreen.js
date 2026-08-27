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
import { getAyahLocation, getJuzTotalAyahs, getSurahName } from '../lib/juzSurahMap';
import { cancelEveningNudge } from '../lib/notifications';
import { getAyah } from '../lib/quranApi';
import { updateJuzProgressAfterSession } from '../lib/planEngine';
import { removeFromQuizQueue } from '../lib/quizEngine';
import { supabase } from '../lib/supabase';
import { colors, fonts, spacing } from '../lib/theme';

function getTomorrowDateString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTomorrowLine(tomorrow) {
  const start = getAyahLocation(
    tomorrow.juz_number,
    tomorrow.portion_start_ayah
  );
  const end = getAyahLocation(
    tomorrow.juz_number,
    tomorrow.portion_end_ayah
  );
  if (start.surahNumber === end.surahNumber) {
    return `${start.surahName} · ${start.ayahNumber}–${end.ayahNumber}`;
  }
  return `${start.surahName} ${start.ayahNumber} to ${end.surahName} ${end.ayahNumber}`;
}

function buildWrongWordIndices(words, wrongWords) {
  const remaining = [...(wrongWords ?? [])];
  const indices = new Set();
  words.forEach((word, i) => {
    const display = word.textDisplay;
    const idx = remaining.indexOf(display);
    if (idx >= 0) {
      indices.add(i);
      remaining.splice(idx, 1);
    }
  });
  return indices;
}

function AyahTextWithHighlights({ words, wrongWords, isDisconnectedLetters, onClearWord }) {
  if (isDisconnectedLetters) {
    const text = words.map((w) => w.textCompare).join(' ');
    return <Text style={styles.compWord}>{text}</Text>;
  }

  const wrongIndices = buildWrongWordIndices(words, wrongWords);
  const displayWords = words.map((w) => w.textDisplay);

  return (
    <Text style={styles.compWord}>
      {displayWords.map((word, i) =>
        wrongIndices.has(i) ? (
          // Each flagged word clears on its own. The app cannot tell a real
          // memory slip from the recogniser mishearing a word; the person
          // reading the transcript beside the expected text can.
          <Text
            key={i}
            style={styles.ayahWordWrong}
            onPress={onClearWord ? () => onClearWord(word) : undefined}
            suppressHighlighting={false}
          >
            {word}{' '}
          </Text>
        ) : (
          <Text key={i} style={styles.compCorrect}>
            {word}{' '}
          </Text>
        )
      )}
    </Text>
  );
}

function StatPill({ value, label, color }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MistakeCard({ mistake, onDismiss, onClearWord }) {
  const wrongCount = mistake.wrong_words?.length ?? 0;

  return (
    <View style={styles.mistakeCard}>
      <View style={styles.mistakeCardHeader}>
        <Text style={styles.mistakeAyahLabel}>
          {getSurahName(mistake.surah_number)} {mistake.ayah_number}
        </Text>
        {/* Tiers are gone: every mistake counts the same. The count of flagged
            words is the useful detail now, since clearing them all is what
            removes the ayah. */}
        <View style={[styles.badge, styles.badgeConfirmed]}>
          <Text style={[styles.badgeText, styles.badgeTextConfirmed]}>
            {wrongCount === 1 ? '1 word' : `${wrongCount} words`}
          </Text>
        </View>
      </View>

      <View style={styles.compRow}>
        <View style={styles.compCol}>
          <Text style={styles.compLabel}>What you said</Text>
          <Text style={[styles.compWord, styles.compWrong]}>
            {mistake.transcribed_text || '—'}
          </Text>
        </View>
        <View style={styles.compDivider} />
        <View style={styles.compCol}>
          <Text style={styles.compLabel}>Expected</Text>
          <AyahTextWithHighlights
            words={mistake.words}
            wrongWords={mistake.wrong_words}
            isDisconnectedLetters={mistake.isDisconnectedLetters}
            onClearWord={onClearWord}
          />
        </View>
      </View>

      <Text style={styles.tapHint}>Tap a red word if the app misheard you.</Text>

      <TouchableOpacity style={styles.notMistakeBtn} onPress={onDismiss} activeOpacity={0.7}>
        <Text style={styles.notMistakeBtnText}>Not a mistake at all</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function SessionSummaryScreen({ route }) {
  const navigation = useNavigation();
  // Tomorrow's portion is sized from the real mushaf, so scheduling it needs
  // the bundled page data. Provided by SQLiteProvider in App.js.
  const db = useSQLiteContext();
  const sessionId = route?.params?.sessionId;
  const totalAyahsInJuzParam = route?.params?.totalAyahsInJuz;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [mistakes, setMistakes] = useState([]);
  const [tomorrowText, setTomorrowText] = useState(null);
  const [juzComplete, setJuzComplete] = useState(false);
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
        const { data } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', userId)
          .order('date', { ascending: false })
          .order('started_at', { ascending: false })
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
            'id, portion_start_ayah, portion_end_ayah, juz_number, completed_at, status, plan_applied'
          )
          .eq('id', resolvedSessionId)
          .single();

        if (sessionError) {
          throw new Error(sessionError.message);
        }

        const userId = await getCurrentUserId();

        const totalAyahsInJuz =
          totalAyahsInJuzParam ?? getJuzTotalAyahs(sessionData.juz_number);
        const isJuzComplete =
          sessionData.portion_end_ayah >= totalAyahsInJuz;

        // plan_applied is persisted, not held in state. A React ref resets on
        // every mount, so reopening this screen for the same session used to
        // double-count its mistakes, multiply the review interval twice, and
        // write a second scheduled row. Harmless when the screen was only ever
        // reached once at the end of a session; not harmless now it is a tab.
        if (sessionData.status === 'complete' && !sessionData.plan_applied) {
          await supabase
            .from('sessions')
            .update({ plan_applied: true })
            .eq('id', resolvedSessionId);
          await updateJuzProgressAfterSession(
            db,
            userId,
            resolvedSessionId,
            sessionData.juz_number,
            sessionData.portion_end_ayah,
            totalAyahsInJuz
          );
        }

        // The pass/fail gate is gone. Finishing a juz is finishing a juz; what
        // is worth telling someone is when it comes back, which the spaced
        // repetition schedule has just worked out.
        let returnsIn = null;
        if (isJuzComplete) {
          const { data: progressData } = await supabase
            .from('juz_progress')
            .select('interval_days')
            .eq('user_id', userId)
            .eq('juz_number', sessionData.juz_number)
            .maybeSingle();
          returnsIn = progressData?.interval_days ?? null;
        }

        const { data: tomorrow, error: tomorrowError } = await supabase
          .from('scheduled_portions')
          .select('juz_number, portion_start_ayah, portion_end_ayah, type')
          .eq('user_id', userId)
          .eq('scheduled_date', getTomorrowDateString())
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (tomorrowError) {
          throw new Error(tomorrowError.message);
        }

        let nextTomorrowText = null;
        if (tomorrow?.type === 'quiz_only') {
          nextTomorrowText = 'Quiz only';
        } else if (tomorrow) {
          nextTomorrowText = formatTomorrowLine(tomorrow);
        } else {
          nextTomorrowText = 'Quiz only';
        }

        const { data: mistakesData, error: mistakesError } = await supabase
          .from('mistakes')
          .select('ayah_number, surah_number, wrong_words, transcribed_text')
          .eq('session_id', resolvedSessionId)
          .order('ayah_number', { ascending: true });

        if (mistakesError) {
          throw new Error(mistakesError.message);
        }

        const enrichedMistakes = await Promise.all(
          (mistakesData ?? []).map(async (m) => {
            const ayah = await getAyah(m.surah_number, m.ayah_number);
            return {
              ...m,
              words: ayah.words,
              isDisconnectedLetters: ayah.isDisconnectedLetters,
            };
          })
        );

        if (!mounted) {
          return;
        }

        setSession(sessionData);
        setMistakes(enrichedMistakes);
        setTomorrowText(nextTomorrowText);
        setJuzComplete(isJuzComplete);
        setReturnsInDays(returnsIn);
      } catch (err) {
        if (mounted) {
          setError(err.message ?? 'Failed to load session summary.');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
          Animated.parallel([
            Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
            Animated.spring(checkScale, { toValue: 1, friction: 6, tension: 50, useNativeDriver: true }),
          ]).start();
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [resolvedSessionId, totalAyahsInJuzParam]);

  // Tiers are dropped, so there is one count, not two.
  const mistakeCount = mistakes.length;

  /**
   * Stops an ayah being a mistake at all: removes the record that feeds the juz
   * count AND the review queue entry.
   *
   * The old version deleted only the mistake row, so a misflagged ayah kept
   * being quizzed every morning after the person had said it was fine. It also
   * matched on ayah number with no surah filter, so dismissing Al-Baqarah 5
   * removed Ali Imran 5 from the same session, and filtered on tier, which no
   * longer means anything.
   */
  const removeMistakeEntirely = useCallback(async (mistake) => {
    if (!resolvedSessionId) return;
    await supabase
      .from('mistakes')
      .delete()
      .eq('session_id', resolvedSessionId)
      .eq('surah_number', mistake.surah_number)
      .eq('ayah_number', mistake.ayah_number);

    try {
      const userId = await getCurrentUserId();
      await removeFromQuizQueue(userId, mistake.surah_number, mistake.ayah_number);
    } catch (err) {
      console.error('[Summary] failed to clear the review queue:', err.message);
    }
  }, [resolvedSessionId]);

  const handleDismissMistake = useCallback(async (index, mistake) => {
    setMistakes((prev) => prev.filter((_, i) => i !== index));
    await removeMistakeEntirely(mistake);
  }, [removeMistakeEntirely]);

  /**
   * Clears one misheard word. A mistake is still one ayah however many words
   * are wrong in it, so clearing some words leaves the ayah counted. Only when
   * every flagged word is gone does the ayah stop being a mistake.
   */
  const handleClearWord = useCallback(async (index, mistake, word) => {
    const remaining = [...(mistake.wrong_words ?? [])];
    const at = remaining.indexOf(word);
    if (at < 0) return;
    remaining.splice(at, 1);

    setMistakes((prev) =>
      remaining.length === 0
        ? prev.filter((_, i) => i !== index)
        : prev.map((m, i) => (i === index ? { ...m, wrong_words: remaining } : m))
    );

    if (remaining.length === 0) {
      await removeMistakeEntirely(mistake);
      return;
    }

    if (!resolvedSessionId) return;
    const { error } = await supabase
      .from('mistakes')
      .update({ wrong_words: remaining })
      .eq('session_id', resolvedSessionId)
      .eq('surah_number', mistake.surah_number)
      .eq('ayah_number', mistake.ayah_number);
    if (error) {
      console.error('[Summary] failed to clear a word:', error.message);
    }
  }, [resolvedSessionId, removeMistakeEntirely]);

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

  const ayahCount = session ? session.portion_end_ayah - session.portion_start_ayah + 1 : 0;

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
            <Animated.View style={[styles.checkCircle, { transform: [{ scale: checkScale }] }]}>
              <Text style={styles.checkIcon}>✓</Text>
            </Animated.View>
            <Text style={styles.successTitle}>Session complete</Text>
            <Text style={styles.successSub}>{portionLabel}</Text>
          </View>
        )}

        <View style={styles.statsRow}>
          <StatPill value={String(ayahCount)} label="ayat recited" color={colors.primary} />
          <View style={styles.statDivider} />
          <StatPill
            value={String(mistakes.length)}
            label={mistakes.length === 1 ? 'mistake' : 'mistakes'}
            color={mistakes.length === 0 ? colors.success : colors.error}
          />
        </View>

        {mistakes.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>
              {mistakeCount} {mistakeCount === 1 ? 'ayah' : 'ayahs'} to review
            </Text>
            {mistakes.map((mistake, index) => (
              <MistakeCard
                key={`${mistake.surah_number}-${mistake.ayah_number}-${index}`}
                mistake={mistake}
                onDismiss={() => handleDismissMistake(index, mistake)}
                onClearWord={(word) => handleClearWord(index, mistake, word)}
              />
            ))}
          </>
        ) : (
          <View style={styles.cleanCard}>
            <Text style={styles.cleanIcon}>✦</Text>
            <Text style={styles.cleanText}>No mistakes this session. Excellent work.</Text>
          </View>
        )}

        {tomorrowText ? (
          <>
            <Text style={styles.sectionLabel}>UP NEXT</Text>
            <View style={styles.nextCard}>
              <Text style={styles.nextLabel}>TOMORROW</Text>
              <Text style={styles.nextTitle}>{tomorrowText}</Text>
            </View>
          </>
        ) : null}

        <View style={{ height: 100 }} />
      </ScrollView>

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
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingTop: 64,
    paddingHorizontal: spacing.lg,
    paddingBottom: 16,
  },
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

  mistakeCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mistakeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  mistakeAyahLabel: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text },
  tapHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  notMistakeBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  notMistakeBtnText: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMid },

  compRow: { flexDirection: 'row', marginBottom: spacing.sm, gap: spacing.sm },
  compCol: { flex: 1 },
  compDivider: { width: 1, backgroundColor: colors.border, alignSelf: 'stretch' },
  compLabel: {
    fontFamily: fonts.regular, fontSize: 11, color: colors.textMuted,
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  compWord: { fontFamily: 'UthmanicHafs', fontSize: 18, writingDirection: 'rtl', lineHeight: 30 },
  compWrong: { color: colors.error },
  compCorrect: { color: colors.success },

  ayahWordWrong: { color: colors.error },

  badge: { borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 },
  badgeSlip: { backgroundColor: colors.accentLight },
  badgeConfirmed: { backgroundColor: colors.errorLight },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 12 },
  badgeTextSlip: { color: colors.accent },
  badgeTextConfirmed: { color: colors.error },

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

  nextCard: {
    backgroundColor: colors.primary, borderRadius: 16, padding: spacing.md,
    marginBottom: spacing.md,
  },
  nextLabel: {
    fontFamily: fonts.semiBold, fontSize: 10, color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4,
  },
  nextTitle: { fontFamily: fonts.semiBold, fontSize: 20, color: colors.white, letterSpacing: -0.2 },

  error: {
    fontFamily: fonts.regular,
    color: colors.error,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  cta: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
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
