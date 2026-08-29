import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { getCurrentUserId } from '../../lib/auth';
import { recommendedSessionMinutes } from '../../lib/portionMath';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../lib/theme';

/**
 * Session length on its own screen, reached from the settings list.
 *
 * Quarter hours and rounded up, matching onboarding: the slider can only land
 * on more time than the arithmetic asked for, never less.
 */
export default function SessionLengthScreen({ navigation }) {
  const [minutes, setMinutes] = useState(30);
  // Onboarding showed the suggested length and this screen did not, so someone
  // changing it later had no idea what the number was measured against.
  const [recommended, setRecommended] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const userId = await getCurrentUserId();
        const { data } = await supabase
          .from('users')
          .select('session_minutes, avg_minutes_per_page')
          .eq('id', userId)
          .maybeSingle();
        if (data?.session_minutes) setMinutes(data.session_minutes);

        // Same suggestion onboarding made, recomputed rather than stored, so it
        // follows the juz they have added or finished since, and their measured
        // pace. Onboarding has to assume the default because nobody has recited
        // anything yet; by the time someone reaches this screen the app knows
        // how long a page actually takes them, and a suggestion that ignored it
        // would be telling a slow reciter the same number as a fast one.
        const { count } = await supabase
          .from('juz_progress')
          .select('juz_number', { count: 'exact', head: true })
          .eq('user_id', userId);
        if (count) {
          setRecommended(recommendedSessionMinutes(count, data?.avg_minutes_per_page));
        }
      } catch {
        // Leaves the default in place; the slider still works.
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
        .update({ session_minutes: minutes })
        .eq('id', userId);
      if (updateError) throw new Error(updateError.message);
      navigation.goBack();
    } catch (err) {
      setError(err.message ?? 'Could not save.');
      setIsSaving(false);
    }
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
        <Text style={styles.title}>Session length</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.valueRow}>
          <Text style={styles.valueLabel}>Each day</Text>
          <Text style={styles.value}>{minutes} min</Text>
        </View>
        <Slider
          minimumValue={15}
          maximumValue={120}
          step={15}
          value={minutes}
          onValueChange={(v) => setMinutes(Math.ceil(v / 15) * 15)}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
        />
        <View style={styles.scaleRow}>
          <Text style={styles.scale}>15 min</Text>
          <Text style={styles.scale}>120 min</Text>
        </View>
        {recommended ? (
          <Text style={styles.recommendation}>
            {minutes === recommended
              ? `${recommended} minutes covers everything you have memorised on a monthly round.`
              : minutes < recommended
                ? `We suggest ${recommended} minutes. Less than that and a full round takes longer than a month.`
                : `We suggest ${recommended} minutes. More is fine, you will simply come round again sooner.`}
          </Text>
        ) : null}
        <Text style={styles.note}>
          The time you set is an estimate. What a day actually takes depends
          on what is due that day. If you are short of time, start anyway: even
          a few minutes of it helps.
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
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  valueRow: {
    flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'space-between', marginBottom: spacing.sm,
  },
  valueLabel: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  value: { fontFamily: fonts.semiBold, fontSize: 28, color: colors.primary },
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  scale: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted },
  recommendation: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.primary,
    lineHeight: 20,
    marginTop: spacing.md,
  },
  note: {
    fontFamily: fonts.regular, fontSize: 14, color: colors.textMid,
    lineHeight: 21, marginTop: spacing.sm,
  },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.error, marginTop: spacing.md },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 17, alignItems: 'center',
  },
  saveBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
});
