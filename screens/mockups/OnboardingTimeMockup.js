import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, S } from './design';

const OPTIONS = [
  { id: 10, label: '10 min', sub: 'Quick check-in' },
  { id: 20, label: '20 min', sub: 'Light session' },
  { id: 30, label: '30 min', sub: 'Recommended' },
  { id: 45, label: '45 min', sub: 'Deep dive' },
  { id: 60, label: '60+ min', sub: 'Serious revision' },
];

function ProgressDots({ current, total }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === current && styles.dotActive,
            i < current && styles.dotPast,
          ]}
        />
      ))}
    </View>
  );
}

export default function OnboardingTimeMockup({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const [selected, setSelected] = useState(30);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.screen, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.header}>
        <ProgressDots current={2} total={5} />
        <Text style={styles.step}>Step 3 of 5</Text>
        <Text style={styles.question}>How much time can you give each day?</Text>
        <Text style={styles.sub}>
          We'll plan your sessions to fit within this window.
        </Text>
      </View>

      <View style={styles.grid}>
        {OPTIONS.map((opt) => {
          const sel = selected === opt.id;
          return (
            <TouchableOpacity
              key={opt.id}
              style={[styles.tile, sel && styles.tileSelected]}
              onPress={() => setSelected(opt.id)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tileLabel, sel && styles.tileLabelSelected]}>
                {opt.label}
              </Text>
              <Text style={[styles.tileSub, sel && styles.tileSubSelected]}>
                {opt.sub}
              </Text>
              {opt.id === 30 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Popular</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate('MockupOnboardingGender', { name })}
          activeOpacity={0.88}
        >
          <Text style={styles.primaryBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    paddingTop: 64,
    paddingHorizontal: S.lg,
    paddingBottom: S.md,
  },
  dots: { flexDirection: 'row', gap: 6, marginBottom: S.lg },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.navyLight, opacity: 0.3 },
  dotActive: { backgroundColor: C.cobalt, opacity: 1, width: 20 },
  dotPast: { backgroundColor: C.cobalt, opacity: 0.4 },
  step: {
    fontFamily: F.medium,
    fontSize: 13,
    color: C.navyLight,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: S.sm,
  },
  question: {
    fontFamily: F.semiBold,
    fontSize: 26,
    color: C.navy,
    letterSpacing: -0.3,
    marginBottom: S.sm,
    lineHeight: 34,
  },
  sub: {
    fontFamily: F.regular,
    fontSize: 14,
    color: C.navyMid,
    lineHeight: 21,
  },
  grid: {
    flex: 1,
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    gap: 10,
  },
  tile: {
    backgroundColor: C.white,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: S.md,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tileSelected: {
    borderColor: C.cobalt,
    backgroundColor: C.cobaltDim,
  },
  tileLabel: {
    fontFamily: F.semiBold,
    fontSize: 17,
    color: C.navy,
  },
  tileLabelSelected: { color: C.cobalt },
  tileSub: {
    fontFamily: F.regular,
    fontSize: 13,
    color: C.navyMid,
    flex: 1,
    marginLeft: S.sm,
  },
  tileSubSelected: { color: C.cobalt },
  badge: {
    backgroundColor: C.goldLight,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeText: {
    fontFamily: F.semiBold,
    fontSize: 11,
    color: C.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  footer: {
    paddingHorizontal: S.lg,
    paddingBottom: 48,
    paddingTop: S.md,
  },
  primaryBtn: {
    backgroundColor: C.cobalt,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: F.semiBold,
    fontSize: 17,
    color: C.white,
  },
});
