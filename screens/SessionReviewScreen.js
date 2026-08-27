import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useNavigation } from '@react-navigation/native';
import TabBar from '../components/TabBar';
import { getCurrentUserId } from '../lib/auth';
import { getAyahLocation } from '../lib/juzSurahMap';
import { getTodayPortion } from '../lib/planEngine';
import { getAyah } from '../lib/quranApi';
import { supabase } from '../lib/supabase';
import { colors, fonts, spacing } from '../lib/theme';

function StatPill({ value, label, color }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MistakeCard({ mistake }) {
  return (
    <View style={styles.mistakeCard}>
      <View style={styles.mistakeHeader}>
        <Text style={styles.mistakeAyah}>{mistake.surahName} · Ayah {mistake.ayah_number}</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>Mistake</Text></View>
      </View>
      <View style={styles.compRow}>
        <View style={styles.compCol}>
          <Text style={styles.compLabel}>What you said</Text>
          <Text style={[styles.compWord, styles.compWrong]}>
            {mistake.transcribed_text || mistake.wrong_words?.join(' ') || '—'}
          </Text>
        </View>
        <View style={styles.compDivider} />
        <View style={styles.compCol}>
          <Text style={styles.compLabel}>Expected</Text>
          <Text style={[styles.compWord, styles.compCorrect]}>{mistake.expectedText}</Text>
        </View>
      </View>
      <Text style={styles.mistakeNote}>Added to your spaced repetition queue</Text>
    </View>
  );
}

function formatPortionLabel(juzNumber, startAyah, endAyah) {
  const start = getAyahLocation(juzNumber, startAyah);
  const end = getAyahLocation(juzNumber, endAyah);
  if (start.surahNumber === end.surahNumber) {
    return `${start.surahName} ${start.ayahNumber}–${end.ayahNumber}`;
  }
  return `${start.surahName} ${start.ayahNumber} to ${end.surahName} ${end.ayahNumber}`;
}

export default function SessionReviewScreen() {
  // Portion size is read off the real mushaf, so the planner needs the
  // bundled page data. Provided by SQLiteProvider in App.js.
  const db = useSQLiteContext();
  const navigation = useNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [lastSession, setLastSession] = useState(null);
  const [mistakes, setMistakes] = useState([]);
  const [nextPortionLabel, setNextPortionLabel] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const userId = await getCurrentUserId();

        const [{ data: session }, nextPortion] = await Promise.all([
          supabase
            .from('sessions')
            .select('id, juz_number, portion_start_ayah, portion_end_ayah, completed_at')
            .eq('user_id', userId)
            .eq('status', 'complete')
            .order('completed_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          getTodayPortion(db, userId),
        ]);

        if (!mounted) return;

        setLastSession(session ?? null);

        if (nextPortion && nextPortion.type !== 'quiz_only') {
          setNextPortionLabel(
            formatPortionLabel(nextPortion.juzNumber, nextPortion.portionStartAyah, nextPortion.portionEndAyah)
          );
        }

        if (session) {
          const { data: mistakesData } = await supabase
            .from('mistakes')
            .select('ayah_number, surah_number, wrong_words, transcribed_text')
            .eq('session_id', session.id)
            .order('ayah_number', { ascending: true });

          const enriched = await Promise.all(
            (mistakesData ?? []).map(async (m) => {
              const ayah = await getAyah(m.surah_number, m.ayah_number);
              return {
                ...m,
                surahName: getAyahLocation(session.juz_number, m.ayah_number)?.surahName,
                expectedText: ayah.textDisplay,
              };
            })
          );

          if (mounted) setMistakes(enriched);
        }
      } finally {
        if (mounted) setIsLoading(false);
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
      }
    })();

    return () => {
      mounted = false;
    };
  }, [opacity]);

  const ayahCount = lastSession
    ? lastSession.portion_end_ayah - lastSession.portion_start_ayah + 1
    : 0;
  const subtitle = lastSession
    ? `Last session · ${formatPortionLabel(lastSession.juz_number, lastSession.portion_start_ayah, lastSession.portion_end_ayah)}`
    : 'No sessions yet';

  return (
    <View style={styles.screen}>
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <Animated.View style={[styles.content, { opacity }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Summary</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>

          {lastSession ? (
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              <View style={styles.statsRow}>
                <StatPill value={String(ayahCount)} label="ayat recited" color={colors.primary} />
                <View style={styles.statDivider} />
                <StatPill value={String(mistakes.length)} label="mistakes" color={colors.error} />
              </View>

              {mistakes.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>MISTAKES</Text>
                  {mistakes.map((m, i) => <MistakeCard key={i} mistake={m} />)}
                </>
              ) : (
                <View style={styles.cleanCard}>
                  <Text style={styles.cleanIcon}>✓</Text>
                  <Text style={styles.cleanText}>No mistakes — excellent session!</Text>
                </View>
              )}

              {nextPortionLabel ? (
                <>
                  <Text style={styles.sectionLabel}>UP NEXT</Text>
                  <View style={styles.nextCard}>
                    <View>
                      <Text style={styles.nextLabel}>NEXT PORTION</Text>
                      <Text style={styles.nextTitle}>{nextPortionLabel}</Text>
                    </View>
                  </View>
                </>
              ) : null}

              <View style={{ height: 32 }} />
            </ScrollView>
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>✦</Text>
              <Text style={styles.emptyTitle}>Nothing to show yet</Text>
              <Text style={styles.emptySub}>Finish your first session and it'll show up here.</Text>
            </View>
          )}
        </Animated.View>
      )}

      <TabBar active="summary" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  header: {
    paddingTop: 68, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontFamily: fonts.semiBold, fontSize: 28, color: colors.text, letterSpacing: -0.5 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMid, marginTop: 4 },

  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  statsRow: {
    flexDirection: 'row', backgroundColor: colors.card, borderRadius: 16,
    padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  statPill: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: fonts.semiBold, fontSize: 24, letterSpacing: -0.5, marginBottom: 2 },
  statLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMid },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },

  sectionLabel: {
    fontFamily: fonts.semiBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: spacing.sm,
  },
  cleanCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.successLight, borderRadius: 14, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.success,
  },
  cleanIcon: { fontSize: 16, color: colors.success },
  cleanText: { fontFamily: fonts.medium, fontSize: 14, color: colors.success, flex: 1 },

  mistakeCard: {
    backgroundColor: colors.card, borderRadius: 14, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  mistakeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  mistakeAyah: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text },
  badge: { backgroundColor: colors.errorLight, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 9 },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.error },
  compRow: { flexDirection: 'row', marginBottom: spacing.sm, gap: spacing.sm },
  compCol: { flex: 1 },
  compDivider: { width: 1, backgroundColor: colors.border, alignSelf: 'stretch' },
  compLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  compWord: { fontFamily: 'UthmanicHafs', fontSize: 17, writingDirection: 'rtl', lineHeight: 28 },
  compWrong: { color: colors.error },
  compCorrect: { color: colors.success },
  mistakeNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted },

  nextCard: {
    backgroundColor: colors.primary, borderRadius: 16, padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md,
  },
  nextLabel: {
    fontFamily: fonts.semiBold, fontSize: 10, color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4,
  },
  nextTitle: { fontFamily: fonts.semiBold, fontSize: 20, color: colors.white, letterSpacing: -0.2 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: spacing.xl },
  emptyIcon: { fontSize: 32, color: colors.textMuted, marginBottom: spacing.md },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 20, color: colors.text, marginBottom: spacing.sm },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMid, textAlign: 'center', lineHeight: 22 },
});
