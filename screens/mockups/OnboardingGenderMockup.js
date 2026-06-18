import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, S } from './design';

function ProgressDots({ current, total }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === current && styles.dotActive,
            i < current && styles.dotPast,
          ]}
        />
      ))}
    </View>
  );
}

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
      }
    </TouchableOpacity>
  );
}

export default function OnboardingGenderMockup({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const [selected, setSelected] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <View style={styles.header}>
        <ProgressDots current={3} total={5} />
        <Text style={styles.step}>Step 4 of 5</Text>
        <Text style={styles.question}>Are you male or female?</Text>
        <Text style={styles.sub}>
          We use this to support your revision during periods — keeping your streak intact with non-recitation review.
        </Text>
      </View>

      <View style={styles.cards}>
        <GenderCard
          label="Male"
          icon="♂"
          selected={selected === 'male'}
          onPress={() => setSelected('male')}
        />
        <GenderCard
          label="Female"
          icon="♀"
          desc="Includes period mode — maintain your streak with flashcard review."
          selected={selected === 'female'}
          onPress={() => setSelected('female')}
        />
      </View>

      {selected === 'female' ? (
        <View style={styles.note}>
          <Text style={styles.noteIcon}>✦</Text>
          <Text style={styles.noteText}>
            During your period, Dawrah switches to silent review mode — no recitation required, streak stays intact.
          </Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, !selected && styles.primaryBtnDisabled]}
          onPress={() => selected && navigation.navigate('MockupOnboardingNotifications', { name })}
          activeOpacity={0.88}
          disabled={!selected}
        >
          <Text style={styles.primaryBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: {
    paddingTop: 64,
    paddingHorizontal: S.lg,
    paddingBottom: S.md,
  },
  dots: { flexDirection: 'row', gap: 6, marginBottom: S.lg },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.navyLight, opacity: 0.3 },
  dotActive: { backgroundColor: C.cobalt, opacity: 1, width: 20 },
  dotPast: { backgroundColor: C.cobalt, opacity: 0.4 },
  step: {
    fontFamily: F.medium,
    fontSize: 13,
    color: C.navyLight,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: S.sm,
  },
  question: {
    fontFamily: F.semiBold,
    fontSize: 26,
    color: C.navy,
    letterSpacing: -0.3,
    marginBottom: S.sm,
    lineHeight: 34,
  },
  sub: {
    fontFamily: F.regular,
    fontSize: 14,
    color: C.navyMid,
    lineHeight: 21,
  },
  cards: {
    flexDirection: 'row',
    paddingHorizontal: S.lg,
    gap: 12,
    marginTop: S.md,
  },
  card: {
    flex: 1,
    backgroundColor: C.white,
    borderRadius: 16,
    padding: S.md,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
    alignItems: 'flex-start',
    minHeight: 130,
  },
  cardSelected: {
    borderColor: C.cobalt,
    backgroundColor: C.cobaltDim,
  },
  cardIcon: {
    fontSize: 24,
    marginBottom: S.sm,
    color: C.cobalt,
  },
  cardLabel: {
    fontFamily: F.semiBold,
    fontSize: 18,
    color: C.navy,
    marginBottom: S.xs,
  },
  cardLabelSelected: { color: C.cobalt },
  cardDesc: {
    fontFamily: F.regular,
    fontSize: 12,
    color: C.navyMid,
    lineHeight: 17,
    marginTop: 4,
  },
  note: {
    flexDirection: 'row',
    marginHorizontal: S.lg,
    marginTop: S.md,
    backgroundColor: C.goldLight,
    borderRadius: 12,
    padding: S.md,
    gap: 10,
    alignItems: 'flex-start',
  },
  noteIcon: {
    fontSize: 14,
    color: C.gold,
    marginTop: 2,
  },
  noteText: {
    flex: 1,
    fontFamily: F.regular,
    fontSize: 13,
    color: C.navy,
    lineHeight: 19,
  },
  footer: {
    marginTop: 'auto',
    paddingHorizontal: S.lg,
    paddingBottom: 48,
    paddingTop: S.md,
  },
  primaryBtn: {
    backgroundColor: C.cobalt,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: {
    fontFamily: F.semiBold,
    fontSize: 17,
    color: C.white,
  },
});
