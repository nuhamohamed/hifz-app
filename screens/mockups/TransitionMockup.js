import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { C, F } from './design';

const LOGO = require('../../assets/logo.png');

export default function TransitionMockup({ route, navigation }) {
  const {
    title = 'Time to recite',
    subtitle = '',
    nextScreen = 'MockupRecitation',
    delay = 2800,
  } = route?.params ?? {};

  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.88)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 60, delay: 100, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }).start(() => {
        navigation.replace(nextScreen);
      });
    }, delay);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.inner, { opacity, transform: [{ scale }] }]}>
        <Animated.Image
          source={LOGO}
          style={[styles.logoImg, { transform: [{ scale: logoScale }] }]}
        />
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.cobalt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: { alignItems: 'center', paddingHorizontal: 40 },
  logoImg: {
    width: 72,
    height: 72,
    resizeMode: 'contain',
    tintColor: '#FFFFFF',
    marginBottom: 28,
  },
  title: {
    fontFamily: F.semiBold,
    fontSize: 30,
    color: C.white,
    textAlign: 'center',
    letterSpacing: -0.4,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: F.regular,
    fontSize: 15,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    lineHeight: 22,
  },
});
