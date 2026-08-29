import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  const opacity = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 900, delay: 150, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: 800, delay: 150, useNativeDriver: true }),
    ]).start();
  }, [opacity, rise]);

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.center, { opacity, transform: [{ translateY: rise }] }]}>
        <Image source={LOGO} style={styles.logo} />
        <Text style={styles.wordmark}>
          {WORDMARK.split('').map((letter, i) => (
            <Text key={i} style={{ color: WORDMARK_COLORS[i] }}>
              {letter}
            </Text>
          ))}
        </Text>
      </Animated.View>

      <Animated.View style={{ opacity }}>
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
    // Espresso rather than navy. Against the cream ground it reads as ink on
    // paper, which suits a mushaf app better than the cobalt used for buttons,
    // and it keeps the blue meaning "this is the thing to press".
    tintColor: colors.espresso,
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
