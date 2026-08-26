import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fonts, spacing } from '../../lib/theme';

const LOGO = require('../../assets/logo.png');

export default function WelcomeScreen({ navigation }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 800, delay: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 700, delay: 200, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <View style={styles.screen}>
      <View style={styles.navLogo}>
        <Image source={LOGO} style={styles.logoImg} />
        <Text style={styles.logoText}>Dawrah</Text>
      </View>
      <Animated.View style={[styles.inner, { opacity, transform: [{ translateY }] }]}>
        <View style={styles.spacerTop} />
        <Text style={styles.headline}>Your personalized hifdh revision coach.</Text>
        <Text style={styles.body}>
          All you have to do is recite. We identify your weak areas and build your revision plan automatically using spaced repetition.
        </Text>

        <View style={styles.spacer} />

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate('Name')}
          activeOpacity={0.88}
        >
          <Text style={styles.primaryBtnText}>Get started</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingBottom: 48,
    paddingHorizontal: spacing.lg,
  },
  navLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 64,
    marginBottom: spacing.sm,
  },
  logoImg: {
    width: 30,
    height: 30,
    resizeMode: 'contain',
    tintColor: colors.text,
  },
  logoText: {
    fontFamily: fonts.semiBold,
    fontSize: 18,
    color: colors.text,
    letterSpacing: -0.2,
  },
  inner: { flex: 1 },
  spacerTop: { flex: 0.35 },
  headline: {
    fontFamily: fonts.semiBold,
    fontSize: 20,
    color: colors.primary,
    marginBottom: spacing.md,
    lineHeight: 28,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textMid,
    lineHeight: 23,
  },
  spacer: { flex: 1 },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 17,
    color: colors.white,
    letterSpacing: 0.2,
  },
});
