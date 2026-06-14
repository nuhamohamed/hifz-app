import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { getCurrentUserId } from '../lib/auth';
import { getAyahLocation, getJuzTotalAyahs } from '../lib/juzSurahMap';
import { getAyah } from '../lib/quranApi';
import { updateJuzProgressAfterSession } from '../lib/planEngine';
import { supabase } from '../lib/supabase';

function getTomorrowDateString() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function formatTomorrowLine(tomorrow) {
  const start = getAyahLocation(
    tomorrow.juz_number,
    tomorrow.portion_start_ayah
  );
  const end = getAyahLocation(
    tomorrow.juz_number,
    tomorrow.portion_end_ayah
  );
  if (start.surahNumber === end.surahNumber) {
    return `Tomorrow: Juz ${tomorrow.juz_number}: ${start.surahName}, Ayahs ${start.ayahNumber}–${end.ayahNumber}`;
  }
  return `Tomorrow: Juz ${tomorrow.juz_number}: ${start.surahName}, Ayahs ${start.ayahNumber} to ${end.surahName}, Ayahs ${end.ayahNumber}`;
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
    return <Text style={styles.ayahText}>{text}</Text>;
  }

  const wrongIndices = buildWrongWordIndices(words, wrongWords);
  const displayWords = words.map((w) => w.textDisplay);

  return (
    <Text style={styles.ayahText}>
      {displayWords.map((word, i) => (
        <Text
          key={i}
          style={
            wrongIndices.has(i) ? styles.ayahWordWrong : styles.ayahWordCorrect
          }
        >
          {word}{' '}
        </Text>
      ))}
    </Text>
  );
}

function MistakeCard({ mistake }) {
  const [expanded, setExpanded] = useState(false);
  const isSlip = mistake.tier === 1;

  return (
    <TouchableOpacity
      style={styles.mistakeCard}
      onPress={() => setExpanded((prev) => !prev)}
      activeOpacity={0.85}
    >
      <View style={styles.mistakeCardHeader}>
        <Text style={styles.mistakeAyahLabel}>Ayah {mistake.ayah_number}</Text>
        <View
          style={[
            styles.badge,
            isSlip ? styles.badgeSlip : styles.badgeConfirmed,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              isSlip ? styles.badgeTextSlip : styles.badgeTextConfirmed,
            ]}
          >
            {isSlip ? 'Slip' : 'Confirmed mistake'}
          </Text>
        </View>
      </View>
      {!expanded ? (
        <Text style={styles.mistakeTapHint}>Tap to view details</Text>
      ) : (
        <>
          {mistake.transcribed_text ? (
            <>
              <Text style={styles.mistakeDetailLabel}>What you said:</Text>
              <Text style={styles.transcribedText}>
                {mistake.transcribed_text}
              </Text>
            </>
          ) : null}
          <Text style={styles.mistakeDetailLabel}>Correct:</Text>
          <AyahTextWithHighlights
            words={mistake.words}
            wrongWords={mistake.wrong_words}
            isDisconnectedLetters={mistake.isDisconnectedLetters}
          />
        </>
      )}
    </TouchableOpacity>
  );
}

