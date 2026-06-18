import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, S } from './design';

// Simulated 3-ayah display of Al-Mulk 1-3
const MOCK_PAGE = [
  {
    lineType: 'surah_name',
    surahName: 'الملك',
    lineNumber: 1,
    isCentered: true,
  },
  {
    lineType: 'basmallah',
    lineNumber: 2,
    isCentered: true,
  },
  {
    lineType: 'ayah',
    lineNumber: 3,
    isCentered: false,
    words: [
      { id: 1, surah: 67, ayah: 1, word: 1, text: 'تَبَٰرَكَ', isMarker: false, status: 'correct' },
      { id: 2, surah: 67, ayah: 1, word: 2, text: 'ٱلَّذِى', isMarker: false, status: 'correct' },
      { id: 3, surah: 67, ayah: 1, word: 3, text: 'بِيَدِهِ', isMarker: false, status: 'correct' },
      { id: 4, surah: 67, ayah: 1, word: 4, text: 'ٱلۡمُلۡكُ', isMarker: false, status: 'correct' },
      { id: 5, surah: 67, ayah: 1, word: 5, text: 'وَهُوَ', isMarker: false, status: 'correct' },
      { id: 6, surah: 67, ayah: 1, word: 6, text: '١', isMarker: true },
    ],
  },
  {
    lineType: 'ayah',
    lineNumber: 4,
    isCentered: false,
    words: [
      { id: 7, surah: 67, ayah: 1, word: 7, text: 'عَلَىٰ', isMarker: false, status: 'correct' },
      { id: 8, surah: 67, ayah: 1, word: 8, text: 'كُلِّ', isMarker: false, status: 'correct' },
      { id: 9, surah: 67, ayah: 1, word: 9, text: 'شَيۡءٍ', isMarker: false, status: 'correct' },
      { id: 10, surah: 67, ayah: 1, word: 10, text: 'قَدِيرٌ', isMarker: false, status: 'correct' },
    ],
  },
  {
    lineType: 'ayah',
    lineNumber: 5,
    isCentered: false,
    words: [
      { id: 11, surah: 67, ayah: 2, word: 1, text: 'ٱلَّذِى', isMarker: false, status: 'live' },
      { id: 12, surah: 67, ayah: 2, word: 2, text: 'خَلَقَ', isMarker: false, status: 'live' },
      { id: 13, surah: 67, ayah: 2, word: 3, text: 'ٱلۡمَوۡتَ', isMarker: false, status: 'wrong' },
      { id: 14, surah: 67, ayah: 2, word: 4, text: 'وَٱلۡحَيَوٰةَ', isMarker: false, status: 'hidden' },
      { id: 15, surah: 67, ayah: 2, word: 5, text: 'لِيَبۡلُوَكُمۡ', isMarker: false, status: 'hidden' },
      { id: 16, surah: 67, ayah: 2, word: 6, text: '٢', isMarker: true },
    ],
  },
  {
    lineType: 'ayah',
    lineNumber: 6,
    isCentered: false,
    words: [
      { id: 17, surah: 67, ayah: 2, word: 7, text: 'أَيُّكُمۡ', isMarker: false, status: 'hidden' },
      { id: 18, surah: 67, ayah: 2, word: 8, text: 'أَحۡسَنُ', isMarker: false, status: 'hidden' },
      { id: 19, surah: 67, ayah: 2, word: 9, text: 'عَمَلٗاۚ', isMarker: false, status: 'hidden' },
    ],
  },
  {
    lineType: 'ayah',
    lineNumber: 7,
    isCentered: false,
    words: [
      { id: 20, surah: 67, ayah: 3, word: 1, text: 'وَهُوَ', isMarker: false, status: 'cue' },
      { id: 21, surah: 67, ayah: 3, word: 2, text: 'ٱلۡعَزِيزُ', isMarker: false, status: 'cue' },
      { id: 22, surah: 67, ayah: 3, word: 3, text: 'ٱلۡغَفُورُ', isMarker: false, status: 'cue' },
      { id: 23, surah: 67, ayah: 3, word: 4, text: '٣', isMarker: true },
    ],
  },
];

const BASMALLAH = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';

function wordStyle(status) {
  switch (status) {
    case 'correct': return { color: '#2E7D32' };
    case 'wrong': return { color: '#C62828', backgroundColor: 'rgba(198,40,40,0.12)', borderRadius: 4 };
    case 'live': return { color: C.navy };
    case 'cue': return { color: '#BDBDBD' };
    case 'hidden': return { color: 'transparent' };
    default: return {};
  }
}

