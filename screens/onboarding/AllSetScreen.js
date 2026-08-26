import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getCurrentUserId } from '../../lib/auth';
import { useOnboarding } from '../../lib/OnboardingContext';
import { seedJuzProgressFromMemorized } from '../../lib/planEngine';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../lib/theme';

function CheckMark({ scale, opacity }) {
  return (
    <Animated.View style={[styles.checkWrap, { transform: [{ scale }], opacity }]}>
      <View style={styles.checkRing} />
      <Text style={styles.checkIcon}>✓</Text>
    </Animated.View>
  );
}

function StaggerLine({ children, delay, style }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 400, delay, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY, delay]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

export default function AllSetScreen({ route }) {
  const name = route?.params?.name ?? 'there';
  const { completeOnboarding } = useOnboarding();
  const [isFinishing, setIsFinishing] = useState(false);
  const [error, setError] = useState('');
  const checkScale = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.spring(checkScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
        Animated.timing(checkOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();
  }, [checkScale, checkOpacity]);

  const handleFinish = async () => {
    setIsFinishing(true);
    setError('');
    try {
      const userId = await getCurrentUserId();
      await seedJuzProgressFromMemorized(userId);
      const { error: updateError } = await supabase
        .from('users')
        .update({ onboarding_completed: true })
        .eq('id', userId);
      if (updateError) throw new Error(updateError.message);
      completeOnboarding();
    } catch (err) {
      setError(err.message ?? 'Failed to finish setup.');
      setIsFinishing(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.inner}>
        <CheckMark scale={checkScale} opacity={checkOpacity} />

        <StaggerLine delay={500}>
          <Text style={styles.title}>You're all set{name !== 'there' ? `, ${name}` : ''}.</Text>
        </StaggerLine>

        <StaggerLine delay={700}>
          <Text style={styles.body}>
            Your first session is ready. Press start and Dawrah takes it from there: a short mistake review, then your recitation, then a quick recap to lock it in.
          </Text>
        </StaggerLine>

        <StaggerLine delay={900} style={styles.hintRow}>
          <View style={styles.hintCard}>
            <Text style={styles.hintIcon}>🎙</Text>
            <Text style={styles.hintText}>Just recite naturally. We follow along word by word no tapping, no scrolling.</Text>
          </View>
        </StaggerLine>

        <StaggerLine delay={1100} style={styles.hintRow}>
          <View style={styles.hintCard}>
            <Text style={styles.hintIcon}>✦</Text>
            <Text style={styles.hintText}>Mistakes are saved automatically and worked into future sessions.</Text>
          </View>
        </StaggerLine>

        <View style={styles.spacer} />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <StaggerLine delay={1300}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleFinish}
            activeOpacity={0.88}
            disabled={isFinishing}
          >
            <Text style={styles.primaryBtnText}>
              {isFinishing ? 'Setting up…' : 'Start my first session'}
            </Text>
          </TouchableOpacity>
        </StaggerLine>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  inner: {
    flex: 1,
    paddingTop: 80,
    paddingHorizontal: spacing.lg,
    paddingBottom: 48,
  },
  checkWrap: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    alignSelf: 'center',
  },
  checkRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2.5,
    borderColor: colors.primary,
    opacity: 0.2,
  },
  checkIcon: {
    fontSize: 36,
    color: colors.primary,
  },
  title: {
    fontFamily: fonts.semiBold,
    fontSize: 30,
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: spacing.md,
    lineHeight: 38,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textMid,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  hintRow: {
    width: '100%',
    marginBottom: spacing.sm,
  },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
  },
  hintIcon: {
    fontSize: 18,
    marginTop: 1,
  },
  hintText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMid,
    lineHeight: 21,
  },
  spacer: { flex: 1 },
  error: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 17,
    alignItems: 'center',
    width: '100%',
    marginBottom: spacing.sm,
  },
  primaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 17,
    color: colors.white,
    letterSpacing: 0.2,
  },
});
