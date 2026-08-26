import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, S } from './design';
import { useMockup } from './MockupContext';
import { JUZ_DATA } from '../../lib/juzSurahMap';

export function getTodayPortion(profile) {
  const { memorizedJuz = [], memorizedPartial = {}, sessionMinutes = 15 } = profile || {};

  let juzNum = 29;
  if (memorizedJuz.length > 0) {
    juzNum = Math.min(...memorizedJuz);
  } else {
    const partialKeys = Object.keys(memorizedPartial);
    if (partialKeys.length > 0) {
      juzNum = Math.min(...partialKeys.map((k) => parseInt(k.split('-')[0], 10)));
    }
  }

  const juzData = JUZ_DATA[juzNum - 1];
  const firstSurah = juzData?.surahs?.[0];
  const startAyah = firstSurah?.startAyah ?? 1;

  // ~2 minutes per ayah for hifz revision
  const todayAyahs = Math.max(3, Math.round(sessionMinutes / 2));

  return {
    surahName: firstSurah?.surahName ?? 'Al-Mulk',
    surahNumber: firstSurah?.surahNumber ?? 67,
    juzNum,
    startAyah,
    todayAyahs,
    endAyah: startAyah + todayAyahs - 1,
    totalJuzAyahs: juzData?.totalAyahs ?? 431,
  };
}

