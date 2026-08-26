import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import OnboardingProgressDots from '../../components/OnboardingProgressDots';
import { getCurrentUserId } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../lib/theme';

export default function TimeScreen({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const [sessionMinutes, setSessionMinutes] = useState(30);
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

  const handleContinue = async () => {
    setIsSaving(true);
    setError('');
    try {
      const userId = await getCurrentUserId();
      const { error: updateError } = await supabase
        .from('users')
        .update({ session_minutes: sessionMinutes })
        .eq('id', userId);
      if (updateError) throw new Error(updateError.message);
      navigation.navigate('Gender', { name });
    } catch (err) {
      setError(err.message ?? 'Failed to save session length.');
      setIsSaving(false);
    }
  };

  return (
    <Animated.View style={[styles.screen, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <OnboardingProgressDots current={2} total={6} />
        <Text style={styles.step}>Step 3 of 6</Text>
        <Text style={styles.question}>How much time can you spend each day?</Text>
        <Text style={styles.sub}>We'll plan your sessions to fit within this window.</Text>
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.valueRow}>
          <Text style={styles.valueLabel}>Session length</Text>
          <Text style={styles.valueDisplay}>{sessionMinutes} min</Text>
        </View>
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
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleContinue}
          activeOpacity={0.88}
          disabled={isSaving}
        >
          <Text style={styles.primaryBtnText}>{isSaving ? 'Saving…' : 'Continue'}</Text>
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
  sliderSection: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  valueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  valueLabel: { fontFamily: fonts.medium, fontSize: 15, color: colors.textMid },
  valueDisplay: { fontFamily: fonts.semiBold, fontSize: 28, color: colors.primary, letterSpacing: -0.5 },
  slider: { width: '100%', height: 40 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  sliderLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.error, marginTop: spacing.md },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: 48, paddingTop: spacing.md },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 17, alignItems: 'center' },
  primaryBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
});
