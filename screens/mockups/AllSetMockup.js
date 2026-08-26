import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, R, S } from './design';

function CheckMark({ scale, opacity }) {
  return (
    <Animated.View style={[styles.checkWrap, { transform: [{ scale }], opacity }]}>
      <View style={styles.checkRing} />
      <Text style={styles.checkIcon}>✓</Text>
    </Animated.View>
  );
}

function StaggerLine({ children, delay, style }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 400, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

export default function AllSetMockup({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const checkScale = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.spring(checkScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
        Animated.timing(checkOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.inner}>
        <CheckMark scale={checkScale} opacity={checkOpacity} />

        <StaggerLine delay={500}>
          <Text style={styles.title}>You're all set{name !== 'there' ? `, ${name}` : ''}.</Text>
        </StaggerLine>

        <StaggerLine delay={700}>
          <Text style={styles.body}>
            Your first session is ready. Press start and Dawrah takes it from there: a short mistake review, then your recitation, then a quick recap to lock it in.
          </Text>
        </StaggerLine>

        <StaggerLine delay={900} style={styles.hintRow}>
          <View style={styles.hintCard}>
            <Text style={styles.hintIcon}>🎙</Text>
            <Text style={styles.hintText}>Just recite naturally. We follow along word by word no tapping, no scrolling.</Text>
          </View>
        </StaggerLine>

        <StaggerLine delay={1100} style={styles.hintRow}>
          <View style={styles.hintCard}>
            <Text style={styles.hintIcon}>✦</Text>
            <Text style={styles.hintText}>Mistakes are saved automatically and worked into future sessions.</Text>
          </View>
        </StaggerLine>

        <View style={styles.spacer} />

        <StaggerLine delay={1300}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('MockupToday', { name })}
            activeOpacity={0.88}
          >
            <Text style={styles.primaryBtnText}>Start my first session</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => navigation.navigate('MockupToday', { name })}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryBtnText}>Go to home</Text>
          </TouchableOpacity>
        </StaggerLine>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  inner: {
    flex: 1,
    paddingTop: 80,
    paddingHorizontal: S.lg,
    paddingBottom: 48,
  },
  checkWrap: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: S.xl,
    alignSelf: 'center',
  },
  checkRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2.5,
    borderColor: C.cobalt,
    opacity: 0.2,
  },
  checkIcon: {
    fontSize: 36,
    color: C.cobalt,
  },
  title: {
    fontFamily: F.semiBold,
    fontSize: 30,
    color: C.navy,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: S.md,
    lineHeight: 38,
  },
  body: {
    fontFamily: F.regular,
    fontSize: 15,
    color: C.navyMid,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: S.lg,
  },
  hintRow: {
    width: '100%',
    marginBottom: S.sm,
  },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: C.white,
    borderRadius: R.sm,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
    padding: S.md,
  },
  hintIcon: {
    fontSize: 18,
    marginTop: 1,
  },
  hintText: {
    flex: 1,
    fontFamily: F.regular,
    fontSize: 14,
    color: C.navyMid,
    lineHeight: 21,
  },
  spacer: { flex: 1 },
  primaryBtn: {
    backgroundColor: C.cobalt,
    borderRadius: R.md,
    paddingVertical: 17,
    alignItems: 'center',
    width: '100%',
    marginBottom: S.sm,
  },
  primaryBtnText: {
    fontFamily: F.semiBold,
    fontSize: 17,
    color: C.white,
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%',
  },
  secondaryBtnText: {
    fontFamily: F.medium,
    fontSize: 15,
    color: C.navyMid,
  },
});