// ── Shared tab bar ─────────────────────────────────────────────────────────
export function TabBar({ active, navigation }) {
  const tabs = [
    { id: 'home',     icon: '◎', label: 'Home',     screen: 'MockupToday' },
    { id: 'summary',  icon: '✦', label: 'Summary',  screen: 'MockupSessionReview' },
    { id: 'settings', icon: '⊙', label: 'Settings', screen: 'MockupRecitationDemo' },
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map((t) => (
        <TouchableOpacity
          key={t.id}
          style={styles.tabItem}
          onPress={() => t.screen && t.id !== active && navigation.navigate(t.screen)}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabIcon, t.id === active && styles.tabIconActive]}>{t.icon}</Text>
          <Text style={[styles.tabLabel, t.id === active && styles.tabLabelActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Session progress ring ───────────────────────────────────────────────────
// Two-half overlay technique: right clip shows 0→180°, left clip adds 180→360°.
// Tracks today's session: completedAyahs / todayAyahs.
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
      {/* Track */}
      <View style={[ringBase, { borderColor: 'rgba(26,61,138,0.12)' }]} />

      {/* Right half progress */}
      {angle > 0 && (
        <View style={{ position: 'absolute', left: half, width: half, height: size, overflow: 'hidden' }}>
          <View style={[ringBase, { left: -half, borderColor: C.cobalt, transform: [{ rotate: rightRotation }] }]} />
        </View>
      )}

      {/* Left half progress (only when > 180°) */}
      {angle > 180 && (
        <View style={{ position: 'absolute', left: 0, width: half, height: size, overflow: 'hidden' }}>
          <View style={[ringBase, { borderColor: C.cobalt, transform: [{ rotate: leftRotation }] }]} />
        </View>
      )}

      {/* Center */}
      <Text style={{ fontFamily: F.regular, fontSize: 7.5, color: C.navyLight, letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center', lineHeight: 12 }}>{'Session\nProgress'}</Text>
    </View>
  );
}

// ── Agenda step card ───────────────────────────────────────────────────────
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

// ── Screen ─────────────────────────────────────────────────────────────────
export default function TodayMockup({ route, navigation }) {
  const { profile, clearSession } = useMockup();
  const name = profile.name || route?.params?.name || 'you';
  const portion = getTodayPortion(profile);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const cardTranslate = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    clearSession();
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(cardTranslate, { toValue: 0, duration: 600, delay: 100, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.inner, { opacity: fadeAnim }]}>
        <View style={styles.topRow}>
          <Text style={styles.bismillah}>بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ</Text>
          <Text style={styles.greet}>As-salāmu ʿalaykum{name !== 'you' ? `, ${name}` : ''}</Text>
        </View>

        {/* Portion card — warm parchment, distinct from the cobalt start button */}
        <Animated.View style={[styles.portionCard, { transform: [{ translateY: cardTranslate }] }]}>
          <View style={styles.portionLeft}>
            <SessionRing
              completedAyahs={0}
              todayAyahs={portion.todayAyahs}
            />
          </View>
          <View style={styles.portionRight}>
            <Text style={styles.portionEyebrow}>JUZ {portion.juzNum} · TODAY'S PORTION</Text>
            <Text style={styles.portionTitle}>{portion.surahName} · {portion.startAyah}–{portion.endAyah}</Text>
            <Text style={styles.portionSub}>{portion.todayAyahs} ayat</Text>
          </View>
        </Animated.View>

        <Text style={styles.sectionLabel}>TODAY'S AGENDA</Text>
        <View style={styles.steps}>
          <StepCard
            step={1} icon="◈" title="Mistake Review"
            desc="Primes what you'll revise"
            iconBg={C.ice} iconColor={C.cobalt}
          />
          <StepCard
            step={2} icon="◉" title={`Recite ${portion.surahName} · ${portion.startAyah}–${portion.endAyah}`}
            desc="We follow along as you go"
            iconBg={C.parchment} iconColor={C.brown}
          />
          <StepCard
            step={3} icon="◆" title="Recap quiz"
            desc="Locks it in for next time"
            iconBg={C.parchment} iconColor={C.gold}
          />
        </View>

        <View style={styles.spacer} />

        {/* Liquid glass start button */}
        <TouchableOpacity
          style={styles.startBtn}
          onPress={() => navigation.navigate('MockupPreSession')}
          activeOpacity={0.88}
        >
          <Text style={styles.startBtnIcon}>▶</Text>
          <Text style={styles.startBtnText}>Start session</Text>
        </TouchableOpacity>
      </Animated.View>

      <TabBar active="home" navigation={navigation} />
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  inner: { flex: 1, paddingTop: 64, paddingHorizontal: S.lg },

  topRow: { marginBottom: S.lg, paddingTop: S.xl },
  bismillah: { fontSize: 18, color: C.navyMid, textAlign: 'center', marginBottom: 4, fontWeight: '300' },
  greet: { fontFamily: F.regular, fontSize: 16, color: C.navyMid, textAlign: 'center' },

  portionCard: {
    backgroundColor: C.ice,
    borderRadius: 20, padding: S.md,
    flexDirection: 'row', alignItems: 'center',
    marginBottom: S.lg,
    borderWidth: 1, borderColor: 'rgba(26,61,138,0.12)',
  },
  portionLeft: { marginRight: S.md },
  portionRight: { flex: 1 },
  portionEyebrow: {
    fontFamily: F.semiBold, fontSize: 10, color: C.navyLight,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4,
  },
  portionTitle: { fontFamily: F.semiBold, fontSize: 20, color: C.navy, letterSpacing: -0.3, marginBottom: 4 },
  portionSub: { fontFamily: F.regular, fontSize: 13, color: C.navyMid },

  sectionLabel: {
    fontFamily: F.semiBold, fontSize: 11, color: C.navyLight,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: S.sm,
  },
  steps: { gap: 8 },
  stepCard: {
    backgroundColor: C.white, borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: C.cardBorder,
  },
  // All numbered circles same cobalt color
  stepNumCircle: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.cobalt,
  },
  stepNumText: { fontFamily: F.semiBold, fontSize: 13, color: C.white },
  stepIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepIcon: { fontSize: 18 },
  stepBody: { flex: 1 },
  stepTitle: { fontFamily: F.semiBold, fontSize: 15, color: C.navy, marginBottom: 2 },
  stepDesc: { fontFamily: F.regular, fontSize: 13, color: C.navyMid },

  spacer: { flex: 1 },

  startBtn: {
    backgroundColor: 'rgba(26,61,138,0.92)',
    borderRadius: 18,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: S.md,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    shadowColor: C.cobalt,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  },
  startBtnIcon: { fontSize: 14, color: C.white },
  startBtnText: { fontFamily: F.semiBold, fontSize: 17, color: C.white, letterSpacing: 0.2 },

  // Tab bar — shared with SessionReviewMockup via named export
  tabBar: {
    flexDirection: 'row', backgroundColor: C.white,
    borderTopWidth: 1, borderTopColor: C.cardBorder,
    paddingBottom: 28, paddingTop: 12,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 4 },
  tabIcon: { fontSize: 20, color: C.navyLight },
  tabIconActive: { color: C.cobalt },
  tabLabel: { fontFamily: F.medium, fontSize: 11, color: C.navyLight },
  tabLabelActive: { color: C.cobalt },
});
