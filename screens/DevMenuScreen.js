import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getCurrentUserId } from '../lib/auth';
import { getJuzSurahRange } from '../lib/juzSurahMap';
import { useOnboarding } from '../lib/OnboardingContext';
import { supabase } from '../lib/supabase';
import { colors, fonts, radius, spacing } from '../lib/theme';

// Dev-only launcher shown ahead of onboarding so a tester can reach the
// recitation flow without walking the eight setup screens every time the
// database is reset. Registered from App.js behind __DEV__, so nothing here
// ships in a release build.

const SKIP_JUZ = 1;
const SKIP_PORTION_AYAHS = 7;

function Row({ label, hint, onPress, disabled, tone = 'plain' }) {
  return (
    <TouchableOpacity
      style={[styles.row, tone === 'primary' && styles.rowPrimary, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, tone === 'primary' && styles.rowLabelPrimary]}>{label}</Text>
        {hint ? (
          <Text style={[styles.rowHint, tone === 'primary' && styles.rowHintPrimary]}>{hint}</Text>
        ) : null}
      </View>
      <Text style={[styles.chevron, tone === 'primary' && styles.rowLabelPrimary]}>›</Text>
    </TouchableOpacity>
  );
}

export default function DevMenuScreen() {
  const navigation = useNavigation();
  const { completeOnboarding } = useOnboarding();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Writes the minimum a finished onboarding would have written, so the main
  // app has a juz to plan against. Juz 1 on purpose: it is the only juz whose
  // surah segments do not straddle a 7-ayah portion, so it avoids the
  // cross-surah bug until that fix lands.
  const skipSetup = async () => {
    setBusy(true);
    setError('');
    try {
      const userId = await getCurrentUserId();
      const range = getJuzSurahRange(SKIP_JUZ);

      const { error: progressError } = await supabase.from('juz_progress').upsert(
        {
          user_id: userId,
          juz_number: SKIP_JUZ,
          pass_mistakes: 0,
          first_pass_complete: false,
          portion_halved: false,
          repeat_used: false,
        },
        { onConflict: 'user_id,juz_number' }
      );
      if (progressError) throw new Error(progressError.message);

      // memorized_portions has no unique key, so a repeated skip would pile up
      // duplicate rows and inflate the onboarding resume count. Only insert
      // when this juz is not already recorded.
      const { count, error: countError } = await supabase
        .from('memorized_portions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('juz_number', SKIP_JUZ);
      if (countError) throw new Error(countError.message);

      if ((count ?? 0) === 0) {
        const { error: portionError } = await supabase.from('memorized_portions').insert({
          user_id: userId,
          juz_number: SKIP_JUZ,
          surah_start: range.surah_start,
          ayah_start: range.ayah_start,
          surah_end: range.surah_end,
          ayah_end: range.ayah_end,
        });
        if (portionError) throw new Error(portionError.message);
      }

      const { error: userError } = await supabase
        .from('users')
        .update({
          name: 'Tester',
          session_minutes: 30,
          gender: 'female',
          notification_time: '09:00:00',
          onboarding_completed: true,
        })
        .eq('id', userId);
      if (userError) throw new Error(userError.message);

      completeOnboarding();
    } catch (err) {
      setError(err.message ?? 'Failed to skip setup.');
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>Dev build only</Text>
        <Text style={styles.title}>Dawrah</Text>
        <Text style={styles.sub}>
          This screen does not exist in a release build. Skip straight into the app, or run setup
          the way a real tester would.
        </Text>

        {busy ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        ) : (
          <View style={styles.group}>
            <Row
              tone="primary"
              label="Skip setup, go to the app"
              hint={`Marks onboarding done and seeds juz ${SKIP_JUZ} at ${SKIP_PORTION_AYAHS} ayahs a day`}
              onPress={skipSetup}
            />
            <Row
              label="Run onboarding from the start"
              hint="All eight screens, exactly as a tester sees them"
              onPress={() => navigation.navigate('Welcome')}
            />
            <Row
              label="Design mockups"
              hint="Static screens, no data"
              onPress={() => navigation.navigate('Mockups')}
            />
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.footnote}>
          Once you are in the app, the Today screen has direct jumps into recitation and both
          quizzes.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 88, paddingBottom: spacing.xxl },

  eyebrow: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.accent,
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.semiBold,
    fontSize: 34,
    letterSpacing: -0.6,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMid,
    marginBottom: spacing.xl,
  },

  group: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  rowPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  rowDisabled: { opacity: 0.5 },
  rowBody: { flex: 1 },
  rowLabel: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.text },
  rowLabelPrimary: { color: colors.white },
  rowHint: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted, marginTop: 3 },
  rowHintPrimary: { color: 'rgba(255,255,255,0.78)' },
  chevron: { fontFamily: fonts.regular, fontSize: 22, color: colors.textMuted },

  loader: { marginVertical: spacing.xl },
  error: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.error,
    marginTop: spacing.md,
  },
  footnote: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    marginTop: spacing.xl,
  },
});
