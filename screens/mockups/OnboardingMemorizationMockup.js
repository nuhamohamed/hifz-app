import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, S } from './design';

const OPTIONS = [
  { id: 'none', label: 'Less than 1 juz', sub: 'Still building up' },
  { id: '1_5', label: '1–5 juz', sub: 'Juz 26–30 typically' },
  { id: '6_15', label: '6–15 juz', sub: 'Half the Quran' },
  { id: '16_29', label: '16–29 juz', sub: 'Almost complete' },
  { id: 'full', label: 'The entire Quran', sub: 'Masha\'Allah' },
];

function ProgressDots({ current, total }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.dot, i === current && styles.dotActive, i < current && styles.dotPast]} />
      ))}
    </View>
  );
}

function OptionCard({ option, selected, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.option, selected && styles.optionSelected]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.optionLeft}>
        <View style={[styles.radio, selected && styles.radioSelected]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
        <View>
          <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
            {option.label}
          </Text>
          <Text style={styles.optionSub}>{option.sub}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function OnboardingMemorizationMockup({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const [selected, setSelected] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <View style={styles.header}>
        <ProgressDots current={1} total={5} />
        <Text style={styles.step}>Step 2 of 5</Text>
        <Text style={styles.question}>What have you memorized, {name}?</Text>
        <Text style={styles.sub}>This helps us know where to draw your revision from.</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {OPTIONS.map((opt) => (
          <OptionCard
            key={opt.id}
            option={opt}
            selected={selected === opt.id}
            onPress={() => setSelected(opt.id)}
          />
        ))}

        <TouchableOpacity style={styles.specificLink} activeOpacity={0.7}>
          <Text style={styles.specificLinkText}>Select specific surahs instead →</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, !selected && styles.primaryBtnDisabled]}
          onPress={() => selected && navigation.navigate('MockupOnboardingTime', { name })}
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
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    paddingTop: 64,
    paddingHorizontal: S.lg,
    paddingBottom: S.md,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: S.lg,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.navyLight,
    opacity: 0.3,
  },
  dotActive: {
    backgroundColor: C.cobalt,
    opacity: 1,
    width: 20,
  },
  dotPast: {
    backgroundColor: C.cobalt,
    opacity: 0.4,
  },
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
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.md,
    gap: 10,
  },
  option: {
    backgroundColor: C.white,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: S.md,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
  },
  optionSelected: {
    borderColor: C.cobalt,
    backgroundColor: C.cobaltDim,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: C.navyLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: C.cobalt,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.cobalt,
  },
  optionLabel: {
    fontFamily: F.semiBold,
    fontSize: 16,
    color: C.navy,
    marginBottom: 2,
  },
  optionLabelSelected: {
    color: C.cobalt,
  },
  optionSub: {
    fontFamily: F.regular,
    fontSize: 13,
    color: C.navyMid,
  },
  specificLink: {
    paddingVertical: S.md,
    alignItems: 'center',
  },
  specificLinkText: {
    fontFamily: F.medium,
    fontSize: 14,
    color: C.cobalt,
  },
  footer: {
    paddingHorizontal: S.lg,
    paddingBottom: 48,
    paddingTop: S.sm,
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
