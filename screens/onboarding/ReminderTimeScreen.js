import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import OnboardingProgressDots from '../../components/OnboardingProgressDots';
import { getCurrentUserId } from '../../lib/auth';
import { scheduleDailyNotification } from '../../lib/notifications';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../lib/theme';

function getDefault() {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  return d;
}

function formatTime(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatNotificationTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}:00`;
}

export default function ReminderTimeScreen({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const [time, setTime] = useState(getDefault);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  const handleConfirm = async () => {
    setIsSaving(true);
    setError('');
    try {
      const userId = await getCurrentUserId();
      const { error: updateError } = await supabase
        .from('users')
        .update({ notification_time: formatNotificationTime(time) })
        .eq('id', userId);
      if (updateError) throw new Error(updateError.message);
      await scheduleDailyNotification(time.getHours(), time.getMinutes());
      navigation.navigate('AllSet', { name });
    } catch (err) {
      setError(err.message ?? 'Failed to save reminder time.');
      setIsSaving(false);
    }
  };

  return (
    <Animated.View style={[styles.screen, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <OnboardingProgressDots current={6} total={7} />
        <Text style={styles.step}>Step 7 of 7</Text>
        <Text style={styles.question}>When should we remind you?</Text>
        <Text style={styles.sub}>We'll send a daily nudge at this time to keep your revision on track.</Text>
      </View>

      <View style={styles.pickerSection}>
        <View style={styles.timeDisplay}>
          <Text style={styles.timeValue}>{formatTime(time)}</Text>
        </View>
        <DateTimePicker
          value={time}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, selected) => { if (selected) setTime(selected); }}
          style={styles.picker}
          themeVariant="light"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleConfirm} activeOpacity={0.88} disabled={isSaving}>
          <Text style={styles.primaryBtnText}>{isSaving ? 'Saving…' : 'Confirm'}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: 64, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backBtn: { paddingBottom: spacing.sm, alignSelf: 'flex-start' },
  backBtnText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textMid },
  step: {
    fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm,
  },
  question: {
    fontFamily: fonts.semiBold, fontSize: 26, color: colors.text,
    letterSpacing: -0.3, marginBottom: spacing.sm, lineHeight: 34,
  },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMid, lineHeight: 21 },
  pickerSection: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, alignItems: 'center' },
  timeDisplay: { marginBottom: spacing.sm },
  timeValue: { fontFamily: fonts.semiBold, fontSize: 48, color: colors.primary, letterSpacing: -1 },
  picker: { width: '100%' },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.error, marginTop: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: 48, paddingTop: spacing.md },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 17, alignItems: 'center' },
  primaryBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
});
