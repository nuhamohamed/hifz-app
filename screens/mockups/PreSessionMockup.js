import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, S } from './design';

// Simulated mushaf words for the mockup
const MOCK_WORDS = [
  { text: 'بِسۡمِ', surah: 67, ayah: 0, word: 1, isMarker: false, isCue: true },
  { text: 'ٱللَّهِ', surah: 67, ayah: 0, word: 2, isMarker: false, isCue: true },
  { text: 'ٱلرَّحۡمَٰنِ', surah: 67, ayah: 0, word: 3, isMarker: false, isCue: true },
  { text: 'ٱلرَّحِيمِ', surah: 67, ayah: 0, word: 4, isMarker: false, isCue: true },
];

const MOCK_LINE_1 = [
  { text: 'تَبَٰرَكَ', id: 1, surah: 67, ayah: 1, word: 1, isMarker: false, revealed: true, wrong: false },
  { text: 'ٱلَّذِى', id: 2, surah: 67, ayah: 1, word: 2, isMarker: false, revealed: true, wrong: false },
  { text: 'بِيَدِهِ', id: 3, surah: 67, ayah: 1, word: 3, isMarker: false, revealed: false, wrong: false },
  { text: 'ٱلۡمُلۡكُ', id: 4, surah: 67, ayah: 1, word: 4, isMarker: false, revealed: false, wrong: false },
  { text: 'وَهُوَ', id: 5, surah: 67, ayah: 1, word: 5, isMarker: false, revealed: false, wrong: false },
  { text: '١', id: 6, surah: 67, ayah: 1, word: 6, isMarker: true },
];

const MOCK_LINE_2 = [
  { text: 'عَلَىٰ', id: 7, surah: 67, ayah: 2, word: 1, isMarker: false, revealed: false, wrong: false },
  { text: 'كُلِّ', id: 8, surah: 67, ayah: 2, word: 2, isMarker: false, revealed: false, wrong: false },
  { text: 'شَيۡءٍ', id: 9, surah: 67, ayah: 2, word: 3, isMarker: false, revealed: false, wrong: false },
  { text: 'قَدِيرٌ', id: 10, surah: 67, ayah: 2, word: 4, isMarker: false, revealed: false, wrong: false },
  { text: '٢', id: 11, surah: 67, ayah: 2, word: 5, isMarker: true },
];

function MushafWord({ word, cue = false }) {
  if (word.isMarker) {
    return <Text style={styles.marker}>{word.text}</Text>;
  }
  const textStyle = [
    styles.word,
    cue && styles.wordCue,
    !cue && !word.revealed && styles.wordHidden,
    word.wrong && styles.wordWrong,
    word.revealed && !word.wrong && styles.wordRevealed,
  ];
  return <Text style={textStyle}>{word.text}</Text>;
}

function MushafLine({ words, isCue = false }) {
  return (
    <View style={styles.mushafLine}>
      {words.map((w) => (
        <MushafWord key={w.id} word={w} cue={isCue} />
      ))}
    </View>
  );
}

function MicPulse({ isListening }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isListening) { pulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isListening]);
  return (
    <View style={styles.micWrap}>
      <Animated.View style={[styles.micRing, { opacity: pulse, transform: [{ scale: pulse }] }]} />
      <View style={styles.micCircle}>
        <Text style={styles.micEmoji}>🎙</Text>
      </View>
    </View>
  );
}

export default function PreSessionMockup({ navigation }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.pauseBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <Text style={styles.pauseBtnText}>✕ Pause</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Warm-up Quiz</Text>
          <Text style={styles.headerSub}>Question 1 of 3</Text>
        </View>
        <TouchableOpacity style={styles.revealBtn} activeOpacity={0.8}>
          <Text style={styles.revealBtnText}>Reveal</Text>
        </TouchableOpacity>
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: '33%' }]} />
      </View>

      {/* Mushaf area */}
      <View style={styles.mushafArea}>
        <View style={styles.surahNameBar}>
          <Text style={styles.surahNameText}>سورة الملك</Text>
        </View>

        <View style={styles.mushafCard}>
          <MushafLine words={MOCK_WORDS} isCue />
          <MushafLine words={MOCK_LINE_1} />
          <MushafLine words={MOCK_LINE_2} />
        </View>
      </View>

      {/* Hint */}
      <View style={styles.hintBar}>
        <Text style={styles.hintText}>Recite from the grey text above</Text>
      </View>

      {/* Mic */}
      <View style={styles.micSection}>
        <MicPulse isListening />
      </View>

      {/* Bottom CTA */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.nextBtn}
          onPress={() => navigation.navigate('MockupRecitation')}
          activeOpacity={0.88}
        >
          <Text style={styles.nextBtnText}>Continue to recitation →</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: S.md,
    paddingBottom: S.sm,
  },
  pauseBtn: {
    backgroundColor: 'rgba(10,20,40,0.07)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  pauseBtnText: { fontFamily: F.medium, fontSize: 13, color: C.navyMid },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontFamily: F.semiBold, fontSize: 16, color: C.navy },
  headerSub: { fontFamily: F.regular, fontSize: 12, color: C.navyLight, marginTop: 2 },
  revealBtn: {
    backgroundColor: C.goldLight,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  revealBtnText: { fontFamily: F.semiBold, fontSize: 13, color: C.gold },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(10,20,40,0.08)',
    marginHorizontal: S.md,
    borderRadius: 2,
    marginBottom: S.md,
  },
  progressFill: {
    height: 3,
    backgroundColor: C.cobalt,
    borderRadius: 2,
  },
  mushafArea: {
    flex: 1,
    paddingHorizontal: S.md,
  },
  surahNameBar: {
    backgroundColor: '#EDE9DE',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: S.sm,
  },
  surahNameText: {
    fontFamily: 'UthmanicHafs',
    fontSize: 16,
    color: '#5d4a1f',
  },
  mushafCard: {
    backgroundColor: C.white,
    borderRadius: 16,
    padding: S.md,
    gap: 4,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  mushafLine: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    flexWrap: 'nowrap',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  word: {
    fontFamily: 'UthmanicHafs',
    fontSize: 20,
    color: C.navy,
    lineHeight: 34,
  },
  wordCue: { color: '#BDBDBD' },
  wordHidden: { color: 'transparent' },
  wordRevealed: { color: '#2E7D32' },
  wordWrong: { color: '#C62828' },
  marker: {
    fontFamily: 'UthmanicHafs',
    fontSize: 18,
    color: C.gold,
  },
  hintBar: {
    paddingVertical: S.sm,
    alignItems: 'center',
  },
  hintText: {
    fontFamily: F.regular,
    fontSize: 13,
    color: C.navyLight,
  },
  micSection: {
    alignItems: 'center',
    paddingVertical: S.md,
  },
  micWrap: { alignItems: 'center', justifyContent: 'center', width: 80, height: 80 },
  micRing: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.cobaltDim,
  },
  micCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.cobalt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micEmoji: { fontSize: 24 },
  bottomBar: {
    paddingHorizontal: S.lg,
    paddingBottom: 48,
    paddingTop: S.sm,
  },
  nextBtn: {
    backgroundColor: C.cobalt,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  nextBtnText: {
    fontFamily: F.semiBold,
    fontSize: 16,
    color: C.white,
  },
});
