import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { colors, fonts, radius, spacing } from '../lib/theme';

/**
 * What changed in a build, shown once, the first time someone opens it.
 *
 * Keyed by build number, so each build's notes are written here alongside the
 * bump. A build with no entry shows nothing. Short, and written for testers:
 * what they will notice, not what was done to the code.
 */
// Build 12 repeats build 11's notes, so they are shown again to everyone
// who updates, including anyone who already saw them on 11.
const BUILD_11_NOTES = [
  {
    title: 'Less Delay',
    body: 'App should load faster, and transcription should also be a bit quicker',
  },
  {
    title: 'Going back is fine.',
    body: 'Re-reciting earlier words of an ayah, or repeating a word, will not count as a mistake.',
  },
  {
    title: 'New error beep sound'
  },
  {
    title: 'No more quiz after your session.',
    body: 'Your mistakes come back in the next day’s review instead.',
  },
];

const NOTES_BY_BUILD = {
  11: BUILD_11_NOTES,
  12: BUILD_11_NOTES,
};

const SEEN_KEY = 'whatsNew.seenBuild';

function currentBuild() {
  return Number(Constants.expoConfig?.ios?.buildNumber ?? 0);
}

// Set synchronously by markWhatsNewSeen, so a check already in flight cannot
// show the notes to someone who has just finished onboarding.
let seenThisRun = false;

/**
 * Someone who has just finished onboarding has nothing to compare against, so
 * the notes for this build count as seen. Called from completeOnboarding.
 */
export function markWhatsNewSeen() {
  seenThisRun = true;
  AsyncStorage.setItem(SEEN_KEY, String(currentBuild())).catch(() => {});
}

export default function WhatsNewModal() {
  const [visible, setVisible] = useState(false);
  const build = currentBuild();
  const notes = NOTES_BY_BUILD[build];

  useEffect(() => {
    if (!notes) return undefined;
    let mounted = true;
    AsyncStorage.getItem(SEEN_KEY)
      .then((seen) => {
        if (mounted && !seenThisRun && Number(seen ?? 0) < build) setVisible(true);
      })
      // Storage unreadable: say nothing rather than risk showing it every time.
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [build, notes]);

  if (!notes) return null;

  const dismiss = () => {
    setVisible(false);
    markWhatsNewSeen();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>What&apos;s new</Text>
          {notes.map((note) => (
            <View key={note.title} style={styles.item}>
              <Text style={styles.bullet}>{'•'}</Text>
              <Text style={styles.itemText}>
                <Text style={styles.itemTitle}>{note.title}</Text> {note.body}
              </Text>
            </View>
          ))}
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={dismiss}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 21, 44, 0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  title: {
    fontFamily: fonts.semiBold,
    fontSize: 22,
    color: colors.text,
    marginBottom: spacing.md,
  },
  item: {
    flexDirection: 'row',
    marginBottom: spacing.sm + 4,
  },
  bullet: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.primary,
    marginRight: spacing.sm,
    lineHeight: 23,
  },
  itemText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 23,
    color: colors.textMid,
  },
  itemTitle: {
    fontFamily: fonts.semiBold,
    color: colors.text,
  },
  button: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: colors.white,
  },
});
