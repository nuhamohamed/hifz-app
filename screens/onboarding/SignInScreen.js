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
import { supabase } from '../../lib/supabase';

export default function SignInScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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

      if (mode === 'signUp') {
        navigation.reset({
          index: 0,
          routes: [{ name: 'MemorizedJuz' }],
        });
      }
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Hifz Revision</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#999"
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
          placeholderTextColor="#999"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isLoading ? (
          <ActivityIndicator
            size="large"
            color="#2e7d32"
            style={styles.loader}
          />
        ) : (
          <View style={styles.buttonGroup}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => handleAuth('signIn')}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>Sign In</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => handleAuth('signUp')}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    paddingTop: 64,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1b5e20',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: '#fafafa',
  },
  error: {
    color: '#c62828',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  loader: {
    marginTop: 16,
  },
  buttonGroup: {
    gap: 12,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 2,
    borderColor: '#2e7d32',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#2e7d32',
    fontSize: 17,
    fontWeight: '700',
  },
});
