import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { signInWithGoogle } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../lib/theme';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const handleAuth = async (mode) => {
    setError('');
    setIsLoading(true);

    try {
      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password) {
        throw new Error('Please enter your email and password.');
      }

      const result =
        mode === 'signIn'
          ? await supabase.auth.signInWithPassword({
              email: trimmedEmail,
              password,
            })
          : await supabase.auth.signUp({
              email: trimmedEmail,
              password,
            });

      if (result.error) {
        throw new Error(result.error.message);
      }
      // No manual navigation here — App.js listens for the auth state change
      // and swaps to the app navigator (routing fresh sign-ups to onboarding).
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsGoogleLoading(true);
    try {
      await signInWithGoogle();
      // No manual navigation — App.js reacts to the auth state change once
      // the session is set.
    } catch (err) {
      setError(err.message ?? 'Google sign-in failed. Please try again.');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Dawrah</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isLoading ? (
          <ActivityIndicator
            size="large"
            color={colors.primary}
            style={styles.loader}
          />
        ) : (
          <View style={styles.buttonGroup}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => handleAuth('signIn')}
              activeOpacity={0.88}
            >
              <Text style={styles.primaryButtonText}>Sign In</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => handleAuth('signUp')}
              activeOpacity={0.7}
            >
              <Text style={styles.secondaryButtonText}>Sign Up</Text>
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {isGoogleLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <TouchableOpacity
                style={styles.googleButton}
                onPress={handleGoogleSignIn}
                activeOpacity={0.8}
              >
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    paddingTop: 64,
  },
  title: {
    fontFamily: fonts.semiBold,
    fontSize: 30,
    color: colors.primary,
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textMid,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  error: {
    fontFamily: fonts.regular,
    color: colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  loader: {
    marginTop: spacing.md,
  },
  buttonGroup: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 17,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontFamily: fonts.semiBold,
    color: colors.white,
    fontSize: 17,
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 17,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: fonts.semiBold,
    color: colors.primary,
    fontSize: 17,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
  },
  googleButton: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 17,
    alignItems: 'center',
  },
  googleButtonText: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 16,
  },
});