export default function SessionSummaryScreen({ route }) {
  const navigation = useNavigation();
  const sessionId = route?.params?.sessionId;
  const totalAyahsInJuzParam = route?.params?.totalAyahsInJuz;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [mistakes, setMistakes] = useState([]);
  const [tomorrowText, setTomorrowText] = useState(null);
  const planUpdatedRef = useRef(false);

  useEffect(() => {
    if (!sessionId) {
      setError('No session ID provided.');
      setIsLoading(false);
      return;
    }

    let mounted = true;

    (async () => {
      try {
        setIsLoading(true);
        setError('');

        const { data: sessionData, error: sessionError } = await supabase
          .from('sessions')
          .select(
            'portion_start_ayah, portion_end_ayah, juz_number, completed_at, status'
          )
          .eq('id', sessionId)
          .single();

        if (sessionError) {
          throw new Error(sessionError.message);
        }

        const userId = await getCurrentUserId();

        if (
          sessionData.status === 'complete' &&
          !planUpdatedRef.current
        ) {
          planUpdatedRef.current = true;
          const totalAyahsInJuz =
            totalAyahsInJuzParam ??
            getJuzTotalAyahs(sessionData.juz_number);
          await updateJuzProgressAfterSession(
            userId,
            sessionId,
            sessionData.juz_number,
            sessionData.portion_end_ayah,
            totalAyahsInJuz
          );
        }

        const { data: tomorrow, error: tomorrowError } = await supabase
          .from('scheduled_portions')
          .select('juz_number, portion_start_ayah, portion_end_ayah, type')
          .eq('user_id', userId)
          .eq('scheduled_date', getTomorrowDateString())
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (tomorrowError) {
          throw new Error(tomorrowError.message);
        }

        let nextTomorrowText = null;
        if (tomorrow?.type === 'quiz_only') {
          nextTomorrowText = 'Tomorrow: Quiz only';
        } else if (tomorrow) {
          nextTomorrowText = formatTomorrowLine(tomorrow);
        } else {
          nextTomorrowText = 'Tomorrow: Quiz only';
        }

        const { data: mistakesData, error: mistakesError } = await supabase
          .from('mistakes')
          .select('tier, ayah_number, surah_number, wrong_words, transcribed_text')
          .eq('session_id', sessionId)
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
      } catch (err) {
        if (mounted) {
          setError(err.message ?? 'Failed to load session summary.');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [sessionId, totalAyahsInJuzParam]);

  const confirmedCount = mistakes.filter((m) => m.tier === 2).length;
  const slipCount = mistakes.filter((m) => m.tier === 1).length;

  const handleBackToHome = () => {
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
        <ActivityIndicator size="large" color="#2e7d32" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity
          style={styles.backToHomeButton}
          onPress={handleBackToHome}
          activeOpacity={0.8}
        >
          <Text style={styles.backToHomeButtonText}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  let portionLabel = '';
  if (session) {
    const start = getAyahLocation(
      session.juz_number,
      session.portion_start_ayah
    );
    const end = getAyahLocation(session.juz_number, session.portion_end_ayah);
    if (start.surahNumber === end.surahNumber) {
      portionLabel = `${start.surahName} ${start.ayahNumber}–${end.ayahNumber}`;
    } else {
      portionLabel = `${start.surahName} ${start.ayahNumber} to ${end.surahName} ${end.ayahNumber}`;
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Session Complete</Text>

      <Text style={styles.portionText}>
        {session ? `Juz ${session.juz_number} — ${portionLabel}` : ''}
      </Text>

      <Text style={styles.summaryLine}>
        {confirmedCount} confirmed mistake{confirmedCount === 1 ? '' : 's'} ·{' '}
        {slipCount} slip{slipCount === 1 ? '' : 's'}
      </Text>

      {mistakes.length === 0 ? (
        <Text style={styles.noMistakes}>No mistakes — excellent session! 🎉</Text>
      ) : (
        mistakes.map((mistake, index) => (
          <MistakeCard
            key={`${mistake.surah_number}-${mistake.ayah_number}-${mistake.tier}-${index}`}
            mistake={mistake}
          />
        ))
      )}

      {tomorrowText ? (
        <Text style={styles.tomorrowText}>{tomorrowText}</Text>
      ) : null}

      <TouchableOpacity
        style={styles.backToHomeButton}
        onPress={handleBackToHome}
        activeOpacity={0.8}
      >
        <Text style={styles.backToHomeButtonText}>Back to Home</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 64,
    paddingBottom: 40,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1b5e20',
    marginBottom: 12,
    textAlign: 'center',
  },
  portionText: {
    fontSize: 17,
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  summaryLine: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 28,
  },
  noMistakes: {
    fontSize: 18,
    color: '#1b5e20',
    textAlign: 'center',
    marginVertical: 32,
    lineHeight: 28,
  },
  tomorrowText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
    lineHeight: 24,
  },
  mistakeCard: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    backgroundColor: '#fafaf8',
  },
  mistakeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  mistakeAyahLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  mistakeTapHint: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  mistakeDetailLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
    marginTop: 8,
  },
  transcribedText: {
    fontSize: 18,
    lineHeight: 32,
    textAlign: 'right',
    writingDirection: 'rtl',
    color: '#757575',
    marginBottom: 8,
  },
  badge: {
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  badgeSlip: {
    backgroundColor: '#fff3e0',
  },
  badgeConfirmed: {
    backgroundColor: '#ffebee',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  badgeTextSlip: {
    color: '#e65100',
  },
  badgeTextConfirmed: {
    color: '#c62828',
  },
  ayahText: {
    fontSize: 22,
    lineHeight: 40,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  ayahWordCorrect: {
    color: '#1b1b1b',
  },
  ayahWordWrong: {
    color: '#c62828',
  },
  error: {
    color: '#c00',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  backToHomeButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginTop: 24,
  },
  backToHomeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});
