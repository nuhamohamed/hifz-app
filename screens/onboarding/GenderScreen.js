import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import OnboardingProgressDots from '../../components/OnboardingProgressDots';
import { getCurrentUserId } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, fonts, spacing } from '../../lib/theme';

function GenderCard({ label, icon, desc, selected, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={styles.cardIcon}>{icon}</Text>
      <Text style={[styles.cardLabel, selected && styles.cardLabelSelected]}>{label}</Text>
      {desc ? <Text style={styles.cardDesc}>{desc}</Text> : null}
    </TouchableOpacity>
  );
}

export default function GenderScreen({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const [selected, setSelected] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, [opacity]);

  const saveAndContinue = async (gender) => {
    setIsSaving(true);
    setError('');
    try {
      const userId = await getCurrentUserId();
      const { error: updateError } = await supabase
        .from('users')
        .update({ gender })
        .eq('id', userId);
      if (updateError) throw new Error(updateError.message);
      navigation.navigate('Notifications', { name });
    } catch (err) {
      setError(err.message ?? 'Failed to save.');
      setIsSaving(false);
    }
  };

  const handleContinue = () => {
    if (!selected || isSaving) return;
    saveAndContinue(selected);
  };

  const handleSkip = () => {
    if (isSaving) return;
    saveAndContinue(null);
  };

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <OnboardingProgressDots current={4} total={7} />
        <Text style={styles.step}>Step 5 of 7</Text>
        <Text style={styles.question}>Are you male or female?</Text>
        <Text style={styles.sub}>
          We use this to support your revision during periods, keeping your streak intact with non-recitation review.
        </Text>
      </View>

      <View style={styles.cards}>
        <GenderCard label="Male" icon="♂" selected={selected === 'male'} onPress={() => setSelected('male')} />
        <GenderCard
          label="Female"
          icon="♀"
          desc="Includes period mode, maintain your streak with flashcard review."
          selected={selected === 'female'}
          onPress={() => setSelected('female')}
        />
      </View>

      {selected === 'female' ? (
        <View style={styles.note}>
          <Text style={styles.noteIcon}>✦</Text>
          <Text style={styles.noteText}>
            During your period, Dawrah switches to silent review mode, no recitation required, streak stays intact.
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, !selected && styles.primaryBtnDisabled]}
          onPress={handleContinue}
          activeOpacity={0.88}
          disabled={!selected || isSaving}
        >
          <Text style={styles.primaryBtnText}>{isSaving ? 'Saving…' : 'Continue'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.7} disabled={isSaving}>
          <Text style={styles.skipBtnText}>Skip this step</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: 64, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  step: {
    fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm,
  },
  question: {
    fontFamily: fonts.semiBold, fontSize: 26, color: colors.text,
    letterSpacing: -0.3, marginBottom: spacing.sm, lineHeight: 34,
  },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMid, lineHeight: 21 },
  cards: { flexDirection: 'row', paddingHorizontal: spacing.lg, gap: 12, marginTop: spacing.md },
  card: {
    flex: 1, backgroundColor: colors.card, borderRadius: 16, padding: spacing.md,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'flex-start', minHeight: 130,
  },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  cardIcon: { fontSize: 24, marginBottom: spacing.sm, color: colors.primary },
  cardLabel: { fontFamily: fonts.semiBold, fontSize: 18, color: colors.text, marginBottom: spacing.xs },
  cardLabelSelected: { color: colors.primary },
  cardDesc: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMid, lineHeight: 17, marginTop: 4 },
  note: {
    flexDirection: 'row', marginHorizontal: spacing.lg, marginTop: spacing.md,
    backgroundColor: colors.goldLight, borderRadius: 12, padding: spacing.md, gap: 10, alignItems: 'flex-start',
  },
  noteIcon: { fontSize: 14, color: colors.accent, marginTop: 2 },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.text, lineHeight: 19 },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.error, textAlign: 'center', marginTop: spacing.md },
  backBtn: { paddingBottom: spacing.sm, alignSelf: 'flex-start' },
  backBtnText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textMid },
  footer: { marginTop: 'auto', paddingHorizontal: spacing.lg, paddingBottom: 48, paddingTop: spacing.md },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 17, alignItems: 'center', marginBottom: 4 },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
  skipBtn: { paddingVertical: 14, alignItems: 'center' },
  skipBtnText: { fontFamily: fonts.medium, fontSize: 15, color: colors.textMid },
});
