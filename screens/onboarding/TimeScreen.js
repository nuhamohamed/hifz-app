import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import OnboardingProgressDots from '../../components/OnboardingProgressDots';
import { getCurrentUserId } from '../../lib/auth';
import { recommendedSessionMinutes } from '../../lib/portionMath';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../lib/theme';

export default function TimeScreen({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const [sessionMinutes, setSessionMinutes] = useState(30);
  const [recommended, setRecommended] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  // The previous screen has already recorded what they know, so the slider can
  // arrive on the right number instead of correcting them afterwards. A full
  // round of everything memorised is about 20 pages a day, and no arrangement
  // of 20 minutes covers 20 pages: 1 to 8 juz needs 15 minutes, 30 juz needs 55.
  // Rounded up, because too much time is a day that ends early while too little
  // is a backlog that never clears.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const userId = await getCurrentUserId();
        const { count } = await supabase
          .from('juz_progress')
          .select('juz_number', { count: 'exact', head: true })
          .eq('user_id', userId);
        if (!mounted || !count) return;
        const suggestion = recommendedSessionMinutes(count);
        setRecommended(suggestion);
        setSessionMinutes(suggestion);
      } catch {
        // A failed lookup just leaves the default in place. Not worth blocking
        // onboarding over a suggestion.
      }
    })();
    return () => { mounted = false; };
  }, []);

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
      navigation.navigate('Notifications', { name });
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
        <OnboardingProgressDots current={3} total={7} />
        <Text style={styles.step}>Step 4 of 7</Text>
        <Text style={styles.question}>How much time can you spend each day?</Text>
        <Text style={styles.sub}>We'll plan your sessions to fit within this window.</Text>
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.valueRow}>
          <Text style={styles.valueLabel}>Session length</Text>
          <Text style={styles.valueDisplay}>{sessionMinutes} min</Text>
        </View>
        {/* Quarter hours only. A 5-minute step invited numbers like 35 and 50
            that nobody plans a day around, and the recommendation is already
            rounded up to a multiple of 5. Rounding up here as well means the
            slider can only ever land on more time than the arithmetic asked
            for, never less, which is the safe direction: too much time is a
            day that ends early, too little is a backlog that never clears. */}
        <Slider
          style={styles.slider}
          minimumValue={15}
          maximumValue={120}
          step={15}
          value={sessionMinutes}
          onValueChange={(v) => setSessionMinutes(Math.ceil(v / 15) * 15)}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
        />
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderLabel}>15 min</Text>
          <Text style={styles.sliderLabel}>120 min</Text>
        </View>
        {recommended ? (
          <Text style={styles.recommendation}>
            {sessionMinutes === recommended
              ? `${recommended} minutes covers everything you have memorised on a monthly round.`
              : sessionMinutes < recommended
                ? `We suggest ${recommended} minutes. Less than that and a full round takes longer than a month.`
                : `We suggest ${recommended} minutes. More is fine, you will simply come round again sooner.`}
          </Text>
        ) : null}
        <Text style={styles.caveat}>
          The time you set is an estimate. What a day actually takes depends
          on what is due that day. If you are short of time, start anyway: even
          a few minutes of it helps.
        </Text>
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
  caveat: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
    marginTop: spacing.lg,
  },
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
  recommendation: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMid,
    marginTop: spacing.lg,
  },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.error, marginTop: spacing.md },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: 48, paddingTop: spacing.md },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 17, alignItems: 'center' },
  primaryBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
});
