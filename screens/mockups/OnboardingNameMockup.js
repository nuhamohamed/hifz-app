import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, S } from './design';

function ProgressDots({ current, total }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.dot, i === current && styles.dotActive]} />
      ))}
    </View>
  );
}

export default function OnboardingNameMockup({ navigation }) {
  const [name, setName] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, []);

  const canContinue = name.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.View style={[styles.inner, { opacity, transform: [{ translateY }] }]}>
        <ProgressDots current={0} total={5} />

        <View style={styles.content}>
          <Text style={styles.step}>Step 1 of 5</Text>
          <Text style={styles.question}>What should we call you?</Text>
          <Text style={styles.sub}>We'll use this to personalise your experience.</Text>

          <TextInput
            style={[styles.input, name.length > 0 && styles.inputFocused]}
            placeholder="Your first name"
            placeholderTextColor={C.navyLight}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            returnKeyType="done"
            autoFocus
          />
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, !canContinue && styles.primaryBtnDisabled]}
          onPress={() => canContinue && navigation.navigate('MockupOnboardingMemorization', { name })}
          activeOpacity={0.88}
          disabled={!canContinue}
        >
          <Text style={styles.primaryBtnText}>Continue</Text>
        </TouchableOpacity>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },
  inner: {
    flex: 1,
    paddingTop: 64,
    paddingHorizontal: S.lg,
    paddingBottom: 48,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: S.xl,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.navyLight,
    opacity: 0.3,
  },
  dotActive: {
    backgroundColor: C.cobalt,
    opacity: 1,
    width: 20,
  },
  content: { flex: 1 },
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
    fontSize: 28,
    color: C.navy,
    letterSpacing: -0.3,
    marginBottom: S.sm,
    lineHeight: 36,
  },
  sub: {
    fontFamily: F.regular,
    fontSize: 15,
    color: C.navyMid,
    marginBottom: S.xl,
    lineHeight: 22,
  },
  input: {
    backgroundColor: C.white,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
    borderRadius: 14,
    paddingHorizontal: S.md,
    paddingVertical: 16,
    fontFamily: F.medium,
    fontSize: 18,
    color: C.navy,
  },
  inputFocused: {
    borderColor: C.cobalt,
  },
  primaryBtn: {
    backgroundColor: C.cobalt,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    fontFamily: F.semiBold,
    fontSize: 17,
    color: C.white,
  },
});
