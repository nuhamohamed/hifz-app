import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { CommonActions, useNavigation } from '@react-navigation/native';
import TabBar from '../components/TabBar';
import { getCurrentUserId } from '../lib/auth';
import {
  addDays,
  formatDayLabel as formatSessionDate,
  todayString as getTodayDateString,
  tomorrowString as getTomorrowDateString,
} from '../lib/dates';
import { normalizeArabic } from '../lib/arabicUtils';
import { getAyahLocation, getJuzTotalAyahs, getSurahName } from '../lib/juzSurahMap';
import { cancelEveningNudge } from '../lib/notifications';
import { getAyah } from '../lib/quranApi';
import { getPortionsForDate, previewNextInterval } from '../lib/planEngine';
import { removeFromQuizQueue } from '../lib/quizEngine';
import { supabase } from '../lib/supabase';
import { colors, fonts, spacing } from '../lib/theme';

/**
 * What to call the session on screen.
 *
 * This tab keeps showing the last completed session until a new one is
 * finished, so the day after a session it is showing yesterday's work. "Session
 * 28 Aug" is accurate and tells you nothing; a day close enough to have a name
 * gets its name.
 */
function sessionHeading(dateStr) {
  if (!dateStr) return 'Session';
  const today = getTodayDateString();
  if (dateStr === today) return "Today's session";
  if (dateStr === addDays(today, -1)) return "Yesterday's session";
  return `Session · ${formatSessionDate(dateStr)}`;
}

/**
 * What to call the portion in the up-next card.
 *
 * It was hardcoded to TOMORROW, but the query behind it takes the earliest
 * pending portion due up to and including tomorrow. Viewing yesterday's summary
 * today, or having a backlog, therefore labelled work that is due now as
 * tomorrow's.
 */
function upNextLabel(scheduledDate) {
  if (!scheduledDate) return 'TOMORROW';
  const today = getTodayDateString();
  if (scheduledDate <= today) return 'TODAY';
  if (scheduledDate === getTomorrowDateString()) return 'TOMORROW';
  return formatSessionDate(scheduledDate).toUpperCase();
}

function formatPortionLine(portion) {
  const start = getAyahLocation(portion.juzNumber, portion.portionStartAyah);
  const end = getAyahLocation(portion.juzNumber, portion.portionEndAyah);
  if (start.surahNumber === end.surahNumber) {
    return `${start.surahName} · ${start.ayahNumber}–${end.ayahNumber}`;
  }
  return `${start.surahName} ${start.ayahNumber} to ${end.surahName} ${end.ayahNumber}`;
}

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

