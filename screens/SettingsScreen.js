import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import TabBar from '../components/TabBar';
import SettingsGroup from './settings/SettingsGroup';
import SettingsRow from './settings/SettingsRow';
import { getCurrentUserId, isAnonymous } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors, fonts, spacing } from '../lib/theme';

function displayTime(dbTime) {
  if (!dbTime) return 'Off';
  const [h, m] = dbTime.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * A grouped list, the way a settings screen is expected to behave: each row
 * shows its current value and opens on its own screen.
 *
 * It used to be one long form with a slider, a time picker and a save button
 * all at once, so changing the reminder meant scrolling past the session
 * length, and the irreversible action sat at the bottom of the same page.
 */
export default function SettingsScreen() {
  const navigation = useNavigation();
  const [settings, setSettings] = useState(null);
  const [anonymous, setAnonymous] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Re-read on focus so a value changed on a detail screen is current when the
  // list comes back, rather than showing what it was before the change.
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        try {
          const userId = await getCurrentUserId();
          const { data, error: fetchError } = await supabase
            .from('users')
            .select('session_minutes, notification_time')
            .eq('id', userId)
            .maybeSingle();
          if (fetchError) throw new Error(fetchError.message);
          if (mounted) setSettings(data ?? {});
          const anon = await isAnonymous();
          if (mounted) setAnonymous(anon);
        } catch (err) {
          if (mounted) setError(err.message ?? 'Failed to load settings.');
        } finally {
          if (mounted) setIsLoading(false);
        }
      })();
      return () => {
        mounted = false;
      };
    }, [])
  );

  const handleSignOut = () => {
    Alert.alert('Sign out?', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        // No manual navigation: App.js reacts to the auth state change.
        onPress: () => supabase.auth.signOut(),
      },
    ]);
  };

  if (isLoading) {
    return (
      <View style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
        <TabBar active="settings" navigation={navigation} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SettingsGroup title="Your day">
          <SettingsRow
            label="Session length"
            value={settings?.session_minutes ? `${settings.session_minutes} min` : 'Not set'}
            onPress={() => navigation.navigate('SettingsSessionLength')}
          />
          <SettingsRow
            label="Daily reminder"
            value={displayTime(settings?.notification_time)}
            onPress={() => navigation.navigate('SettingsReminder')}
            last
          />
        </SettingsGroup>

        {anonymous === false ? (
          <SettingsGroup title="Account">
            <SettingsRow label="Sign out" onPress={handleSignOut} last />
          </SettingsGroup>
        ) : null}

        <SettingsGroup
          footer="Dawrah keeps your progress on this phone only. There is no sign-in yet, so anything erased cannot be recovered."
        >
          <SettingsRow
            label="Erase all my data"
            onPress={() => navigation.navigate('SettingsEraseData')}
            destructive
            last
          />
        </SettingsGroup>
      </ScrollView>

      <TabBar active="settings" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingTop: 64, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { fontFamily: fonts.semiBold, fontSize: 32, color: colors.text, letterSpacing: -0.5 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.error, marginBottom: spacing.md },
});
