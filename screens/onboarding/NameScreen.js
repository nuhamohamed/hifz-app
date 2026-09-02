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
import OnboardingProgressDots from '../../components/OnboardingProgressDots';
import { getCurrentUserId } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, fonts, spacing } from '../../lib/theme';

export default function NameScreen({ navigation }) {
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  const canContinue = name.trim().length > 0 && !isSaving;

  const handleContinue = async () => {
    if (!canContinue) return;
    setIsSaving(true);
    setError('');
    try {
      const trimmed = name.trim();
      const userId = await getCurrentUserId();
      const { error: updateError } = await supabase
        .from('users')
        .update({ name: trimmed })
        .eq('id', userId);
      if (updateError) throw new Error(updateError.message);
      navigation.navigate('Memorization', { name: trimmed });
    } catch (err) {
      setError(err.message ?? 'Failed to save your name.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.View style={[styles.inner, { opacity, transform: [{ translateY }] }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <OnboardingProgressDots current={1} total={7} />

        <View style={styles.content}>
          <Text style={styles.step}>Step 2 of 7</Text>
          <Text style={styles.question}>What should we call you?</Text>
          <Text style={styles.sub}>We'll use this to personalize your experience.</Text>

          <TextInput
            style={[styles.input, name.length > 0 && styles.inputFocused]}
            placeholder="Your first name"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={handleContinue}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, !canContinue && styles.primaryBtnDisabled]}
          onPress={handleContinue}
          activeOpacity={0.88}
          disabled={!canContinue}
        >
          <Text style={styles.primaryBtnText}>{isSaving ? 'Saving…' : 'Continue'}</Text>
        </TouchableOpacity>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  inner: {
    flex: 1,
    paddingTop: 80,
    paddingHorizontal: spacing.lg,
    paddingBottom: 48,
  },
  backBtn: { paddingBottom: spacing.sm, alignSelf: 'flex-start' },
  backBtnText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textMid },
  content: { flex: 1 },
  step: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  question: {
    fontFamily: fonts.semiBold,
    fontSize: 28,
    color: colors.text,
    letterSpacing: -0.3,
    marginBottom: spacing.sm,
    lineHeight: 36,
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textMid,
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    fontFamily: fonts.medium,
    fontSize: 18,
    color: colors.text,
  },
  inputFocused: { borderColor: colors.brown },
  error: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.error,
    marginTop: spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
});
