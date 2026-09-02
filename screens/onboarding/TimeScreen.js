import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import OnboardingProgressDots from '../../components/OnboardingProgressDots';
import { getCurrentUserId } from '../../lib/auth';
import { recommendedSessionMinutes, suggestionLine } from '../../lib/portionMath';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../lib/theme';

export default function TimeScreen({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const [sessionMinutes, setSessionMinutes] = useState(30);
  const [recommended, setRecommended] = useState(null);
  const [juzCount, setJuzCount] = useState(0);
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
        // The slider is deliberately NOT moved to the suggestion. Landing
        // already on it meant the suggestion could never be below the slider,
        // so the line explaining it never appeared and the number arrived
        // looking like an arbitrary default. Left at 30, someone who needs more
        // than that is told so and moves the slider themselves, which is a
        // choice rather than something inherited.
        const suggestion = recommendedSessionMinutes(count);
        setJuzCount(count);
        setRecommended(suggestion);
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
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.valueRow}>
          <Text style={styles.valueLabel}>Session length</Text>
          <Text style={styles.valueDisplay}>{sessionMinutes} min</Text>
        </View>
        {/* Every minute is selectable. This used to snap to quarter hours, on
            the reasoning that nobody plans a day around 35 minutes. But the
            person choosing knows what their day looks like better than the
            slider does, and someone with exactly 40 minutes was being rounded
            to 45 whether that fitted or not. The recommendation is still a
            quarter hour, rounded up, because a suggestion should be a round
            number; what someone picks for themselves need not be. */}
        <Slider
          style={styles.slider}
          minimumValue={15}
          maximumValue={120}
          step={1}
          value={sessionMinutes}
          onValueChange={(v) => setSessionMinutes(Math.round(v))}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
        />
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderLabel}>15 min</Text>
          <Text style={styles.sliderLabel}>120 min</Text>
        </View>
        {/* Only when they have landed below it. Above or on the suggestion
            there is nothing to warn about, and a line confirming a good choice
            every time is noise that trains people to stop reading. The caveat
            below stays put either way, because it is true at any length. */}
        {recommended && sessionMinutes < recommended ? (
          <Text style={styles.recommendation}>{suggestionLine(recommended, juzCount)}</Text>
        ) : null}
        <Text style={styles.caveat}>
          This is an estimate, not a fixed length. A day runs longer or shorter
          depending on what is due and how many mistakes you have to go over. If
          you are short of time, start anyway: even a few minutes helps.
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
  header: { paddingTop: 80, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
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
