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
import { CommonActions, useNavigation } from '@react-navigation/native';
import { getCurrentUserId } from '../lib/auth';
import { getAyahLocation, getJuzTotalAyahs } from '../lib/juzSurahMap';
import { cancelEveningNudge } from '../lib/notifications';
import { getAyah } from '../lib/quranApi';
import { updateJuzProgressAfterSession } from '../lib/planEngine';
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

function AyahTextWithHighlights({ words, wrongWords, isDisconnectedLetters }) {
  if (isDisconnectedLetters) {
    const text = words.map((w) => w.textCompare).join(' ');
    return <Text style={styles.compWord}>{text}</Text>;
  }

  const wrongIndices = buildWrongWordIndices(words, wrongWords);
  const displayWords = words.map((w) => w.textDisplay);

  return (
    <Text style={styles.compWord}>
      {displayWords.map((word, i) => (
        <Text
          key={i}
          style={wrongIndices.has(i) ? styles.ayahWordWrong : styles.compCorrect}
        >
          {word}{' '}
        </Text>
      ))}
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

function MistakeCard({ mistake, onDismiss }) {
  const isSlip = mistake.tier === 1;

  return (
    <View style={styles.mistakeCard}>
      <View style={styles.mistakeCardHeader}>
        <Text style={styles.mistakeAyahLabel}>Ayah {mistake.ayah_number}</Text>
        <View style={[styles.badge, isSlip ? styles.badgeSlip : styles.badgeConfirmed]}>
          <Text style={[styles.badgeText, isSlip ? styles.badgeTextSlip : styles.badgeTextConfirmed]}>
            {isSlip ? 'Slip' : 'Confirmed mistake'}
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
          />
        </View>
      </View>

      <TouchableOpacity style={styles.notMistakeBtn} onPress={onDismiss} activeOpacity={0.7}>
        <Text style={styles.notMistakeBtnText}>Not a mistake</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function SessionSummaryScreen({ route }) {
  const navigation = useNavigation();
  const sessionId = route?.params?.sessionId;
  const totalAyahsInJuzParam = route?.params?.totalAyahsInJuz;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [mistakes, setMistakes] = useState([]);
  const [tomorrowText, setTomorrowText] = useState(null);
  const [juzComplete, setJuzComplete] = useState(false);
  const [gatePassed, setGatePassed] = useState(null);
  const planUpdatedRef = useRef(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (!sessionId) {
      setError('No session ID provided.');
      setIsLoading(false);
      return;
    }

    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);
        setError('');

        const { data: sessionData, error: sessionError } = await supabase
          .from('sessions')
          .select(
            'portion_start_ayah, portion_end_ayah, juz_number, completed_at, status'
          )
          .eq('id', sessionId)
          .single();

        if (sessionError) {
          throw new Error(sessionError.message);
        }

        const userId = await getCurrentUserId();

        const totalAyahsInJuz =
          totalAyahsInJuzParam ?? getJuzTotalAyahs(sessionData.juz_number);
        const isJuzComplete =
          sessionData.portion_end_ayah >= totalAyahsInJuz;

        if (sessionData.status === 'complete' && !planUpdatedRef.current) {
          planUpdatedRef.current = true;
          await updateJuzProgressAfterSession(
            userId,
            sessionId,
            sessionData.juz_number,
            sessionData.portion_end_ayah,
            totalAyahsInJuz
          );
        }

        let gate = null;
        if (isJuzComplete) {
          const { data: progressData } = await supabase
            .from('juz_progress')
            .select('gate_passed')
            .eq('user_id', userId)
            .eq('juz_number', sessionData.juz_number)
            .maybeSingle();
          gate = progressData?.gate_passed ?? null;
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
          .select('tier, ayah_number, surah_number, wrong_words, transcribed_text')
          .eq('session_id', sessionId)
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
        setGatePassed(gate);
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
  }, [sessionId, totalAyahsInJuzParam]);

  const confirmedCount = mistakes.filter((m) => m.tier === 2).length;
  const slipCount = mistakes.filter((m) => m.tier === 1).length;

  const handleDismissMistake = useCallback(async (index, mistake) => {
    setMistakes((prev) => prev.filter((_, i) => i !== index));
    if (sessionId) {
      await supabase
        .from('mistakes')
        .delete()
        .eq('session_id', sessionId)
        .eq('ayah_number', mistake.ayah_number)
        .eq('tier', mistake.tier);
    }
  }, [sessionId]);

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
        <TouchableOpacity style={styles.homeBtn} onPress={handleBackToHome} activeOpacity={0.88}>
          <Text style={styles.homeBtnText}>Back to home</Text>
        </TouchableOpacity>
      </View>
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
              {gatePassed === true
                ? 'You passed. Strong work keeping your mistakes low.'
                : gatePassed === false
                ? "You'll redo this juz — too many mistakes this round. Keep at it."
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
              {confirmedCount} confirmed · {slipCount} slip{slipCount === 1 ? '' : 's'}
            </Text>
            {mistakes.map((mistake, index) => (
              <MistakeCard
                key={`${mistake.surah_number}-${mistake.ayah_number}-${mistake.tier}-${index}`}
                mistake={mistake}
                onDismiss={() => handleDismissMistake(index, mistake)}
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

      <View style={styles.cta}>
        <TouchableOpacity style={styles.homeBtn} onPress={handleBackToHome} activeOpacity={0.88}>
          <Text style={styles.homeBtnText}>Back to home</Text>
        </TouchableOpacity>
      </View>
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
