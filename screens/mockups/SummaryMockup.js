import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, S } from './design';
import { useMockup } from './MockupContext';
import { getTodayPortion } from './TodayMockup';

const DEMO_MISTAKES = [
  {
    ayah: 3,
    surahName: 'Al-Mulk',
    type: 'mistake',
    mistakeWord: 'سَبۡعَ',
    recitedWord: 'ثَلَٰثَ',
    recitedPhrase: 'خَلَقَ ثَلَٰثَ سَمَـٰوَٰتٍ',
    expectedPhrase: 'خَلَقَ سَبۡعَ سَمَـٰوَٰتٍ',
  },
  {
    ayah: 5,
    surahName: 'Al-Mulk',
    type: 'mistake',
    mistakeWord: 'مَصَـٰبِيحَ',
    recitedWord: 'نُجُومًا',
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

function MistakeCard({ mistake, onDismiss }) {
  return (
    <View style={styles.mistakeCard}>
      <View style={styles.mistakeHeader}>
        <Text style={styles.mistakeAyah}>{mistake.surahName} · Ayah {mistake.ayah}</Text>
        <View style={styles.badgeFull}>
          <Text style={styles.badgeFullText}>Mistake</Text>
        </View>
      </View>
      <View style={styles.compRow}>
        <View style={styles.compCol}>
          <Text style={styles.compLabel}>What you said</Text>
          <Text style={[styles.compWord, styles.compWrong]}>
            {mistake.recitedPhrase ?? mistake.recitedWord ?? mistake.mistakeWord}
          </Text>
        </View>
        <View style={styles.compDivider} />
        <View style={styles.compCol}>
          <Text style={styles.compLabel}>Expected</Text>
          <Text style={[styles.compWord, styles.compCorrect]}>
            {mistake.expectedPhrase ?? mistake.mistakeWord}
          </Text>
        </View>
      </View>
      <TouchableOpacity style={styles.notMistakeBtn} onPress={onDismiss} activeOpacity={0.7}>
        <Text style={styles.notMistakeBtnText}>Not a mistake</Text>
      </TouchableOpacity>
    </View>
  );
}

function TomorrowCard({ surahName, nextStart, nextEnd }) {
  return (
    <View style={styles.tomorrowCard}>
      <View style={styles.tomorrowLeft}>
        <Text style={styles.tomorrowLabel}>TOMORROW</Text>
        <Text style={styles.tomorrowTitle}>{surahName} · {nextStart}–{nextEnd}</Text>
        <Text style={styles.tomorrowSub}>~10 min · 7 ayat</Text>
      </View>
      <View style={styles.tomorrowRight} />
    </View>
  );
}

export default function SummaryMockup({ route, navigation }) {
  const { profile } = useMockup();
  const portion = getTodayPortion(profile);
  const [localMistakes, setLocalMistakes] = useState(DEMO_MISTAKES);
  const opacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.5)).current;
  const nextStart = portion.endAyah + 1;
  const nextEnd = portion.endAyah + 7;

  const handleDismiss = useCallback((idx) => {
    setLocalMistakes((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(checkScale, { toValue: 1, friction: 6, tension: 50, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Success header */}
        <View style={styles.successSection}>
          <Animated.View style={[styles.checkCircle, { transform: [{ scale: checkScale }] }]}>
            <Text style={styles.checkIcon}>✓</Text>
          </Animated.View>
          <Text style={styles.successTitle}>Session complete</Text>
          <Text style={styles.successSub}>{portion.surahName} · Ayahs {portion.startAyah}–{portion.endAyah}</Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatPill value="7" label="ayat recited" color={C.cobalt} />
          <View style={styles.statDivider} />
          <StatPill value={String(localMistakes.length)} label={localMistakes.length === 1 ? 'mistake' : 'mistakes'} color={localMistakes.length === 0 ? C.success : '#C62828'} />
        </View>

        {/* Mistakes */}
        {localMistakes.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>MISTAKES</Text>
            {localMistakes.map((m, i) => (
              <MistakeCard key={i} mistake={m} onDismiss={() => handleDismiss(i)} />
            ))}
          </>
        ) : (
          <View style={styles.cleanCard}>
            <Text style={styles.cleanIcon}>✦</Text>
            <Text style={styles.cleanText}>No mistakes this session. Excellent work.</Text>
          </View>
        )}

        {/* Tomorrow preview */}
        <Text style={styles.sectionLabel}>UP NEXT</Text>
        <TomorrowCard surahName={portion.surahName} nextStart={nextStart} nextEnd={nextEnd} />

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky CTA */}
      <View style={styles.cta}>
        <TouchableOpacity
          style={styles.homeBtn}
          onPress={() => navigation.navigate('MockupToday')}
          activeOpacity={0.88}
        >
          <Text style={styles.homeBtnText}>Back to home</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  scrollContent: {
    paddingTop: 64,
    paddingHorizontal: S.lg,
    paddingBottom: 16,
  },
  successSection: {
    alignItems: 'center',
    marginBottom: S.lg,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1E7A4A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: S.md,
    shadowColor: '#1E7A4A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  checkIcon: { fontSize: 32, color: C.white, fontWeight: '700' },
  successTitle: {
    fontFamily: F.semiBold,
    fontSize: 26,
    color: C.navy,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  successSub: {
    fontFamily: F.regular,
    fontSize: 14,
    color: C.navyMid,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: C.white,
    borderRadius: 16,
    padding: S.md,
    marginBottom: S.md,
    borderWidth: 1,
    borderColor: C.cardBorder,
    alignItems: 'center',
  },
  statPill: { flex: 1, alignItems: 'center' },
  statValue: {
    fontFamily: F.semiBold,
    fontSize: 24,
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: F.regular,
    fontSize: 12,
    color: C.navyMid,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: C.cardBorder,
  },
  sectionLabel: {
    fontFamily: F.semiBold,
    fontSize: 11,
    color: C.navyLight,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: S.sm,
  },
  mistakeCard: {
    backgroundColor: C.white,
    borderRadius: 14,
    padding: S.md,
    marginBottom: S.sm,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  mistakeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: S.sm,
  },
  mistakeAyah: {
    fontFamily: F.semiBold,
    fontSize: 15,
    color: C.navy,
  },
  badgeFull: { backgroundColor: '#FFEBEE', borderRadius: 8, paddingVertical: 3, paddingHorizontal: 9 },
  badgeFullText: { fontFamily: F.semiBold, fontSize: 11, color: '#C62828' },
  compRow: {
    flexDirection: 'row',
    marginBottom: S.sm,
    gap: S.sm,
  },
  compCol: { flex: 1 },
  compDivider: { width: 1, backgroundColor: C.cardBorder, alignSelf: 'stretch' },
  compLabel: {
    fontFamily: F.regular,
    fontSize: 11,
    color: C.navyLight,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  compWord: {
    fontFamily: 'UthmanicHafs',
    fontSize: 18,
    writingDirection: 'rtl',
    lineHeight: 30,
  },
  compWrong: { color: '#C62828' },
  compCorrect: { color: '#1E7A4A' },
  notMistakeBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 10,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  notMistakeBtnText: {
    fontFamily: F.regular,
    fontSize: 12,
    color: C.navyMid,
  },
  cleanCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F0FAF5', borderRadius: 14, padding: S.md,
    marginBottom: S.md, borderWidth: 1, borderColor: '#A8D5BC',
  },
  cleanIcon: { fontSize: 18, color: C.success },
  cleanText: { fontFamily: F.medium, fontSize: 14, color: C.success, flex: 1 },
  tomorrowCard: {
    backgroundColor: C.cobalt,
    borderRadius: 16,
    padding: S.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: S.md,
  },
  tomorrowLabel: {
    fontFamily: F.semiBold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  tomorrowTitle: {
    fontFamily: F.semiBold,
    fontSize: 20,
    color: C.white,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  tomorrowSub: {
    fontFamily: F.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
  },
  tomorrowRight: {},
  tomorrowIcon: {
    fontSize: 22,
    color: C.gold,
  },
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: S.lg,
    paddingBottom: 48,
    paddingTop: S.sm,
    backgroundColor: C.background,
    borderTopWidth: 1,
    borderTopColor: C.cardBorder,
  },
  homeBtn: {
    backgroundColor: C.cobalt,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  homeBtnText: {
    fontFamily: F.semiBold,
    fontSize: 17,
    color: C.white,
  },
});
