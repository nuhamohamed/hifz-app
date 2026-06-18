import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, S } from './design';

function Logo() {
  return (
    <View style={styles.logoWrap}>
      <View style={styles.logoCircle}>
        <Text style={styles.logoMoon}>☽</Text>
      </View>
    </View>
  );
}

export default function WelcomeMockup({ navigation }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 800, delay: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 700, delay: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.inner, { opacity, transform: [{ translateY }] }]}>
        <Logo />
        <Text style={styles.appName}>Dawrah</Text>
        <Text style={styles.headline}>Your personalized hifdh revision coach.</Text>
        <Text style={styles.body}>
          All you have to do is recite. We identify your weak areas and build your revision plan automatically using spaced repetition — based on YOUR mistakes.
        </Text>

        <View style={styles.spacer} />

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate('MockupOnboardingName')}
          activeOpacity={0.88}
        >
          <Text style={styles.primaryBtnText}>Get started</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.7}>
          <Text style={styles.secondaryBtnText}>I already have an account</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
    paddingTop: 80,
    paddingBottom: 48,
    paddingHorizontal: S.lg,
  },
  inner: { flex: 1 },
  logoWrap: { marginBottom: S.lg },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.cobalt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMoon: { fontSize: 30, color: C.gold },
  appName: {
    fontFamily: F.semiBold,
    fontSize: 40,
    color: C.navy,
    letterSpacing: -0.5,
    marginBottom: S.sm,
  },
  headline: {
    fontFamily: F.semiBold,
    fontSize: 20,
    color: C.cobalt,
    marginBottom: S.md,
    lineHeight: 28,
  },
  body: {
    fontFamily: F.regular,
    fontSize: 15,
    color: C.navyMid,
    lineHeight: 23,
  },
  spacer: { flex: 1 },
  primaryBtn: {
    backgroundColor: C.cobalt,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
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
  },
  secondaryBtnText: {
    fontFamily: F.medium,
    fontSize: 15,
    color: C.navyMid,
  },
});
