import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, spacing } from '../../lib/theme';

/**
 * A row that shows a value and goes nowhere. The value is `selectable`, so it
 * can be long-pressed and copied, which is the whole reason the one row using
 * it exists: a data request has to arrive with the account id pasted into it.
 *
 * Stacked rather than side by side because the value is a full uuid. Truncating
 * it would still copy in full, but somebody reading it back to check they sent
 * the right thing could not.
 */
export default function SettingsStaticRow({ label, value, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
    gap: 4,
  },
  rowLast: { borderBottomWidth: 0 },
  label: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  value: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted },
});
