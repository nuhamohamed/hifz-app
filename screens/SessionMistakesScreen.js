import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import MistakeCard from '../components/MistakeList';
import { getCurrentUserId } from '../lib/auth';
import { getSurahName } from '../lib/juzSurahMap';
import { getAyah } from '../lib/quranApi';
import {
  clearReviewMistake,
  removeFromQuizQueue,
  restoreRecitationMistake,
  restoreReviewMistake,
} from '../lib/quizEngine';
import { reportHandledError } from '../lib/sentry';
import { supabase } from '../lib/supabase';
import { colors, fonts, spacing } from '../lib/theme';

/**
 * The mistakes from one part of a session, and the place they are corrected.
 *
 * This used to be a disclosure row on the summary itself, listing recitation
 * mistakes only. Mistake Review mistakes had nowhere to appear at all, so a
 * word misheard during the review could not be disputed the way the same word
 * misheard during the portion could. The summary now counts each source and
 * sends you here for one of them.
 */

/** How long the way back stays on offer after a mistake is cleared. */
const UNDO_WINDOW_MS = 7000;

const SOURCE_COPY = {
  recitation: {
    title: 'Recitation',
    empty: 'Nothing was flagged during the portion.',
  },
  review: {
    title: 'Mistake Review',
    empty: 'Nothing was flagged during the review.',
  },
};

