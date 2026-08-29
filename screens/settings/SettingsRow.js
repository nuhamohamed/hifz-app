import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fonts, spacing } from '../../lib/theme';

/**
 * One row of a grouped settings list: label on the left, current value and a
 * chevron on the right, the whole row tappable.
 *
 * `destructive` colours the label red for an action that cannot be undone. It
 * still pushes to a screen rather than acting on the tap, so nothing
 * irreversible is ever one press away.
 */
export default function SettingsRow({ label, value, onPress, destructive, last }) {
  return (
    <TouchableOpacity
      style={[styles.row, last && styles.rowLast]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <Text style={[styles.label, destructive && styles.labelDestructive]}>{label}</Text>
      <View style={styles.right}>
        {value ? <Text style={styles.value}>{value}</Text> : null}
        <Text style={[styles.chevron, destructive && styles.labelDestructive]}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  rowLast: { borderBottomWidth: 0 },
  label: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  labelDestructive: { color: colors.error },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { fontFamily: fonts.regular, fontSize: 16, color: colors.textMuted },
  chevron: { fontSize: 20, color: colors.textMuted, marginTop: -2 },
});
