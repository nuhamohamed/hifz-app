import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, S } from './design';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function DonutRing({ size = 72, stroke = 6, progress = 0.72, color = C.gold }) {
  const circumference = Math.PI * (size - stroke);
  const filled = circumference * progress;
  const gap = circumference - filled;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: 'rgba(255,255,255,0.15)',
          position: 'absolute',
        }}
      />
      <View
        style={{
          width: size - stroke * 2,
          height: size - stroke * 2,
          borderRadius: (size - stroke * 2) / 2,
          borderWidth: stroke,
          borderColor: color,
          borderTopColor: 'transparent',
          borderLeftColor: 'transparent',
          position: 'absolute',
          transform: [{ rotate: '-45deg' }],
        }}
      />
      <Text style={{ fontFamily: F.semiBold, fontSize: 16, color: C.white }}>~10</Text>
      <Text style={{ fontFamily: F.regular, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>min</Text>
    </View>
  );
}

function StepCard({ icon, title, desc, accentColor }) {
  return (
    <View style={styles.stepCard}>
      <View style={[styles.stepIconWrap, { backgroundColor: accentColor + '18' }]}>
        <Text style={styles.stepIcon}>{icon}</Text>
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepDesc}>{desc}</Text>
      </View>
    </View>
  );
}

function TabBar({ active = 'today' }) {
  const tabs = [
    { id: 'today', icon: '◎', label: 'Today' },
    { id: 'plan', icon: '▦', label: 'Plan' },
    { id: 'settings', icon: '⊙', label: 'Settings' },
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map((t) => (
        <View key={t.id} style={styles.tabItem}>
          <Text style={[styles.tabIcon, t.id === active && styles.tabIconActive]}>
            {t.icon}
          </Text>
          <Text style={[styles.tabLabel, t.id === active && styles.tabLabelActive]}>
            {t.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function TodayMockup({ route, navigation }) {
  const name = route?.params?.name ?? 'you';
  const opacity = useRef(new Animated.Value(0)).current;
  const cardTranslate = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(cardTranslate, { toValue: 0, duration: 600, delay: 100, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.inner, { opacity }]}>
        {/* Header */}
        <View style={styles.topRow}>
          <View>
            <Text style={styles.greetSub}>{greeting()}</Text>
            <Text style={styles.greet}>As-salāmu ʿalaykum{name !== 'you' ? `, ${name}` : ''}</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name[0]?.toUpperCase() ?? 'A'}</Text>
          </View>
        </View>

        {/* Portion card */}
        <Animated.View
          style={[styles.portionCard, { transform: [{ translateY: cardTranslate }] }]}
        >
          <View style={styles.portionLeft}>
            <DonutRing />
          </View>
          <View style={styles.portionRight}>
            <Text style={styles.portionEyebrow}>TODAY'S PORTION</Text>
            <Text style={styles.portionTitle}>Al-Mulk · 1–7</Text>
            <Text style={styles.portionSub}>7 ayat · ready when you are</Text>
          </View>
          <View style={styles.plannedBubble}>
            <Text style={styles.plannedSmall}>Planned for you</Text>
            <Text style={styles.plannedBold}>just show up</Text>
          </View>
        </Animated.View>

        {/* Session steps */}
        <Text style={styles.sectionLabel}>TODAY'S SESSION</Text>
        <View style={styles.steps}>
          <StepCard
            icon="📋"
            title="Warm-up quiz"
            desc="Primes what you'll revise"
            accentColor={C.cobalt}
          />
          <StepCard
            icon="🎙"
            title="Recite Al-Mulk 1–7"
            desc="We follow along as you go"
            accentColor={C.cobalt}
          />
          <StepCard
            icon="✓"
            title="Recap quiz"
            desc="Locks it in for next time"
            accentColor={C.gold}
          />
        </View>

        <View style={styles.spacer} />

        <TouchableOpacity
          style={styles.startBtn}
          onPress={() => navigation.navigate('MockupPreSession')}
          activeOpacity={0.9}
        >
          <Text style={styles.startBtnIcon}>▶</Text>
          <Text style={styles.startBtnText}>Start session</Text>
        </TouchableOpacity>
      </Animated.View>

      <TabBar active="today" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  inner: {
    flex: 1,
    paddingTop: 64,
    paddingHorizontal: S.lg,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: S.lg,
  },
  greetSub: {
    fontFamily: F.regular,
    fontSize: 13,
    color: C.navyMid,
    marginBottom: 3,
  },
  greet: {
    fontFamily: F.semiBold,
    fontSize: 22,
    color: C.navy,
    letterSpacing: -0.3,
    lineHeight: 28,
    maxWidth: 260,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.cobalt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: F.semiBold,
    fontSize: 16,
    color: C.white,
  },
  portionCard: {
    backgroundColor: C.cobalt,
    borderRadius: 20,
    padding: S.md,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: S.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  portionLeft: { marginRight: S.md },
  portionRight: { flex: 1 },
  portionEyebrow: {
    fontFamily: F.semiBold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  portionTitle: {
    fontFamily: F.semiBold,
    fontSize: 22,
    color: C.white,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  portionSub: {
    fontFamily: F.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  plannedBubble: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  plannedSmall: {
    fontFamily: F.regular,
    fontSize: 10,
    color: 'rgba(255,255,255,0.65)',
  },
  plannedBold: {
    fontFamily: F.semiBold,
    fontSize: 13,
    color: C.white,
  },
  sectionLabel: {
    fontFamily: F.semiBold,
    fontSize: 11,
    color: C.navyLight,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: S.sm,
  },
  steps: { gap: 8 },
  stepCard: {
    backgroundColor: C.white,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  stepIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIcon: { fontSize: 18 },
  stepBody: { flex: 1 },
  stepTitle: {
    fontFamily: F.semiBold,
    fontSize: 15,
    color: C.navy,
    marginBottom: 2,
  },
  stepDesc: {
    fontFamily: F.regular,
    fontSize: 13,
    color: C.navyMid,
  },
  spacer: { flex: 1 },
  startBtn: {
    backgroundColor: C.cobalt,
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: S.md,
  },
  startBtnIcon: {
    fontSize: 14,
    color: C.white,
  },
  startBtnText: {
    fontFamily: F.semiBold,
    fontSize: 17,
    color: C.white,
    letterSpacing: 0.2,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.white,
    borderTopWidth: 1,
    borderTopColor: C.cardBorder,
    paddingBottom: 28,
    paddingTop: 12,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 4 },
  tabIcon: { fontSize: 20, color: C.navyLight },
  tabIconActive: { color: C.cobalt },
  tabLabel: { fontFamily: F.medium, fontSize: 11, color: C.navyLight },
  tabLabelActive: { color: C.cobalt },
});
