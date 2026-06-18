import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, S } from './design';

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

export default function OnboardingNotificationsMockup({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <View style={styles.header}>
        <ProgressDots current={4} total={5} />
        <Text style={styles.step}>Step 5 of 5</Text>
        <Text style={styles.question}>Stay on track</Text>
        <Text style={styles.sub}>
          A daily reminder is the single biggest factor in maintaining hifdh. We'll send you a gentle nudge at your chosen time.
        </Text>
      </View>

      <Animated.View style={[styles.illustration, { transform: [{ scale }] }]}>
        <View style={styles.notifCard}>
          <View style={styles.notifRow}>
            <View style={styles.notifIcon}>
              <Text style={styles.notifIconText}>☽</Text>
            </View>
            <View style={styles.notifBody}>
              <Text style={styles.notifTitle}>Dawrah · now</Text>
              <Text style={styles.notifMsg}>Time for your revision, {name}. ✦</Text>
            </View>
          </View>
        </View>

        <Text style={styles.illuCaption}>You'll see something like this each day</Text>
      </Animated.View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate('MockupToday', { name })}
          activeOpacity={0.88}
        >
          <Text style={styles.primaryBtnText}>Enable reminders</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => navigation.navigate('MockupToday', { name })}
          activeOpacity={0.7}
        >
          <Text style={styles.skipBtnText}>Maybe later</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
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
  illustration: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.lg,
  },
  notifCard: {
    backgroundColor: C.white,
    borderRadius: 16,
    padding: S.md,
    width: '100%',
    shadowColor: C.navy,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 6,
    marginBottom: S.md,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  notifIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.cobalt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifIconText: { fontSize: 20, color: C.gold },
  notifBody: { flex: 1 },
  notifTitle: {
    fontFamily: F.semiBold,
    fontSize: 13,
    color: C.navy,
    marginBottom: 3,
  },
  notifMsg: {
    fontFamily: F.regular,
    fontSize: 14,
    color: C.navyMid,
  },
  illuCaption: {
    fontFamily: F.regular,
    fontSize: 13,
    color: C.navyLight,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: S.lg,
    paddingBottom: 48,
    paddingTop: S.md,
    gap: 8,
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
  skipBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  skipBtnText: {
    fontFamily: F.medium,
    fontSize: 15,
    color: C.navyMid,
  },
});