function StatPill({ value, label, color }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * One mistake, openable on its own.
 *
 * A day with several mistakes was several full comparisons stacked up, and the
 * list scrolled past the one being looked for. Closed, a card is its ayah and
 * its word count, which is enough to find the right one; open, it is the whole
 * comparison. The first opens by default so the common case, a single mistake,
 * does not cost a second tap.
 */
function MistakeCard({ mistake, onDismiss, onClearWord, defaultOpen }) {
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
        <Text style={styles.mistakeAyahLabel}>
          {getSurahName(mistake.surah_number)} {mistake.ayah_number}
        </Text>
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

export default function SessionSummaryScreen({ route }) {
  const navigation = useNavigation();
  // Tomorrow's portion is sized from the real mushaf, so scheduling it needs
  // the bundled page data. Provided by SQLiteProvider in App.js.
  const db = useSQLiteContext();
  const sessionId = route?.params?.sessionId;
  const totalAyahsInJuzParam = route?.params?.totalAyahsInJuz;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [mistakes, setMistakes] = useState([]);
  const [tomorrowText, setTomorrowText] = useState(null);
  const [nextLabel, setNextLabel] = useState('TOMORROW');
  const [juzComplete, setJuzComplete] = useState(false);
  // Collapsed to begin with. Opening the tab to check on a day should not lead
  // with a wall of red; the count is the summary and the detail is a choice.
  const [mistakesOpen, setMistakesOpen] = useState(false);
  const [returnsInDays, setReturnsInDays] = useState(null);
  // Null when opened from the tab, which is the entry point with no route
  // params. Resolved below to the most recent session.
  const [resolvedSessionId, setResolvedSessionId] = useState(sessionId ?? null);
  const opacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.5)).current;

  // Opened from the tab rather than at the end of a session, so there is no id
  // in the route. Fall back to the most recent one: this screen is now the only
  // place mistakes can be corrected, and that window must not be a single
  // screen someone can swipe past.
  useEffect(() => {
    if (sessionId) return;
    let mounted = true;
    (async () => {
      try {
        const userId = await getCurrentUserId();
        // Completed only. This took the most recent session of any status, so
        // a paused one counted: a session someone had started and walked away
        // from was presented as a finished one, and because a paused portion
        // can run to the end of its juz it drew "Juz 1 Complete!" for work
        // nobody had done.
        const { data } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'complete')
          .order('date', { ascending: false })
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (mounted) {
          setResolvedSessionId(data?.id ?? null);
          if (!data?.id) setIsLoading(false);
        }
      } catch {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [sessionId]);

  // The screen fades in once loading ends, whatever the outcome. This used to
  // live inside the session-loading effect, which returns early when there is
  // no session to load, so the "nothing to review yet" state was rendered at
  // opacity zero: a blank grey screen. It was unreachable until the fallback
  // stopped accepting paused sessions, and then it was the first thing a new
  // person saw.
  useEffect(() => {
    if (isLoading) return;
    Animated.timing(opacity, {
      toValue: 1, duration: 600, useNativeDriver: true,
    }).start();
  }, [isLoading, opacity]);

  useEffect(() => {
    if (!resolvedSessionId) return;

    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);
        setError('');

        const { data: sessionData, error: sessionError } = await supabase
          .from('sessions')
          .select(
            'id, date, portion_start_ayah, portion_end_ayah, juz_number, completed_at, status, plan_applied, type'
          )
          .eq('id', resolvedSessionId)
          .single();

        if (sessionError) {
          throw new Error(sessionError.message);
        }

        const userId = await getCurrentUserId();

        // A quiz-only day has no portion, so the offsets on its row are filler
        // and nothing may be concluded from them. Read the type first.
        const isQuizOnly = sessionData.type === 'quiz_only';

        const totalAyahsInJuz =
          totalAyahsInJuzParam ?? getJuzTotalAyahs(sessionData.juz_number);
        const isJuzComplete =
          !isQuizOnly && sessionData.portion_end_ayah >= totalAyahsInJuz;

        // plan_applied is persisted, not held in state. A React ref resets on
        // every mount, so reopening this screen for the same session used to
        // double-count its mistakes, multiply the review interval twice, and
        // write a second scheduled row. Harmless when the screen was only ever
        // reached once at the end of a session; not harmless now it is a tab.
        // The guard matters here and not only in the flow: this screen is also
        // a tab, and opening it resolves to the most recent session whatever
        // that session was. Without it, visiting the tab after a quiz-only day
        // would advance the recitation plan off a portion nobody recited.
        // Scoring deliberately does NOT happen here any more.
        //
        // It used to run on mount, which put it before the one thing this
        // screen exists for. Someone misheard five times had the session judged
        // as five mistakes, the portion halved and the juz pulled forward, and
        // was only then shown the list and invited to say the app had misheard
        // them. Clearing all five removed the mistakes and left every
        // consequence of them standing.
        //
        // applyPendingSessionPlans() on the Today screen does it instead, on
        // the way back, by which point the corrections are in the table.
        // plan_applied still guards it, so a session is scored exactly once.

        // The pass/fail gate is gone. Finishing a juz is finishing a juz; what
        // is worth telling someone is when it comes back, which the spaced
        // repetition schedule has just worked out.
        let returnsIn = null;
        if (isJuzComplete && !isQuizOnly) {
          // Computed rather than read. juz_progress still holds the previous
          // pass's interval until scoring runs, so reading it would tell
          // someone the wrong day. Same function the real scoring uses.
          try {
            returnsIn = await previewNextInterval(
              db,
              userId,
              resolvedSessionId,
              sessionData.juz_number
            );
          } catch {
            returnsIn = null;
          }
        }

        // Asked of the same engine the agenda asks, rather than queried out of
        // scheduled_portions here. The old query disagreed with the agenda in
        // three ways: `.limit(1)` announced a two-juz day as one juz, it read
        // the stored range while the agenda re-sizes every row to fit the day,
        // and it costed nothing for the review while the agenda pays for the
        // quiz first and gives the portion what is left. Two screens quietly
        // disagreeing about the same day is worse than either being wrong,
        // because nothing looks broken.
        //
        // This session is passed in because it has finished but is not yet
        // scored, scoring having been moved after the corrections below. Its
        // rows are still pending, so without this the preview would offer back
        // the portion just recited.
        let nextTomorrowText = null;
        try {
          const tomorrowPortions = await getPortionsForDate(
            db,
            userId,
            getTomorrowDateString(),
            isQuizOnly
              ? null
              : {
                  juzNumber: sessionData.juz_number,
                  portionStartAyah: sessionData.portion_start_ayah,
                  portionEndAyah: sessionData.portion_end_ayah,
                }
          );

          nextTomorrowText = tomorrowPortions.length
            ? tomorrowPortions.map(formatPortionLine).join('\n')
            : 'Quiz only';
        } catch {
          nextTomorrowText = 'Quiz only';
        }

        const { data: mistakesData, error: mistakesError } = await supabase
          .from('mistakes')
          .select('ayah_number, surah_number, wrong_words, transcribed_text')
          .eq('session_id', resolvedSessionId)
          .is('dismissed_at', null)
          .order('ayah_number', { ascending: true });

        if (mistakesError) {
          throw new Error(mistakesError.message);
        }

        const enrichedMistakes = await Promise.all(
          (mistakesData ?? []).map(async (m) => {
            const ayah = await getAyah(m.surah_number, m.ayah_number);
            return {
              ...m,
              words: ayah.words,
              isDisconnectedLetters: ayah.isDisconnectedLetters,
            };
          })
        );

        if (!mounted) {
          return;
        }

        setSession(sessionData);
        setMistakes(enrichedMistakes);
        setTomorrowText(nextTomorrowText);
        setNextLabel(upNextLabel(tomorrow?.scheduled_date));
        setJuzComplete(isJuzComplete);
        setReturnsInDays(returnsIn);
      } catch (err) {
        if (mounted) {
          setError(err.message ?? 'Failed to load session summary.');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
          Animated.spring(checkScale, {
            toValue: 1, friction: 6, tension: 50, useNativeDriver: true,
          }).start();
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [resolvedSessionId, totalAyahsInJuzParam]);

  // Tiers are dropped, so there is one count, not two.
  const mistakeCount = mistakes.length;

  /**
   * Stops an ayah being a mistake at all: removes the record that feeds the juz
   * count AND the review queue entry.
   *
   * The old version deleted only the mistake row, so a misflagged ayah kept
   * being quizzed every morning after the person had said it was fine. It also
   * matched on ayah number with no surah filter, so dismissing Al-Baqarah 5
   * removed Ali Imran 5 from the same session, and filtered on tier, which no
   * longer means anything.
   */
  const removeMistakeEntirely = useCallback(async (mistake) => {
    if (!resolvedSessionId) return;
    // Marked, not deleted. The row is the only evidence the recogniser flagged
    // this ayah and that the person disagreed, which together are the app's
    // false-positive rate. Deleting it also rewrote history: any
    // mistakes-over-time figure changed underneath you whenever an old session
    // was corrected. Every read filters `dismissed_at is null`, so it counts for
    // nothing while still being on the record.
    await supabase
      .from('mistakes')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('session_id', resolvedSessionId)
      .eq('surah_number', mistake.surah_number)
      .eq('ayah_number', mistake.ayah_number)
      .is('dismissed_at', null);

    try {
      const userId = await getCurrentUserId();
      await removeFromQuizQueue(userId, mistake.surah_number, mistake.ayah_number);
    } catch (err) {
      console.error('[Summary] failed to clear the review queue:', err.message);
    }
  }, [resolvedSessionId]);

  const handleDismissMistake = useCallback(async (index, mistake) => {
    setMistakes((prev) => prev.filter((_, i) => i !== index));
    await removeMistakeEntirely(mistake);
  }, [removeMistakeEntirely]);

  /**
   * Clears one misheard word. A mistake is still one ayah however many words
   * are wrong in it, so clearing some words leaves the ayah counted. Only when
   * every flagged word is gone does the ayah stop being a mistake.
   */
  const handleClearWord = useCallback(async (index, mistake, word) => {
    const remaining = [...(mistake.wrong_words ?? [])];
    const at = remaining.indexOf(word);
    if (at < 0) return;
    remaining.splice(at, 1);

    setMistakes((prev) =>
      remaining.length === 0
        ? prev.filter((_, i) => i !== index)
        : prev.map((m, i) => (i === index ? { ...m, wrong_words: remaining } : m))
    );

    if (remaining.length === 0) {
      await removeMistakeEntirely(mistake);
      return;
    }

    if (!resolvedSessionId) return;
    const { error } = await supabase
      .from('mistakes')
      .update({ wrong_words: remaining })
      .eq('session_id', resolvedSessionId)
      .eq('surah_number', mistake.surah_number)
      .eq('ayah_number', mistake.ayah_number)
      .is('dismissed_at', null);
    if (error) {
      console.error('[Summary] failed to clear a word:', error.message);
    }
  }, [resolvedSessionId, removeMistakeEntirely]);

  // Arriving at the end of a session gets a "back to home" button, since there
  // is a flow to leave. Arriving from the tab gets the tab bar instead.
  const cameFromSession = Boolean(sessionId);

  const handleBackToHome = () => {
    cancelEveningNudge().catch(() => {});
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Today' }],
      })
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
        {cameFromSession ? (
          <TouchableOpacity style={styles.homeBtn} onPress={handleBackToHome} activeOpacity={0.88}>
            <Text style={styles.homeBtnText}>Back to home</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  // Opened from the tab before any session has been done. Without this it
  // would fall through and claim "No mistakes this session", which is true but
  // misleading when there has been no session at all.
  if (!session) {
    return (
      <Animated.View style={[styles.screen, { opacity }]}>
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>✦</Text>
          <Text style={styles.emptyText}>
            Nothing to review yet. Finish a session and your mistakes will show up here.
          </Text>
        </View>
        <TabBar active="summary" navigation={navigation} />
      </Animated.View>
    );
  }

  let portionLabel = '';
  if (session) {
    const start = getAyahLocation(session.juz_number, session.portion_start_ayah);
    const end = getAyahLocation(session.juz_number, session.portion_end_ayah);
    portionLabel =
      start.surahNumber === end.surahNumber
        ? `${start.surahName} · Ayahs ${start.ayahNumber}–${end.ayahNumber}`
        : `${start.surahName} ${start.ayahNumber} to ${end.surahName} ${end.ayahNumber}`;
  }

  // Zero on a quiz-only day. Its portion columns are filler, so subtracting them
  // would report an ayah recited that nobody recited.
  const ayahCount =
    session && session.type !== 'quiz_only'
      ? session.portion_end_ayah - session.portion_start_ayah + 1
      : 0;

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <View style={styles.content}>
        {juzComplete ? (
          <View style={styles.juzCompleteCard}>
            <Text style={styles.juzCompleteTitle}>Juz {session?.juz_number} Complete!</Text>
            <Text style={styles.gateText}>
              {returnsInDays
                ? returnsInDays === 1
                  ? 'You will see it again tomorrow.'
                  : `You will see it again in ${returnsInDays} days.`
                : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.successSection}>
            {/* The tick used to stand down while the list was open, to hand the
                list the room it takes. That was solving a problem the list does
                not have: it scrolls, so a shorter region shows fewer mistakes
                rather than losing any. What it cost was the one element that
                says the session is finished, on the screen whose whole job is
                to say so, and only on the days there was something to review. */}
            <Animated.View style={[styles.checkCircle, { transform: [{ scale: checkScale }] }]}>
              <Text style={styles.checkIcon}>✓</Text>
            </Animated.View>
            {/* The tab is opened on days after the session as well, so the
                heading names the day it belongs to rather than announcing a
                completion that may have happened last week. */}
            <Text style={styles.successTitle}>{sessionHeading(session?.date)}</Text>
            <Text style={styles.successSub}>{portionLabel}</Text>
          </View>
        )}

        <View style={styles.statsRow}>
          <StatPill value={String(ayahCount)} label="ayat recited" color={colors.primary} />
          <View style={styles.statDivider} />
          <StatPill
            value={String(mistakes.length)}
            label={mistakes.length === 1 ? 'mistake' : 'mistakes'}
            color={mistakes.length === 0 ? colors.success : colors.error}
          />
        </View>

        {/* The mistake list is the only part of this screen that grows without
            bound, so it is the only part that scrolls. A bad day used to push
            up next off the bottom of the page; now the list scrolls inside its
            own region and the next session stays on screen. When the list is
            closed a filler holds that space open, so up next sits in the same
            place either way rather than jumping as the list opens. */}
        {mistakes.length > 0 ? (
          <>
            <TouchableOpacity
              style={styles.disclosureRow}
              onPress={() => setMistakesOpen((open) => !open)}
              activeOpacity={0.7}
            >
              <Text style={styles.sectionLabel}>
                {mistakeCount} {mistakeCount === 1 ? 'ayah' : 'ayahs'} to review
              </Text>
              <Text style={styles.disclosureChevron}>{mistakesOpen ? '▾' : '▸'}</Text>
            </TouchableOpacity>
            {mistakesOpen ? (
              <ScrollView
                style={styles.mistakeScroll}
                contentContainerStyle={styles.mistakeScrollContent}
              >
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
            ) : (
              <View style={styles.filler} />
            )}
          </>
        ) : (
          <>
            <View style={styles.cleanCard}>
              <Text style={styles.cleanIcon}>✦</Text>
              <Text style={styles.cleanText}>No mistakes this session. Excellent work.</Text>
            </View>
            <View style={styles.filler} />
          </>
        )}

        {tomorrowText ? (
          <View>
            <Text style={styles.sectionLabel}>UP NEXT</Text>
            <View style={styles.nextCard}>
              <Text style={styles.nextLabel}>{nextLabel}</Text>
              <Text style={styles.nextTitle}>{tomorrowText}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {cameFromSession ? (
        <View style={styles.cta}>
          <TouchableOpacity style={styles.homeBtn} onPress={handleBackToHome} activeOpacity={0.88}>
            <Text style={styles.homeBtnText}>Back to home</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TabBar active="summary" navigation={navigation} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  // The page no longer scrolls as a whole. This is a fixed-height column:
  // header, then the mistake region which takes whatever is left, then up next
  // pinned above the button or the tab bar.
  content: {
    flex: 1,
    paddingTop: 64,
    paddingHorizontal: spacing.lg,
    paddingBottom: 16,
  },
  mistakeScroll: { flex: 1, marginBottom: spacing.md },
  mistakeScrollContent: { paddingBottom: spacing.xs },
  // Holds the same space open when the list is closed, so up next does not
  // move when the disclosure is toggled.
  filler: { flex: 1 },
  disclosureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  disclosureChevron: {
    fontSize: 14,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
  },
  successSection: { alignItems: 'center', marginBottom: spacing.lg },
  checkCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.success,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  checkIcon: { fontSize: 32, color: colors.white, fontWeight: '700' },
  successTitle: {
    fontFamily: fonts.semiBold, fontSize: 26, color: colors.text,
    letterSpacing: -0.3, marginBottom: 6,
  },
  successSub: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMid },

  juzCompleteCard: {
    backgroundColor: colors.successLight,
    borderWidth: 2,
    borderColor: colors.success,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  juzCompleteTitle: {
    fontFamily: fonts.semiBold, fontSize: 24, color: colors.success,
    marginBottom: 10, textAlign: 'center',
  },
  gateText: { fontFamily: fonts.regular, fontSize: 15, color: colors.text, textAlign: 'center', lineHeight: 22 },

  statsRow: {
    flexDirection: 'row', backgroundColor: colors.card, borderRadius: 16,
    padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  statPill: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: fonts.semiBold, fontSize: 24, letterSpacing: -0.5, marginBottom: 2 },
  statLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMid },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },

  sectionLabel: {
    fontFamily: fonts.semiBold, fontSize: 11, color: colors.textMuted,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: spacing.sm,
  },

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
  // Only an open card needs the gap; a closed one is the header and nothing else.
  mistakeCardHeaderOpen: { marginBottom: spacing.sm },
  mistakeCardHeaderEnd: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardChevron: { fontSize: 14, color: colors.textMuted },
  mistakeAyahLabel: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text },
  tapHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
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

  compRow: { flexDirection: 'row', marginBottom: spacing.sm, gap: spacing.sm },
  compCol: { flex: 1 },
  compDivider: { width: 1, backgroundColor: colors.border, alignSelf: 'stretch' },
  compLabel: {
    fontFamily: fonts.regular, fontSize: 11, color: colors.textMuted,
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  compWord: { fontFamily: 'UthmanicHafs', fontSize: 18, writingDirection: 'rtl', lineHeight: 30 },
  // Both columns read as plain text, and colour is spent only on the one word
  // the comparison is about: red for what was said, green for what it should
  // have been. Colouring a whole column made the difference impossible to spot.
  compNeutral: { color: colors.text },
  compSlip: { color: colors.error },
  compCorrection: { color: colors.success },

  badge: { borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 },
  badgeSlip: { backgroundColor: colors.accentLight },
  badgeConfirmed: { backgroundColor: colors.errorLight },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 12 },
  badgeTextSlip: { color: colors.accent },
  badgeTextConfirmed: { color: colors.error },

  cleanCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.successLight, borderRadius: 14, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.success,
  },
  emptyIcon: { fontSize: 30, color: colors.textMuted, marginBottom: spacing.md },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMid,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  cleanIcon: { fontSize: 18, color: colors.success },
  cleanText: { fontFamily: fonts.medium, fontSize: 14, color: colors.success, flex: 1 },

  // Brown, not blue: the button under it is the primary blue, and two filled
  // blue blocks stacked read as one control split in two.
  nextCard: {
    backgroundColor: colors.brown, borderRadius: 16, padding: spacing.md,
    marginBottom: spacing.md,
  },
  nextLabel: {
    fontFamily: fonts.semiBold, fontSize: 10, color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4,
  },
  // Optical, not layout: both lines are laid out at the same x, but measured in
  // ink the eyebrow's T starts 0.1px in and the portion's A starts 1.6px in, so
  // the two read as stepped. The nudge puts them on one edge.
  nextTitle: {
    fontFamily: fonts.semiBold, fontSize: 20, color: colors.white,
    letterSpacing: -0.2, marginLeft: -1.5,
  },

  error: {
    fontFamily: fonts.regular,
    color: colors.error,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  cta: {
    // Was absolute, which needed a spacer inside the old page-wide ScrollView
    // to stop content hiding behind it. In a flex column it is simply the last
    // child, the same as the tab bar it stands in for.
    paddingHorizontal: spacing.lg,
    paddingBottom: 48,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  homeBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  homeBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
});
