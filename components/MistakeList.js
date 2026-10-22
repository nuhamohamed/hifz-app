import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getSurahName } from '../lib/juzSurahMap';
import { normalizeArabic } from '../lib/arabicUtils';
import { colors, fonts, spacing } from '../lib/theme';

/**
 * One reviewable mistake, and the pieces that render it.
 *
 * Lifted out of SessionSummaryScreen when the summary stopped listing mistakes
 * itself. The summary now shows a count per source and sends you to a page for
 * that source, and both of those pages draw the same card, so the card cannot
 * go on living inside one of them.
 */
function buildWrongWordIndices(words, wrongWords) {
  const remaining = [...(wrongWords ?? [])];
  const indices = new Set();
  words.forEach((word, i) => {
    const display = word.textDisplay;
    const idx = remaining.indexOf(display);
    if (idx >= 0) {
      indices.add(i);
      remaining.splice(idx, 1);
    }
  });
  return indices;
}

function AyahTextWithHighlights({ words, wrongWords, isDisconnectedLetters }) {
  if (isDisconnectedLetters) {
    const text = words.map((w) => w.textCompare).join(' ');
    return <Text style={styles.compWord}>{text}</Text>;
  }

  const wrongIndices = buildWrongWordIndices(words, wrongWords);
  const displayWords = words.map((w) => w.textDisplay);

  return (
    <Text style={styles.compWord}>
      {displayWords.map((word, i) =>
        wrongIndices.has(i) ? (
          // Green says "this is the word it should have been". It is not the
          // control: what gets tapped is the red word opposite, because that is
          // the one being disputed.
          <Text key={i} style={styles.compCorrection}>
            {word}{' '}
          </Text>
        ) : (
          <Text key={i} style={styles.compNeutral}>
            {word}{' '}
          </Text>
        )
      )}
    </Text>
  );
}

/**
 * The transcript, with the words that are not in this ayah picked out.
 *
 * `transcribed_text` is stored as one string, so there is no index to line up
 * against `wrong_words` and no honest way to say which heard word stood in for
 * which expected one. What can be said is which words are not in the ayah at
 * all, and those are the ones worth colouring. The whole line used to be red,
 * which claimed the entire recitation was wrong when almost all of it was right.
 */
function TranscriptWithSlips({ text, words, onClearSlip }) {
  const spoken = (text ?? '').trim().split(/\s+/).filter(Boolean);
  if (spoken.length === 0) {
    return <Text style={[styles.compWord, styles.compNeutral]}>—</Text>;
  }
  const expected = new Set(
    words.map((w) => normalizeArabic(w.textCompare ?? w.textDisplay)).filter(Boolean)
  );
  let slipOrdinal = -1;
  return (
    <Text style={styles.compWord}>
      {spoken.map((word, i) => {
        const isSlip = !expected.has(normalizeArabic(word));
        if (!isSlip) {
          return (
            <Text key={i} style={styles.compNeutral}>
              {word}{' '}
            </Text>
          );
        }
        slipOrdinal += 1;
        const ordinal = slipOrdinal;
        // The red word is the claim being disputed, so the red word is what
        // clears it. The app cannot tell a real memory slip from the recogniser
        // mishearing a word; the person reading both columns can.
        return (
          <Text
            key={i}
            style={styles.compSlip}
            onPress={onClearSlip ? () => onClearSlip(ordinal) : undefined}
            suppressHighlighting={false}
          >
            {word}{' '}
          </Text>
        );
      })}
    </Text>
  );
}


