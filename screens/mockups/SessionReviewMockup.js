import { useEffect, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, S } from './design';
import { useMockup } from './MockupContext';
import { TabBar, getTodayPortion } from './TodayMockup';

const HARDCODED_MISTAKES = [
  {
    ayah: 3, surahName: 'Al-Mulk', type: 'mistake',
    mistakeWord: 'سَبۡعَ',
    recitedPhrase: 'خَلَقَ ثَلَٰثَ سَمَـٰوَٰتٍ',
    expectedPhrase: 'خَلَقَ سَبۡعَ سَمَـٰوَٰتٍ',
  },
  {
    ayah: 5, surahName: 'Al-Mulk', type: 'mistake',
    mistakeWord: 'مَصَـٰبِيحَ',
    recitedPhrase: 'زَيَّنَّا ٱلسَّمَآءَ بِنُجُومٍ',
    expectedPhrase: 'زَيَّنَّا ٱلسَّمَآءَ بِمَصَـٰبِيحَ',
  },
];

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
        <Text style={styles.mistakeAyah}>{mistake.surahName} · Ayah {mistake.ayah}</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>Mistake</Text></View>
      </View>
      {(mistake.recitedPhrase || mistake.expectedPhrase) ? (
        <View style={styles.compRow}>
          <View style={styles.compCol}>
            <Text style={styles.compLabel}>What you said</Text>
            <Text style={[styles.compWord, styles.compWrong]}>{mistake.recitedPhrase ?? mistake.mistakeWord}</Text>
          </View>
          <View style={styles.compDivider} />
          <View style={styles.compCol}>
            <Text style={styles.compLabel}>Expected</Text>
            <Text style={[styles.compWord, styles.compCorrect]}>{mistake.expectedPhrase ?? mistake.mistakeWord}</Text>
          </View>
        </View>
      ) : null}
      <Text style={styles.mistakeNote}>Added to your spaced repetition queue</Text>
    </View>
  );
}


export default function SessionReviewMockup({ navigation }) {
  const { profile } = useMockup();
  const portion = getTodayPortion(profile);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const nextStart = portion.endAyah + 1;
  const nextEnd = portion.endAyah + 7;

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.content, { opacity }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Summary</Text>
          <Text style={styles.subtitle}>Last session · {portion.surahName} {portion.startAyah}–{portion.endAyah}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.statsRow}>
            <StatPill value={String(portion.todayAyahs)} label="ayat recited" color={C.cobalt} />
            <View style={styles.statDivider} />
            <StatPill
              value={String(HARDCODED_MISTAKES.length)}
              label="mistakes"
              color="#C62828"
            />
          </View>

          <Text style={styles.sectionLabel}>MISTAKES</Text>
          {HARDCODED_MISTAKES.map((m, i) => <MistakeCard key={i} mistake={m} />)}

          <Text style={styles.sectionLabel}>UP NEXT</Text>
          <View style={styles.nextCard}>
            <Text style={styles.nextLabel}>TOMORROW</Text>
            <Text style={styles.nextTitle}>{portion.surahName} · {nextStart}–{nextEnd}</Text>
            <Text style={styles.nextSub}>7 ayat</Text>
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      </Animated.View>

      <TabBar active="summary" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  content: { flex: 1 },
  header: {
    paddingTop: 68, paddingHorizontal: S.lg, paddingBottom: S.md,
    borderBottomWidth: 1, borderBottomColor: C.cardBorder,
  },
  title: { fontFamily: F.semiBold, fontSize: 28, color: C.navy, letterSpacing: -0.5 },
  subtitle: { fontFamily: F.regular, fontSize: 14, color: C.navyMid, marginTop: 4 },

  scrollContent: { paddingHorizontal: S.lg, paddingTop: S.lg },
  statsRow: {
    flexDirection: 'row', backgroundColor: C.white, borderRadius: 16,
    padding: S.md, marginBottom: S.lg, borderWidth: 1, borderColor: C.cardBorder, alignItems: 'center',
  },
  statPill: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: F.semiBold, fontSize: 24, letterSpacing: -0.5, marginBottom: 2 },
  statLabel: { fontFamily: F.regular, fontSize: 12, color: C.navyMid },
  statDivider: { width: 1, height: 32, backgroundColor: C.cardBorder },

  sectionLabel: {
    fontFamily: F.semiBold, fontSize: 11, color: C.navyLight,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: S.sm,
  },
  cleanCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F0FAF5', borderRadius: 14, padding: S.md,
    marginBottom: S.md, borderWidth: 1, borderColor: '#A8D5BC',
  },
  cleanIcon: { fontSize: 16, color: C.success },
  cleanText: { fontFamily: F.medium, fontSize: 14, color: C.success, flex: 1 },

  mistakeCard: {
    backgroundColor: C.white, borderRadius: 14, padding: S.md,
    marginBottom: S.sm, borderWidth: 1, borderColor: C.cardBorder,
  },
  mistakeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.sm },
  mistakeAyah: { fontFamily: F.semiBold, fontSize: 15, color: C.navy },
  badge: { backgroundColor: '#FFEBEE', borderRadius: 8, paddingVertical: 3, paddingHorizontal: 9 },
  badgeText: { fontFamily: F.semiBold, fontSize: 11, color: '#C62828' },
  compRow: { flexDirection: 'row', marginBottom: S.sm, gap: S.sm },
  compCol: { flex: 1 },
  compDivider: { width: 1, backgroundColor: C.cardBorder, alignSelf: 'stretch' },
  compLabel: { fontFamily: F.regular, fontSize: 11, color: C.navyLight, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  compWord: { fontFamily: 'UthmanicHafs', fontSize: 17, writingDirection: 'rtl', lineHeight: 28 },
  compWrong: { color: '#C62828' },
  compCorrect: { color: '#1E7A4A' },
  mistakeNote: { fontFamily: F.regular, fontSize: 12, color: C.navyLight },

  nextCard: {
    backgroundColor: C.cobalt, borderRadius: 16, padding: S.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.md,
  },
  nextLabel: {
    fontFamily: F.semiBold, fontSize: 10, color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4,
  },
  nextTitle: { fontFamily: F.semiBold, fontSize: 20, color: C.white, letterSpacing: -0.2, marginBottom: 4 },
  nextSub: { fontFamily: F.regular, fontSize: 13, color: 'rgba(255,255,255,0.65)' },
  nextArrow: { fontSize: 22, color: C.goldLight },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: S.xl },
  emptyIcon: { fontSize: 32, color: C.navyLight, marginBottom: S.md },
  emptyTitle: { fontFamily: F.semiBold, fontSize: 20, color: C.navy, marginBottom: S.sm },
  emptySub: { fontFamily: F.regular, fontSize: 14, color: C.navyMid, textAlign: 'center', lineHeight: 22 },
});
