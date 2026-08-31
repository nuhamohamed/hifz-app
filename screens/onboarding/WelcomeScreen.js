import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fonts, ombre, spacing } from '../../lib/theme';

const LOGO = require('../../assets/logo.png');

const WORDMARK = 'Dawrah';

// Blue through to brown, the two ends of the palette that already carry
// meaning in the app: cobalt is the colour of the thing to press, espresso and
// brown are the reading colours. Stepped per letter rather than drawn as a real
// gradient, which would mean pulling in a masked view and a gradient library,
// two native modules and a fresh dev build for six letters. At this size the
// steps read as a shift rather than as bands.
const WORDMARK_COLORS = ombre(colors.primary, colors.brown, WORDMARK.length);

/**
 * The first thing anyone sees: the mark and the name, and nothing else.
 *
 * This used to carry a headline and a paragraph explaining spaced repetition
 * and weak-area detection. None of it survives contact with a first launch:
 * the app has not earned the attention yet, and every claim in it is one the
 * person can only judge after using it. The logo centred on the cream ground
 * says the same thing more honestly.
 */
export default function WelcomeScreen({ navigation }) {
  // Three stages rather than one fade, so the screen assembles itself in the
  // order you would read it: mark, then name, then the thing to press. A single
  // group fade puts the button in front of someone before they have looked at
  // the logo, which is the opposite of what this screen is for.
  const markOpacity = useRef(new Animated.Value(0)).current;
  const markScale = useRef(new Animated.Value(0.86)).current;
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const wordmarkRise = useRef(new Animated.Value(14)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      // The mark alone, slowly. Scale starts just under 1 so it settles into
      // place rather than appearing at its final size; easing out means most of
      // the movement happens early and the last of it is almost imperceptible.
      Animated.parallel([
        Animated.timing(markOpacity, {
          toValue: 1,
          duration: 1400,
          delay: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(markScale, {
          toValue: 1,
          duration: 1600,
          delay: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(wordmarkOpacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(wordmarkRise, {
          toValue: 0,
          duration: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(buttonOpacity, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [markOpacity, markScale, wordmarkOpacity, wordmarkRise, buttonOpacity]);

  return (
    <View style={styles.screen}>
      <View style={styles.center}>
        <Animated.Image
          source={LOGO}
          style={[
            styles.logo,
            { opacity: markOpacity, transform: [{ scale: markScale }] },
          ]}
        />
        <Animated.Text
          style={[
            styles.wordmark,
            { opacity: wordmarkOpacity, transform: [{ translateY: wordmarkRise }] },
          ]}
        >
          {WORDMARK.split('').map((letter, i) => (
            <Text key={i} style={{ color: WORDMARK_COLORS[i] }}>
              {letter}
            </Text>
          ))}
        </Animated.Text>
      </View>

      <Animated.View style={{ opacity: buttonOpacity }}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate('Age')}
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
  // The mark sits slightly above true centre, where the eye expects it.
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.xxl,
  },
  logo: {
    width: 96,
    height: 96,
    resizeMode: 'contain',
    // Brand blue. It matches the blue end of the wordmark's ombre directly
    // beneath it, so the mark and the first letter of the name are the same
    // colour and read as one lockup rather than two separate objects.
    tintColor: colors.blue,
    marginBottom: spacing.lg,
  },
  wordmark: {
    fontFamily: fonts.semiBold,
    fontSize: 40,
    letterSpacing: -1,
  },
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