function MistakeCard({ mistake, onDismiss, onClearWord, defaultOpen, note }) {
  const [open, setOpen] = useState(defaultOpen);
  const wrongCount = mistake.wrong_words?.length ?? 0;

  return (
    <View style={styles.mistakeCard}>
      <TouchableOpacity
        style={[styles.mistakeCardHeader, open && styles.mistakeCardHeaderOpen]}
        onPress={() => setOpen((wasOpen) => !wasOpen)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${getSurahName(mistake.surah_number)} ${mistake.ayah_number}, ${
          wrongCount === 1 ? '1 word' : `${wrongCount} words`
        }`}
      >
        <View style={styles.mistakeLabelCol}>
          <Text style={styles.mistakeAyahLabel}>
            {getSurahName(mistake.surah_number)} {mistake.ayah_number}
          </Text>
          {note ? <Text style={styles.mistakeNote}>{note}</Text> : null}
        </View>
        {/* Tiers are gone: every mistake counts the same. The count of flagged
            words is the useful detail now, since clearing them all is what
            removes the ayah. */}
        <View style={styles.mistakeCardHeaderEnd}>
          <View style={[styles.badge, styles.badgeConfirmed]}>
            <Text style={[styles.badgeText, styles.badgeTextConfirmed]}>
              {wrongCount === 1 ? '1 word' : `${wrongCount} words`}
            </Text>
          </View>
          <Text style={styles.cardChevron}>{open ? '\u25be' : '\u25b8'}</Text>
        </View>
      </TouchableOpacity>

      {open ? (
        <>
          <View style={styles.compRow}>
            <View style={styles.compCol}>
              <Text style={styles.compLabel}>What you said</Text>
              <TranscriptWithSlips
                text={mistake.transcribed_text}
                words={mistake.words}
                onClearSlip={(ordinal) => {
                  // Both lists run in recitation order, so the nth word heard
                  // that is not in the ayah answers to the nth word flagged.
                  // Where the counts disagree, the last flag is the safe one to
                  // clear: it never clears a flag the tap was not aimed at.
                  const flagged = mistake.wrong_words ?? [];
                  if (flagged.length === 0) return;
                  onClearWord(flagged[Math.min(ordinal, flagged.length - 1)]);
                }}
              />
            </View>
            <View style={styles.compDivider} />
            <View style={styles.compCol}>
              <Text style={styles.compLabel}>Expected</Text>
              <AyahTextWithHighlights
                words={mistake.words}
                wrongWords={mistake.wrong_words}
                isDisconnectedLetters={mistake.isDisconnectedLetters}
              />
            </View>
          </View>

          {/* Red is only on the word actually said wrong, green on the word it
              should have been. Red is the disputed claim, so red is the one
              that clears. */}
          <Text style={styles.tapHint}>Tap a red word if the app misheard you.</Text>

          <TouchableOpacity style={styles.notMistakeBtn} onPress={onDismiss} activeOpacity={0.7}>
            <Text style={styles.notMistakeBtnText}>Not a mistake at all</Text>
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );
}

export default MistakeCard;
export { AyahTextWithHighlights, TranscriptWithSlips };

const styles = StyleSheet.create({
  mistakeLabelCol: { flexShrink: 1 },
  mistakeNote: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  badge: { borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 },
  badgeConfirmed: { backgroundColor: colors.errorLight },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 12 },
  badgeTextConfirmed: { color: colors.error },
  cardChevron: { fontSize: 14, color: colors.textMuted },
  compCol: { flex: 1 },
  compCorrection: { color: colors.success },
  compDivider: { width: 1, backgroundColor: colors.border, alignSelf: 'stretch' },
  compLabel: {
    fontFamily: fonts.regular, fontSize: 11, color: colors.textMuted,
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  compNeutral: { color: colors.text },
  compRow: { flexDirection: 'row', marginBottom: spacing.sm, gap: spacing.sm },
  compSlip: { color: colors.error },
  compWord: { fontFamily: 'UthmanicHafs', fontSize: 18, writingDirection: 'rtl', lineHeight: 30 },
  mistakeAyahLabel: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text },
  mistakeCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mistakeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mistakeCardHeaderEnd: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mistakeCardHeaderOpen: { marginBottom: spacing.sm },
  notMistakeBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  notMistakeBtnText: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMid },
  tapHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
