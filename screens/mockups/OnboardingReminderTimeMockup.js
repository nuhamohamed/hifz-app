import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { C, F, R, S } from './design';
import { useMockup } from './MockupContext';

function ProgressDots({ current, total }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.dot, i === current && styles.dotActive, i < current && styles.dotPast]} />
      ))}
    </View>
  );
}

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

export default function OnboardingReminderTimeMockup({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const { updateProfile } = useMockup();
  const [time, setTime] = useState(getDefault);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleConfirm = () => {
    updateProfile({ reminderTime: time });
    navigation.navigate('MockupAllSet', { name });
  };

  return (
    <Animated.View style={[styles.screen, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <ProgressDots current={5} total={6} />
        <Text style={styles.step}>Step 6 of 6</Text>
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
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleConfirm} activeOpacity={0.88}>
          <Text style={styles.primaryBtnText}>Confirm</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: { paddingTop: 64, paddingHorizontal: S.lg, paddingBottom: S.md },
  backBtn: { paddingBottom: S.sm, alignSelf: 'flex-start' },
  backBtnText: { fontFamily: F.medium, fontSize: 14, color: C.navyMid },
  dots: { flexDirection: 'row', gap: 6, marginBottom: S.lg },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.navyLight, opacity: 0.3 },
  dotActive: { backgroundColor: C.cobalt, opacity: 1, width: 20 },
  dotPast: { backgroundColor: C.cobalt, opacity: 0.4 },
  step: {
    fontFamily: F.medium, fontSize: 13, color: C.navyLight,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: S.sm,
  },
  question: {
    fontFamily: F.semiBold, fontSize: 26, color: C.navy,
    letterSpacing: -0.3, marginBottom: S.sm, lineHeight: 34,
  },
  sub: { fontFamily: F.regular, fontSize: 14, color: C.navyMid, lineHeight: 21 },
  pickerSection: { flex: 1, paddingHorizontal: S.lg, paddingTop: S.md, alignItems: 'center' },
  timeDisplay: { marginBottom: S.sm },
  timeValue: { fontFamily: F.semiBold, fontSize: 48, color: C.cobalt, letterSpacing: -1 },
  picker: { width: '100%' },
  footer: { paddingHorizontal: S.lg, paddingBottom: 48, paddingTop: S.md },
  primaryBtn: { backgroundColor: C.cobalt, borderRadius: R.md, paddingVertical: 17, alignItems: 'center' },
  primaryBtnText: { fontFamily: F.semiBold, fontSize: 17, color: C.white },
});
