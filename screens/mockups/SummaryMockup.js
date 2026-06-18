import { useEffect, useRef } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, S } from './design';

const MOCK_MISTAKES = [
  {
    ayah: 2,
    surahName: 'Al-Mulk',
    type: 'slip',
    wrongWord: 'ٱلۡمَوۡتَ',
    correctWord: 'ٱلۡحَيَوٰةَ',
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
        <View style={[styles.badge, mistake.type === 'slip' ? styles.badgeSlip : styles.badgeFull]}>
          <Text style={[styles.badgeText, mistake.type === 'slip' ? styles.badgeSlipText : styles.badgeFullText]}>
            {mistake.type === 'slip' ? 'Slip' : 'Mistake'}
          </Text>
        </View>
      </View>
      <View style={styles.mistakeDiff}>
        <Text style={styles.diffWrong}>{mistake.wrongWord}</Text>
        <Text style={styles.diffArrow}>→</Text>
        <Text style={styles.diffCorrect}>{mistake.correctWord}</Text>
      </View>
      <Text style={styles.mistakeNote}>Added to your spaced repetition queue</Text>
    </View>
  );
}

function TomorrowCard() {
  return (
    <View style={styles.tomorrowCard}>
      <View style={styles.tomorrowLeft}>
        <Text style={styles.tomorrowLabel}>TOMORROW</Text>
        <Text style={styles.tomorrowTitle}>Al-Mulk · 8–14</Text>
        <Text style={styles.tomorrowSub}>~10 min · 7 ayat</Text>
      </View>
      <View style={styles.tomorrowRight}>
        <Text style={styles.tomorrowIcon}>→</Text>
      </View>
    </View>
  );
}

export default function SummaryMockup({ navigation }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.5)).current;

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
          <Text style={styles.successSub}>Al-Mulk · Ayahs 1–7 · Thursday</Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatPill value="7" label="ayat recited" color={C.cobalt} />
          <View style={styles.statDivider} />
          <StatPill value="1" label="slip" color="#E65100" />
          <View style={styles.statDivider} />
          <StatPill value="0" label="mistakes" color={C.success} />
        </View>

        {/* Streak */}
        <View style={styles.streakCard}>
          <Text style={styles.streakIcon}>🔥</Text>
          <View>
            <Text style={styles.streakValue}>4-day streak</Text>
            <Text style={styles.streakSub}>Keep going — consistency is everything</Text>
          </View>
        </View>

        {/* Mistakes */}
        {MOCK_MISTAKES.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>SLIPS & MISTAKES</Text>
            {MOCK_MISTAKES.map((m, i) => (
              <MistakeCard key={i} mistake={m} />
            ))}
          </>
        ) : null}

        {/* Tomorrow preview */}
        <Text style={styles.sectionLabel}>UP NEXT</Text>
        <TomorrowCard />

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
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.goldLight,
    borderRadius: 14,
    padding: S.md,
    marginBottom: S.lg,
    borderWidth: 1,
    borderColor: C.gold + '40',
  },
  streakIcon: { fontSize: 28 },
  streakValue: {
    fontFamily: F.semiBold,
    fontSize: 16,
    color: C.navy,
    marginBottom: 2,
  },
  streakSub: {
    fontFamily: F.regular,
    fontSize: 12,
    color: C.navyMid,
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
  badge: {
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  badgeSlip: { backgroundColor: '#FFF3E0' },
  badgeFull: { backgroundColor: '#FFEBEE' },
  badgeText: { fontFamily: F.semiBold, fontSize: 11 },
  badgeSlipText: { color: '#E65100' },
  badgeFullText: { color: '#C62828' },
  mistakeDiff: {
    flexDirection: 'row-reverse',
    gap: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  diffWrong: {
    fontFamily: 'UthmanicHafs',
    fontSize: 18,
    color: '#C62828',
  },
  diffArrow: {
    fontFamily: F.regular,
    fontSize: 14,
    color: C.navyLight,
    transform: [{ scaleX: -1 }],
  },
  diffCorrect: {
    fontFamily: 'UthmanicHafs',
    fontSize: 18,
    color: '#1E7A4A',
  },
  mistakeNote: {
    fontFamily: F.regular,
    fontSize: 12,
    color: C.navyLight,
  },
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
