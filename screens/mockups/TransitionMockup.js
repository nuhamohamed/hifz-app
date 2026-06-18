import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { C, F } from './design';

/**
 * Reusable full-screen fade transition used between session phases.
 * Props: title, subtitle, nextScreen (navigation target), delay (ms before auto-nav)
 */
export default function TransitionMockup({ route, navigation }) {
  const {
    title = 'Time to recite',
    subtitle = '',
    nextScreen = 'MockupRecitation',
    delay = 2800,
  } = route?.params ?? {};

  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 8, tension: 50, useNativeDriver: true }),
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
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>☽</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        }
        <View style={styles.dotsRow}>
          {[0, 1, 2].map((i) => (
            <PulseDot key={i} delay={i * 180} />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

function PulseDot({ delay }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={[styles.dot, { opacity: anim }]} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.cobalt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: { alignItems: 'center', paddingHorizontal: 40 },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  icon: { fontSize: 36, color: C.gold },
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
    marginBottom: 24,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: C.white,
  },
});