export default function SessionMistakesScreen({ route }) {
  const navigation = useNavigation();
  const sessionId = route?.params?.sessionId;
  const source = route?.params?.source === 'review' ? 'review' : 'recitation';
  const copy = SOURCE_COPY[source];

  const [mistakes, setMistakes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  // A write that did not land. The list updates before the write returns, so
  // without this a failed correction looked exactly like a successful one and
  // only came back, unexplained, the next time the page was opened.
  const [actionError, setActionError] = useState('');
  // The mistake just cleared, and where it sat, kept for as long as the undo is
  // on offer. Clearing is one tap with nothing to confirm, and it does the exact
  // opposite of what this page is for: a mis-tap tells the app someone knows an
  // ayah they do not, and pulls it out of their revision. An undo costs the
  // careful taps nothing, which a confirmation step would not.
  const [pendingUndo, setPendingUndo] = useState(null);
  const undoTimerRef = useRef(null);

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  const offerUndo = useCallback((mistake, index) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setPendingUndo({ mistake, index });
    undoTimerRef.current = setTimeout(() => setPendingUndo(null), UNDO_WINDOW_MS);
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (!sessionId) {
          if (mounted) setMistakes([]);
          return;
        }

        const { data, error: fetchError } = await supabase
          .from('mistakes')
          .select(
            'surah_number, ayah_number, wrong_words, transcribed_text, source, review_prev_box_level'
          )
          .eq('session_id', sessionId)
          .eq('source', source)
          .is('dismissed_at', null)
          .order('ayah_number', { ascending: true });

        if (fetchError) throw new Error(fetchError.message);

        const enriched = await Promise.all(
          (data ?? []).map(async (m) => {
            const ayah = await getAyah(m.surah_number, m.ayah_number);
            return { ...m, words: ayah.words, isDisconnectedLetters: ayah.isDisconnectedLetters };
          })
        );

        if (mounted) setMistakes(enriched);
      } catch (err) {
        reportHandledError('sessionMistakes.load', err);
        if (mounted) setError(err.message ?? 'Could not load these mistakes.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [sessionId, source]);

  /**
   * Clears a mistake as a misflag, and undoes what it cost.
   *
   * Marked rather than deleted, for the reason the column was added: the row is
   * the only evidence the recogniser flagged something the person disagreed
   * with, which together make up the app's own false-positive rate.
   *
   * What follows differs by where the mistake came from. A recitation mistake
   * put the ayah into the review queue, so clearing it takes the ayah back out.
   * A review mistake found the ayah already there and knocked it down to box 0,
   * so clearing it advances the box instead: an ayah only reaches 'wrong' after
   * failing three times over, and someone disputing that is saying they had it
   * right all along. Removing it from the queue would drop a review that was
   * legitimately scheduled, and merely putting the box back would still cost
   * them the promotion the correct answer earned.
   */
  const removeMistakeEntirely = useCallback(
    async (mistake) => {
      if (!sessionId) return false;

      const { error: updateError } = await supabase
        .from('mistakes')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('session_id', sessionId)
        .eq('source', source)
        .eq('surah_number', mistake.surah_number)
        .eq('ayah_number', mistake.ayah_number)
        .is('dismissed_at', null);

      if (updateError) {
        reportHandledError('sessionMistakes.dismiss', new Error(updateError.message));
        return false;
      }

      try {
        const userId = await getCurrentUserId();

        if (source === 'recitation') {
          await removeFromQuizQueue(userId, mistake.surah_number, mistake.ayah_number);
        } else {
          await clearReviewMistake(
            userId,
            mistake.surah_number,
            mistake.ayah_number,
            // Null on rows written before the prior level was recorded, which
            // clearReviewMistake handles by promoting from wherever it sits now.
            mistake.review_prev_box_level ?? null
          );
        }
        return true;
      } catch (err) {
        // Clearing a mistake is two writes: the row, then the review schedule it
        // moved. Half of that is worse than none — the mistake would be gone
        // from the page while the ayah stayed demoted, with no way left to see
        // it, let alone put it right. So the dismissal is taken back and the
        // whole thing reported as not done.
        reportHandledError('sessionMistakes.clearQueue', err);
        const { error: revertError } = await supabase
          .from('mistakes')
          .update({ dismissed_at: null })
          .eq('session_id', sessionId)
          .eq('source', source)
          .eq('surah_number', mistake.surah_number)
          .eq('ayah_number', mistake.ayah_number);
        if (revertError) {
          reportHandledError('sessionMistakes.revertDismiss', new Error(revertError.message));
        }
        return false;
      }
    },
    [sessionId, source]
  );

  const handleDismissMistake = useCallback(
    async (index, mistake) => {
      setActionError('');
      setMistakes((prev) => prev.filter((_, i) => i !== index));

      const ok = await removeMistakeEntirely(mistake);
      if (ok) {
        offerUndo(mistake, index);
        return;
      }
      setMistakes((prev) => {
        const next = [...prev];
        next.splice(index, 0, mistake);
        return next;
      });
      setActionError('That did not save. Check your connection and try again.');
    },
    [offerUndo, removeMistakeEntirely]
  );

  /**
   * Puts a cleared mistake back, along with everything clearing it moved.
   */
  const handleUndo = useCallback(async () => {
    if (!pendingUndo || !sessionId) return;
    const { mistake, index } = pendingUndo;

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setPendingUndo(null);
    setActionError('');

    const { error: reviveError } = await supabase
      .from('mistakes')
      .update({ dismissed_at: null })
      .eq('session_id', sessionId)
      .eq('source', source)
      .eq('surah_number', mistake.surah_number)
      .eq('ayah_number', mistake.ayah_number);

    if (reviveError) {
      reportHandledError('sessionMistakes.undo', new Error(reviveError.message));
      setActionError('Could not undo that. Check your connection and try again.');
      return;
    }

    try {
      const userId = await getCurrentUserId();
      if (source === 'recitation') {
        await restoreRecitationMistake(userId, mistake.surah_number, mistake.ayah_number);
      } else {
        await restoreReviewMistake(
          userId,
          mistake.surah_number,
          mistake.ayah_number,
          mistake.review_prev_box_level ?? null,
          mistake.review_prev_next_date ?? null
        );
      }
    } catch (err) {
      // The mistake is back, which is the part the person asked for and can see.
      // The schedule behind it is not, and saying so is better than a silent
      // half-undo they have no way to notice.
      reportHandledError('sessionMistakes.undoQueue', err);
      setActionError('Mistake restored, but its review date may be off.');
    }

    setMistakes((prev) => {
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, mistake);
      return next;
    });
  }, [pendingUndo, sessionId, source]);

  /**
   * Clears one misheard word. A mistake is still one ayah however many words
   * are wrong in it, so clearing some words leaves the ayah counted. Only when
   * every flagged word is gone does the ayah stop being a mistake.
   */
  const handleClearWord = useCallback(
    async (index, mistake, word) => {
      const remaining = [...(mistake.wrong_words ?? [])];
      const at = remaining.indexOf(word);
      if (at < 0) return;
      remaining.splice(at, 1);

      setActionError('');
      setMistakes((prev) =>
        remaining.length === 0
          ? prev.filter((_, i) => i !== index)
          : prev.map((m, i) => (i === index ? { ...m, wrong_words: remaining } : m))
      );

      // The last flagged word going means the ayah is no longer a mistake at
      // all, so it takes the same path as clearing the whole thing, rollback
      // included.
      if (remaining.length === 0) {
        const ok = await removeMistakeEntirely(mistake);
        if (ok) {
          offerUndo(mistake, index);
          return;
        }
        setMistakes((prev) => {
          const next = [...prev];
          next.splice(index, 0, mistake);
          return next;
        });
        setActionError('That did not save. Check your connection and try again.');
        return;
      }

      if (!sessionId) return;
      const { error: wordError } = await supabase
        .from('mistakes')
        .update({ wrong_words: remaining })
        .eq('session_id', sessionId)
        .eq('source', source)
        .eq('surah_number', mistake.surah_number)
        .eq('ayah_number', mistake.ayah_number)
        .is('dismissed_at', null);

      if (wordError) {
        reportHandledError('sessionMistakes.clearWord', new Error(wordError.message));
        // Put the word back rather than leave the page showing a correction the
        // database never took.
        setMistakes((prev) =>
          prev.map((m, i) => (i === index ? { ...m, wrong_words: mistake.wrong_words } : m))
        );
        setActionError('That did not save. Check your connection and try again.');
      }
    },
    [offerUndo, removeMistakeEntirely, sessionId, source]
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back to the session summary"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.back}>{'‹'} Summary</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>
          {mistakes.length === 0
            ? 'Nothing to review'
            : `${mistakes.length} ${mistakes.length === 1 ? 'ayah' : 'ayahs'} flagged`}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : mistakes.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.empty}>{copy.empty}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {pendingUndo ? (
            <View style={styles.undoBar}>
              <Text style={styles.undoText}>
                Cleared {getSurahName(pendingUndo.mistake.surah_number)}{' '}
                {pendingUndo.mistake.ayah_number}
              </Text>
              <TouchableOpacity
                onPress={handleUndo}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Undo clearing ${getSurahName(
                  pendingUndo.mistake.surah_number
                )} ${pendingUndo.mistake.ayah_number}`}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.undoAction}>Undo</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {actionError ? (
            <TouchableOpacity
              style={styles.actionError}
              onPress={() => setActionError('')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${actionError} Tap to dismiss.`}
            >
              <Text style={styles.actionErrorText}>{actionError}</Text>
            </TouchableOpacity>
          ) : null}
          {mistakes.map((mistake, index) => (
            <MistakeCard
              key={`${mistake.surah_number}-${mistake.ayah_number}-${index}`}
              mistake={mistake}
              defaultOpen={index === 0}
              onDismiss={() => handleDismissMistake(index, mistake)}
              onClearWord={(word) => handleClearWord(index, mistake, word)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  back: { fontFamily: fonts.regular, fontSize: 15, color: colors.primary, marginBottom: spacing.md },
  title: { fontFamily: fonts.semiBold, fontSize: 26, color: colors.text },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, marginTop: 4 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl * 2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  empty: { fontFamily: fonts.regular, fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  error: { fontFamily: fonts.regular, fontSize: 15, color: colors.error, textAlign: 'center' },
  actionError: {
    backgroundColor: colors.errorLight,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  actionErrorText: { fontFamily: fonts.medium, fontSize: 14, color: colors.error },
  undoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.text,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  undoText: { fontFamily: fonts.regular, fontSize: 14, color: '#FFFFFF', flex: 1 },
  undoAction: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#FFFFFF',
    textDecorationLine: 'underline',
  },
});
