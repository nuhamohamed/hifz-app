import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Slider from '@react-native-community/slider';
import { useNavigation } from '@react-navigation/native';
import TabBar from '../components/TabBar';
import { getCurrentUserId, isAnonymous, resetAccountData } from '../lib/auth';
import { useOnboarding } from '../lib/OnboardingContext';
import { scheduleDailyNotification } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { colors, fonts, radius, spacing } from '../lib/theme';

function formatNotificationTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}:00`;
}

function formatTimeDisplay(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
}

export default function SettingsScreen() {
  const { restartOnboarding } = useOnboarding();
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  // Confirmed before anything is touched. This is irreversible and there is no
  // sign-in to recover an account from, so it must not be a single tap.
  const handleStartOver = () => {
    Alert.alert(
      'Start over?',
      'This clears every session, mistake and review you have, and takes you back through setup. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start over',
          style: 'destructive',
          onPress: async () => {
            setIsResetting(true);
            setResetError('');
            try {
              const userId = await getCurrentUserId();
              await resetAccountData(userId);
              restartOnboarding();
            } catch (err) {
              setResetError(err.message ?? 'Could not clear your data.');
              setIsResetting(false);
            }
          },
        },
      ]
    );
  };

  const navigation = useNavigation();
  const [sessionMinutes, setSessionMinutes] = useState(30);
  const [reminderTime, setReminderTime] = useState(() => {
    const d = new Date();
    d.setHours(8, 0, 0, 0);
    return d;
  });
  const [showTimePicker, setShowTimePicker] = useState(Platform.OS === 'ios');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  // null = still checking; gates the sign-out button
  const [anonymous, setAnonymous] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const userId = await getCurrentUserId();
        const { data, error: fetchError } = await supabase
          .from('users')
          .select('session_minutes, notification_time')
          .eq('id', userId)
          .maybeSingle();

        if (fetchError) throw new Error(fetchError.message);

        if (data?.session_minutes) {
          setSessionMinutes(data.session_minutes);
        }
        if (data?.notification_time) {
          const [h, m] = data.notification_time.split(':').map(Number);
          const d = new Date();
          d.setHours(h, m, 0, 0);
          setReminderTime(d);
        }
      } catch (err) {
        setError(err.message ?? 'Failed to load settings.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const onTimeChange = (_event, selectedDate) => {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (selectedDate) setReminderTime(selectedDate);
  };

  const handleSave = async () => {
    setError('');
    setSaved(false);
    setIsSaving(true);
    try {
      const userId = await getCurrentUserId();

      const { error: updateError } = await supabase
        .from('users')
        .update({
          session_minutes: sessionMinutes,
          notification_time: formatNotificationTime(reminderTime),
        })
        .eq('id', userId);

      if (updateError) throw new Error(updateError.message);

      await scheduleDailyNotification(reminderTime.getHours(), reminderTime.getMinutes());

      setSaved(true);
    } catch (err) {
      setError(err.message ?? 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    isAnonymous().then((value) => {
      if (mounted) setAnonymous(value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSignOut = () => {
    Alert.alert('Sign out?', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setIsSigningOut(true);
          // No manual navigation — App.js reacts to the auth state change.
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.label}>Session length</Text>
          <Text style={styles.valueText}>{sessionMinutes} minutes</Text>
          <Slider
            style={styles.slider}
            minimumValue={15}
            maximumValue={120}
            step={5}
            value={sessionMinutes}
            onValueChange={setSessionMinutes}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.primary}
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>15 min</Text>
            <Text style={styles.sliderLabel}>120 min</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Daily reminder</Text>

          {Platform.OS === 'android' ? (
            <TouchableOpacity style={styles.timeButton} onPress={() => setShowTimePicker(true)} activeOpacity={0.8}>
              <Text style={styles.timeButtonText}>{formatTimeDisplay(reminderTime)}</Text>
            </TouchableOpacity>
          ) : null}

          {showTimePicker ? (
            <DateTimePicker
              value={reminderTime}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onTimeChange}
              themeVariant="light"
            />
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {saved ? <Text style={styles.savedText}>Saved.</Text> : null}

        {isSaving ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        ) : (
          <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.88}>
            <Text style={styles.saveButtonText}>Save</Text>
          </TouchableOpacity>
        )}

        {/* Anonymous users have no credentials to sign back in with, so
            signing out would strand their history behind an unreachable
            UUID. Shown again once accounts are reintroduced. */}
        {anonymous === false ? (
          <TouchableOpacity
            style={styles.signOutButton}
            onPress={handleSignOut}
            disabled={isSigningOut}
            activeOpacity={0.7}
          >
            <Text style={styles.signOutButtonText}>
              {isSigningOut ? 'Signing out…' : 'Sign out'}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Getting your juz wrong at onboarding was otherwise unrecoverable:
            the only escape was deleting the app, which destroys everything
            else too and, with no sign-in, cannot be undone. */}
        <View style={styles.dangerZone}>
          <Text style={styles.dangerLabel}>Start over</Text>
          <Text style={styles.dangerBody}>
            Clears everything you have done and takes you back through setup. Use
            this if you chose the wrong juz. It cannot be undone.
          </Text>
          <TouchableOpacity
            style={styles.dangerButton}
            onPress={handleStartOver}
            disabled={isResetting}
            activeOpacity={0.7}
          >
            <Text style={styles.dangerButtonText}>
              {isResetting ? 'Clearing…' : 'Start over'}
            </Text>
          </TouchableOpacity>
          {resetError ? <Text style={styles.error}>{resetError}</Text> : null}
        </View>
      </ScrollView>

      <TabBar active="settings" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: {
    paddingTop: 68, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontFamily: fonts.semiBold, fontSize: 28, color: colors.text, letterSpacing: -0.5 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 6,
  },
  valueText: {
    fontFamily: fonts.semiBold,
    fontSize: 22,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  slider: { width: '100%', height: 40 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted },
  timeButton: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  timeButtonText: { fontFamily: fonts.semiBold, fontSize: 18, color: colors.primary },
  error: {
    fontFamily: fonts.regular,
    color: colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  savedText: {
    fontFamily: fonts.medium,
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  loader: { marginTop: spacing.sm },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 17,
    alignItems: 'center',
  },
  saveButtonText: { fontFamily: fonts.semiBold, color: colors.white, fontSize: 17 },
  dangerZone: {
    marginTop: spacing.xxl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dangerLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 6,
  },
  dangerBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  dangerButton: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  dangerButtonText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.error,
  },
  signOutButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  signOutButtonText: { fontFamily: fonts.medium, color: colors.error, fontSize: 15 },
});
