import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { C, F, S } from './design';
import { useMockup } from './MockupContext';
import MushafPage from '../../components/MushafPage';
import { getPageForAyah } from '../../lib/mushafDb';

const QUESTIONS = [
  {
    id: 1,
    ayah: 3,
    surahName: 'Al-Mulk',
    mistakeWord: 'سَبۡعَ',
    recitedWord: 'ثَلَٰثَ',
    recitedPhrase: 'خَلَقَ ثَلَٰثَ سَمَـٰوَٰتٍ',
    expectedPhrase: 'خَلَقَ سَبۡعَ سَمَـٰوَٰتٍ',
  },
  {
    id: 2,
    ayah: 5,
    surahName: 'Al-Mulk',
    mistakeWord: 'مَصَـٰبِيحَ',
    recitedWord: 'نُجُومًا',
    recitedPhrase: 'زَيَّنَّا ٱلسَّمَآءَ بِنُجُومٍ',
    expectedPhrase: 'زَيَّنَّا ٱلسَّمَآءَ بِمَصَـٰبِيحَ',
  },
];

// Covers any ayah up to 25 words — marks all words red on reveal
const ALL_WORD_INDICES = Array.from({ length: 25 }, (_, i) => i);

function MicPulse() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={styles.micWrap}>
      <Animated.View style={[styles.micRing, { opacity: pulse, transform: [{ scale: pulse }] }]} />
      <View style={styles.micCircle}>
        <Text style={styles.micEmoji}>🎙</Text>
      </View>
    </View>
  );
}

const MOCK_SURAH = 67;

export default function PostSessionMockup({ navigation }) {
  const { addMistake, sessionMistakes } = useMockup();
  const db = useSQLiteContext();
  const [qIdx, setQIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [currentPage, setCurrentPage] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const fadeQ = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const q = QUESTIONS[qIdx];

  useEffect(() => {
    getPageForAyah(db, MOCK_SURAH, q.ayah)
      .then((p) => { if (p != null) setCurrentPage(p); })
      .catch(() => {});
  }, [db, qIdx]);

  const isLast = qIdx === QUESTIONS.length - 1;

  const handleReveal = () => setRevealed(true);

  const advanceQuestion = () => {
    if (isLast) {
      navigation.navigate('MockupSummary', { mistakes: sessionMistakes });
      return;
    }
    Animated.timing(fadeQ, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setQIdx((i) => i + 1);
      setRevealed(false);
      Animated.timing(fadeQ, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  };

  const handleMissed = () => {
    addMistake({
      ayah: q.ayah, surahName: q.surahName, type: 'mistake',
      mistakeWord: q.mistakeWord, recitedWord: q.recitedWord,
      recitedPhrase: q.recitedPhrase, expectedPhrase: q.expectedPhrase,
    });
    advanceQuestion();
  };

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Recap Quiz</Text>
        <Text style={styles.headerSub}>Question {qIdx + 1} of {QUESTIONS.length}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((qIdx + 1) / QUESTIONS.length) * 100}%` }]} />
      </View>

      <Animated.View style={[styles.mushafArea, { opacity: fadeQ }]}>
        {currentPage != null && (
          <MushafPage
            pageNumber={currentPage}
            ayahStatuses={{
              [`${MOCK_SURAH}:${q.ayah}`]: revealed
                ? { wrongIndices: ALL_WORD_INDICES }
                : { wrongIndices: [], cue: true },
            }}
          />
        )}
      </Animated.View>

      <View style={styles.bottomBar}>
        {revealed ? (
          <>
            <TouchableOpacity style={[styles.sideBtn, styles.missedBtn]} onPress={handleMissed} activeOpacity={0.8}>
              <Text style={styles.missedBtnText}>✕ Missed</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sideBtn, styles.gotItBtn]} onPress={advanceQuestion} activeOpacity={0.8}>
              <Text style={styles.gotItBtnText}>✓ Got it</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.sideBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
              <Text style={styles.sideBtnText}>✕ Pause</Text>
            </TouchableOpacity>
            <View style={styles.micCol}>
              <MicPulse />
              <TouchableOpacity onPress={() => navigation.navigate('MockupSummary', { mistakes: sessionMistakes })} activeOpacity={0.7}>
                <Text style={styles.skipText}>Skip to summary</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.sideBtn, styles.revealBtn]} onPress={handleReveal} activeOpacity={0.8}>
              <Text style={styles.revealBtnText}>Reveal</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: { alignItems: 'center', paddingTop: 60, paddingBottom: S.sm },
  headerTitle: { fontFamily: F.semiBold, fontSize: 16, color: C.navy },
  headerSub: { fontFamily: F.regular, fontSize: 12, color: C.navyLight, marginTop: 2 },
  progressTrack: {
    height: 3, backgroundColor: 'rgba(6,21,44,0.08)',
    marginHorizontal: S.md, borderRadius: 2, marginBottom: S.md,
  },
  progressFill: { height: 3, backgroundColor: C.cobalt, borderRadius: 2 },
  mushafArea: { flex: 1 },
  micCol: { alignItems: 'center', gap: 6 },
  skipText: { fontFamily: F.regular, fontSize: 11, color: C.navyLight },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.cardBorder, backgroundColor: C.white,
  },
  sideBtn: {
    backgroundColor: 'rgba(6,21,44,0.07)', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  sideBtnText: { fontFamily: F.medium, fontSize: 13, color: C.navyMid },
  revealBtn: { backgroundColor: C.goldLight },
  revealBtnText: { fontFamily: F.semiBold, fontSize: 13, color: C.brown },
  missedBtn: { backgroundColor: '#FFEBEE', flex: 1, marginRight: 8, alignItems: 'center', paddingVertical: 14 },
  missedBtnText: { fontFamily: F.semiBold, fontSize: 14, color: '#C62828' },
  gotItBtn: { backgroundColor: C.cobaltDim, flex: 1, marginLeft: 8, alignItems: 'center', paddingVertical: 14 },
  gotItBtnText: { fontFamily: F.semiBold, fontSize: 14, color: C.cobalt },
  micWrap: { alignItems: 'center', justifyContent: 'center', width: 48, height: 48 },
  micRing: { position: 'absolute', width: 42, height: 42, borderRadius: 21, backgroundColor: C.cobaltDim },
  micCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.cobalt, alignItems: 'center', justifyContent: 'center' },
  micEmoji: { fontSize: 16 },
});
