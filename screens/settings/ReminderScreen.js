import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { getCurrentUserId } from '../../lib/auth';
import { cancelDailyNotification, scheduleDailyNotification } from '../../lib/notifications';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../lib/theme';

function toDbTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}:00`;
}

/**
 * The daily reminder, on its own screen.
 *
 * Saving reports what actually happened rather than assuming. Scheduling
 * returns false when iOS is blocking notifications, and that used to be
 * discarded, so someone could set a time and be told it was saved while no
 * reminder could ever fire.
 */
export default function ReminderScreen({ navigation }) {
  const [time, setTime] = useState(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const userId = await getCurrentUserId();
        const { data } = await supabase
          .from('users')
          .select('notification_time')
          .eq('id', userId)
          .maybeSingle();
        if (data?.notification_time) {
          const [h, m] = data.notification_time.split(':').map(Number);
          const d = new Date();
          d.setHours(h, m, 0, 0);
          setTime(d);
        }
        const { status } = await Notifications.getPermissionsAsync();
        setBlocked(status !== 'granted');
      } catch {
        // The picker still works; only the warning is missing.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    try {
      const userId = await getCurrentUserId();
      const { error: updateError } = await supabase
        .from('users')
        .update({ notification_time: toDbTime(time) })
        .eq('id', userId);
      if (updateError) throw new Error(updateError.message);

      const scheduled = await scheduleDailyNotification(time.getHours(), time.getMinutes());
      if (!scheduled) {
        setBlocked(true);
        setError('Saved, but iOS is blocking notifications so nothing will arrive.');
        setIsSaving(false);
        return;
      }
      navigation.goBack();
    } catch (err) {
      setError(err.message ?? 'Could not save.');
      setIsSaving(false);
    }
  };

  const handleTurnOff = async () => {
    setIsSaving(true);
    await cancelDailyNotification();
    navigation.goBack();
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
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.back}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Daily reminder</Text>
      </View>

      <View style={styles.body}>
        {blocked ? (
          <View style={styles.blockedBox}>
            <Text style={styles.blockedText}>
              iOS is blocking notifications for Dawrah, so no reminder can arrive
              whatever time is set here.
            </Text>
            <TouchableOpacity onPress={() => Linking.openSettings()} activeOpacity={0.7}>
              <Text style={styles.blockedLink}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.pickerCard}>
          <DateTimePicker
            value={time}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_e, selected) => selected && setTime(selected)}
          />
        </View>

        <Text style={styles.note}>
          Sent only on days that hold something. A reminder to open an app with
          nothing in it is how reminders get ignored.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={handleSave}
          activeOpacity={0.88}
          disabled={isSaving}
        >
          <Text style={styles.saveBtnText}>{isSaving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.offBtn} onPress={handleTurnOff} activeOpacity={0.7}>
          <Text style={styles.offBtnText}>Turn reminders off</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.background,
  },
  header: { paddingTop: 64, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  back: { fontFamily: fonts.medium, fontSize: 16, color: colors.primary, marginBottom: spacing.sm },
  title: { fontFamily: fonts.semiBold, fontSize: 28, color: colors.text, letterSpacing: -0.4 },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  pickerCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  blockedBox: {
    backgroundColor: colors.accentLight, borderRadius: radius.sm,
    padding: spacing.md, marginBottom: spacing.md,
  },
  blockedText: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMid, lineHeight: 21 },
  blockedLink: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.primary, marginTop: spacing.sm },
  note: {
    fontFamily: fonts.regular, fontSize: 14, color: colors.textMid,
    lineHeight: 21, marginTop: spacing.lg,
  },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.error, marginTop: spacing.md },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: 40, gap: 4 },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 17, alignItems: 'center',
  },
  saveBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
  offBtn: { paddingVertical: 14, alignItems: 'center' },
  offBtnText: { fontFamily: fonts.medium, fontSize: 15, color: colors.textMid },
});
