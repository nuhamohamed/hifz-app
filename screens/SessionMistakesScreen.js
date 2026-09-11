import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import MistakeCard from '../components/MistakeList';
import { getCurrentUserId } from '../lib/auth';
import { getAyah } from '../lib/quranApi';
import { clearReviewMistake, removeFromQuizQueue } from '../lib/quizEngine';
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
  // What was loaded, untouched, so a correction can be measured against it and
  // taken back before it is committed.
  //
  // Nothing on this page writes to the database any more. Corrections are held
  // here and go in together when Save is pressed, which is what lets the
  // summary behind this page be right when someone returns to it: it reads its
  // counts once, and a page that had already written four of them left it
  // quoting a number that was no longer true. Holding them also means a
  // mis-tap costs nothing, so the timed undo that used to cover that is gone.
  const originalRef = useRef([]);
  const [stagedClears, setStagedClears] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  // Set the moment a save succeeds, so leaving straight afterwards is not
  // mistaken for walking away from unsaved work.
  const savedRef = useRef(false);

  const editedCount = mistakes.filter((m) => {
    const before = originalRef.current.find(
      (o) => o.surah_number === m.surah_number && o.ayah_number === m.ayah_number
    );
    return before && (before.wrong_words ?? []).length !== (m.wrong_words ?? []).length;
  }).length;
  const changeCount = stagedClears.length + editedCount;

  // Corrections live on this page until they are saved, so leaving with them
  // unsaved throws them away. Someone who has just been down a list of eight
  // ayahs deciding which the app misheard should be asked first.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (changeCount === 0 || savedRef.current || isSaving) return;
      e.preventDefault();
      Alert.alert(
        'Leave without saving?',
        changeCount === 1
          ? 'One correction has not been saved yet.'
          : `${changeCount} corrections have not been saved yet.`,
        [
          { text: 'Keep editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => navigation.dispatch(e.data.action),
          },
        ]
      );
    });
    return unsubscribe;
  }, [changeCount, isSaving, navigation]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (!sessionId) {
          if (mounted) {
            originalRef.current = [];
            setMistakes([]);
          }
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

        if (mounted) {
          originalRef.current = enriched.map((m) => ({ ...m }));
          setMistakes(enriched);
        }
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

  const handleDismissMistake = useCallback((index, mistake) => {
    setActionError('');
    setMistakes((prev) => prev.filter((_, i) => i !== index));
    setStagedClears((prev) => [...prev, mistake]);
  }, []);

  /** Put every staged correction back, and the page as it was loaded. */
  const handleUndoAll = useCallback(() => {
    setActionError('');
    setStagedClears([]);
    setMistakes(originalRef.current.map((m) => ({ ...m })));
  }, []);

  /**
   * Clears one misheard word. A mistake is still one ayah however many words
   * are wrong in it, so clearing some words leaves the ayah counted. Only when
   * every flagged word is gone does the ayah stop being a mistake.
   */
  const handleClearWord = useCallback((index, mistake, word) => {
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

    // The last flagged word going means the ayah is no longer a mistake at all,
    // so it is staged for clearing like any other.
    if (remaining.length === 0) {
      setStagedClears((prev) => [...prev, mistake]);
    }
  }, []);

  /**
   * Commit every correction made on this page, then go back.
   *
   * Clearing an ayah is two writes, the row and the review schedule behind it,
   * and removeMistakeEntirely already keeps those two together or does
   * neither. What is added here is that a failure part-way through a list does
   * not lie about the rest: the ayahs that did save are dropped from the page
   * and from the staged list, so pressing Save again retries only what is
   * genuinely still outstanding.
   */
  const handleSave = useCallback(async () => {
    if (!sessionId || isSaving) return;
    setIsSaving(true);
    setActionError('');

    const failed = [];
    for (const mistake of stagedClears) {
      const ok = await removeMistakeEntirely(mistake);
      if (!ok) failed.push(mistake);
    }

    const edited = mistakes.filter((m) => {
      const before = originalRef.current.find(
        (o) => o.surah_number === m.surah_number && o.ayah_number === m.ayah_number
      );
      return before && (before.wrong_words ?? []).length !== (m.wrong_words ?? []).length;
    });

    for (const m of edited) {
      const { error: wordError } = await supabase
        .from('mistakes')
        .update({ wrong_words: m.wrong_words })
        .eq('session_id', sessionId)
        .eq('source', source)
        .eq('surah_number', m.surah_number)
        .eq('ayah_number', m.ayah_number)
        .is('dismissed_at', null);
      if (wordError) {
        reportHandledError('sessionMistakes.clearWord', new Error(wordError.message));
        failed.push(m);
      }
    }

    setIsSaving(false);

    if (failed.length > 0) {
      const stillStaged = stagedClears.filter((m) =>
        failed.some(
          (f) => f.surah_number === m.surah_number && f.ayah_number === m.ayah_number
        )
      );
      setStagedClears(stillStaged);
      setActionError(
        failed.length === 1
          ? 'One correction did not save. Check your connection and try again.'
          : `${failed.length} corrections did not save. Check your connection and try again.`
      );
      return;
    }

    savedRef.current = true;
    navigation.goBack();
  }, [
    isSaving,
    mistakes,
    navigation,
    removeMistakeEntirely,
    sessionId,
    source,
    stagedClears,
  ]);

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
          {changeCount > 0 ? (
            <View style={styles.stagedBar}>
              <Text style={styles.stagedText}>
                {changeCount === 1 ? '1 correction' : `${changeCount} corrections`} ready to save
              </Text>
              <TouchableOpacity
                onPress={handleUndoAll}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Undo every correction on this page"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.stagedAction}>Undo all</Text>
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

      {!isLoading && !error && changeCount > 0 ? (
        <View style={styles.saveBar}>
          <TouchableOpacity
            style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={isSaving}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={
              changeCount === 1
                ? 'Save one correction and go back to the summary'
                : `Save ${changeCount} corrections and go back to the summary`
            }
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveBtnText}>Save changes</Text>
            )}
          </TouchableOpacity>
          {/* Said plainly, because nothing on this page has taken effect yet
              and the next portion is decided from what is saved here. */}
          <Text style={styles.saveHint}>
            Your next portion is worked out from the mistakes left after saving.
          </Text>
        </View>
      ) : null}
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
  saveBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontFamily: fonts.semiBold, fontSize: 16, color: '#FFFFFF' },
  saveHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  stagedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.text,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  stagedText: { fontFamily: fonts.regular, fontSize: 14, color: '#FFFFFF', flex: 1 },
  stagedAction: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#FFFFFF',
    textDecorationLine: 'underline',
  },
});