function MushafPage({ lines }) {
  return (
    <View style={styles.page}>
      {lines.map((line, idx) => {
        if (line.lineType === 'surah_name') {
          return (
            <View key={idx} style={styles.surahNameBar}>
              <Text style={styles.surahNameText}>سورة {line.surahName}</Text>
            </View>
          );
        }
        if (line.lineType === 'basmallah') {
          return (
            <View key={idx} style={[styles.line, styles.centeredLine]}>
              <Text style={styles.mushafWord}>{BASMALLAH}</Text>
            </View>
          );
        }
        return (
          <View
            key={idx}
            style={[styles.line, line.isCentered && styles.centeredLine]}
          >
            {line.words.map((w) => (
              w.isMarker ? (
                <Text key={w.id} style={styles.marker}>{w.text}</Text>
              ) : (
                <Text key={w.id} style={[styles.mushafWord, wordStyle(w.status)]}>
                  {w.text}
                </Text>
              )
            ))}
          </View>
        );
      })}
    </View>
  );
}

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
    <Animated.Text style={[styles.micEmoji, { opacity: pulse }]}>🎙</Animated.Text>
  );
}

export default function RecitationMockup({ navigation }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [mistakeMsg, setMistakeMsg] = useState('Possible mistake on word 3');

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    const t = setTimeout(() => setMistakeMsg(''), 5000);
    return () => clearTimeout(t);
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
          <Text style={styles.headerTitle}>Al-Mulk · 1–7</Text>
          <Text style={styles.headerSub}>Ayah 2 of 7</Text>
        </View>
        <TouchableOpacity style={styles.revealBtn} activeOpacity={0.8}>
          <Text style={styles.revealBtnText}>Reveal</Text>
        </TouchableOpacity>
      </View>

      {/* Progress */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: '28%' }]} />
      </View>

      {/* Mushaf */}
      <ScrollView style={styles.mushafScroll} contentContainerStyle={styles.mushafScrollContent}>
        <MushafPage lines={MOCK_PAGE} />
      </ScrollView>

      {/* Feedback bar */}
      {mistakeMsg ? (
        <View style={styles.mistakeBar}>
          <Text style={styles.mistakeText}>{mistakeMsg}</Text>
        </View>
      ) : null}

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <MicPulse />
        <TouchableOpacity
          style={styles.continueBtn}
          onPress={() => navigation.navigate('MockupTransition', {
            title: 'Recap time',
            subtitle: 'Let\'s lock in what you just recited.',
            nextScreen: 'MockupPostSession',
            delay: 2500,
          })}
          activeOpacity={0.88}
        >
          <Text style={styles.continueBtnText}>Done — go to recap →</Text>
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
    marginBottom: S.sm,
  },
  progressFill: {
    height: 3,
    backgroundColor: C.gold,
    borderRadius: 2,
  },
  mushafScroll: { flex: 1 },
  mushafScrollContent: { paddingHorizontal: S.md },
  page: {
    backgroundColor: C.white,
    borderRadius: 16,
    padding: S.md,
    gap: 2,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  surahNameBar: {
    backgroundColor: '#EDE9DE',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: 6,
  },
  surahNameText: {
    fontFamily: 'UthmanicHafs',
    fontSize: 16,
    color: '#5d4a1f',
  },
  line: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    flexWrap: 'nowrap',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.04)',
  },
  centeredLine: { justifyContent: 'center' },
  mushafWord: {
    fontFamily: 'UthmanicHafs',
    fontSize: 20,
    color: C.navy,
    lineHeight: 34,
  },
  marker: {
    fontFamily: 'UthmanicHafs',
    fontSize: 18,
    color: C.gold,
  },
  mistakeBar: {
    marginHorizontal: S.md,
    marginBottom: S.sm,
    backgroundColor: '#FFF3E0',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: S.md,
    borderWidth: 1,
    borderColor: '#FFB74D',
  },
  mistakeText: {
    fontFamily: F.medium,
    fontSize: 14,
    color: '#E65100',
    textAlign: 'center',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.md,
    paddingBottom: 44,
    paddingTop: S.sm,
    borderTopWidth: 1,
    borderTopColor: C.cardBorder,
    backgroundColor: C.white,
    gap: S.md,
  },
  micEmoji: { fontSize: 34 },
  continueBtn: {
    flex: 1,
    backgroundColor: C.cobalt,
    borderRadius: 13,
    paddingVertical: 14,
    alignItems: 'center',
  },
  continueBtnText: {
    fontFamily: F.semiBold,
    fontSize: 15,
    color: C.white,
  },
});
