import { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getCurrentUserId, resetAccountData } from '../../lib/auth';
import { useOnboarding } from '../../lib/OnboardingContext';
import { colors, fonts, radius, spacing } from '../../lib/theme';

/**
 * The one irreversible action in the app, on a screen of its own.
 *
 * Named for what it does. It was going to be called "Reset settings", which
 * reads as though it only touches preferences, and someone could tap it
 * expecting their memorised juz and months of progress to survive. The wording
 * is the only thing standing between a tester and losing everything, so it says
 * "Erase all my data" and the screen lists exactly what goes.
 *
 * Three gates before anything happens: reaching this screen, pressing the red
 * button, and confirming the alert. There is no sign-in, so nothing here can be
 * recovered afterwards.
 */
export default function EraseDataScreen({ navigation }) {
  const { restartOnboarding } = useOnboarding();
  const [isErasing, setIsErasing] = useState(false);
  const [error, setError] = useState('');

  const confirm = () => {
    Alert.alert(
      'Erase all your data?',
      'Every session, mistake, review and memorized juz is deleted, and you go back through setup. This cannot be undone and there is no way to recover it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase everything',
          style: 'destructive',
          onPress: async () => {
            setIsErasing(true);
            setError('');
            try {
              const userId = await getCurrentUserId();
              await resetAccountData(userId);
              restartOnboarding();
            } catch (err) {
              setError(err.message ?? 'Could not erase your data.');
              setIsErasing(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.back}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Erase all my data</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.warnCard}>
          <Text style={styles.warnTitle}>This cannot be undone.</Text>
          <Text style={styles.warnText}>
            Dawrah keeps your progress on this phone's account only. There is no
            sign-in yet, so nothing erased here can be brought back.
          </Text>
        </View>

        <Text style={styles.listLabel}>What goes</Text>
        {[
          'Every session you have recited',
          'Every mistake and the words in it',
          'Your schedule and juz progress',
          'The juz you told us you had memorized',
        ].map((item) => (
          <Text key={item} style={styles.listItem}>
            •  {item}
          </Text>
        ))}

        <Text style={styles.note}>
          You are taken back through setup afterwards and start fresh, as though
          you had just installed Dawrah.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.eraseBtn}
          onPress={confirm}
          activeOpacity={0.88}
          disabled={isErasing}
        >
          <Text style={styles.eraseBtnText}>
            {isErasing ? 'Erasing…' : 'Erase all my data'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelBtnText}>Keep my data</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: 64, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  back: { fontFamily: fonts.medium, fontSize: 16, color: colors.primary, marginBottom: spacing.sm },
  title: { fontFamily: fonts.semiBold, fontSize: 28, color: colors.error, letterSpacing: -0.4 },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  warnCard: {
    backgroundColor: colors.errorLight, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  warnTitle: {
    fontFamily: fonts.semiBold, fontSize: 16, color: colors.error, marginBottom: 6,
  },
  warnText: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMid, lineHeight: 21 },
  listLabel: {
    fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm,
  },
  listItem: {
    fontFamily: fonts.regular, fontSize: 15, color: colors.text,
    lineHeight: 26,
  },
  note: {
    fontFamily: fonts.regular, fontSize: 14, color: colors.textMid,
    lineHeight: 21, marginTop: spacing.lg,
  },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.error, marginTop: spacing.md },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: 40, gap: 4 },
  eraseBtn: {
    backgroundColor: colors.error, borderRadius: radius.md,
    paddingVertical: 17, alignItems: 'center',
  },
  eraseBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontFamily: fonts.medium, fontSize: 15, color: colors.textMid },
});
