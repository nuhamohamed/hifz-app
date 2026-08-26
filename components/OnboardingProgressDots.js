import { StyleSheet, View } from 'react-native';
import { colors } from '../lib/theme';

export default function OnboardingProgressDots({ current, total }) {
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

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 6, marginBottom: 24 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textMuted, opacity: 0.3 },
  dotActive: { backgroundColor: colors.primary, opacity: 1, width: 20 },
  dotPast: { backgroundColor: colors.primary, opacity: 0.4 },
});
