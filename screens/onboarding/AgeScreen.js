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

/**
 * The minimum age Dawrah accepts.
 *
 * Storing personal data about children under 13 puts an app inside COPPA in the
 * United States, and inside the parental-consent rules in the UK and EU. Dawrah
 * keeps the age rather than checking and discarding it, so the only way to stay
 * outside all of that is to decline the account instead.
 */
export const MINIMUM_AGE = 13;

const MAXIMUM_AGE = 120;

/**
 * Asked before anything else is collected, which is the whole point of its
 * position in the flow. Name, gender and memorisation all come afterwards, so
 * someone under 13 is turned away before Dawrah has stored anything personal
 * about them at all.
 */
export default function AgeScreen({ navigation }) {
  const [age, setAge] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [tooYoung, setTooYoung] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  const parsed = Number.parseInt(age, 10);
  const looksLikeAnAge = Number.isInteger(parsed) && parsed > 0 && parsed <= MAXIMUM_AGE;
  const canContinue = looksLikeAnAge && !isSaving;

  // Digits only. A number pad still offers punctuation on some keyboards, and
  // a stray character would otherwise turn into NaN and silently disable the
  // button with no explanation.
  const handleChange = (text) => {
    setAge(text.replace(/[^0-9]/g, '').slice(0, 3));
    if (tooYoung) setTooYoung(false);
    if (error) setError('');
  };

  const handleContinue = async () => {
    if (!canContinue) return;

    // Checked before the write, not after. Nothing about someone under 13 is
    // stored, which is the difference between an age gate and an age record.
    if (parsed < MINIMUM_AGE) {
      setTooYoung(true);
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const userId = await getCurrentUserId();
      const { error: updateError } = await supabase
        .from('users')
        .update({ age: parsed })
        .eq('id', userId);
      if (updateError) throw new Error(updateError.message);
      navigation.navigate('Name');
    } catch (err) {
      setError(err.message ?? 'Failed to save your age.');
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
        <OnboardingProgressDots current={0} total={7} />

        <View style={styles.content}>
          <Text style={styles.step}>Step 1 of 7</Text>
          <Text style={styles.question}>How old are you?</Text>

          <TextInput
            style={[
              styles.input,
              age.length > 0 && styles.inputFocused,
              tooYoung && styles.inputRejected,
            ]}
            placeholder="Your age"
            placeholderTextColor={colors.textMuted}
            value={age}
            onChangeText={handleChange}
            keyboardType="number-pad"
            returnKeyType="done"
            maxLength={3}
            onSubmitEditing={handleContinue}
          />

          {tooYoung ? (
            <View style={styles.note}>
              <Text style={styles.noteTitle}>
                Dawrah is for ages {MINIMUM_AGE} and over
              </Text>
              <Text style={styles.noteText}>
                We are sorry. Your hifdh matters just as much, and we hope to be
                able to welcome you before long. Nothing you have entered has
                been saved.
              </Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, (!canContinue || tooYoung) && styles.primaryBtnDisabled]}
          onPress={handleContinue}
          activeOpacity={0.88}
          disabled={!canContinue || tooYoung}
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
    marginBottom: spacing.xl,
    lineHeight: 36,
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
  inputRejected: { borderColor: colors.error },
  note: {
    marginTop: spacing.md,
    backgroundColor: colors.errorLight,
    borderRadius: 12,
    padding: spacing.md,
  },
  noteTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  noteText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMid,
    lineHeight: 21,
  },
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
