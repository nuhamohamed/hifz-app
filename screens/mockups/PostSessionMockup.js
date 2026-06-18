import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, S } from './design';

const MOCK_LINE = [
  { id: 1, text: 'تَبَٰرَكَ', isMarker: false, status: 'cue' },
  { id: 2, text: 'ٱلَّذِى', isMarker: false, status: 'cue' },
  { id: 3, text: 'بِيَدِهِ', isMarker: false, status: 'cue' },
  { id: 4, text: 'ٱلۡمُلۡكُ', isMarker: false, status: 'cue' },
  { id: 5, text: 'وَهُوَ', isMarker: false, status: 'hidden' },
  { id: 6, text: '١', isMarker: true },
];

const MOCK_LINE_2 = [
  { id: 7, text: 'عَلَىٰ', isMarker: false, status: 'hidden' },
  { id: 8, text: 'كُلِّ', isMarker: false, status: 'hidden' },
  { id: 9, text: 'شَيۡءٍ', isMarker: false, status: 'hidden' },
  { id: 10, text: 'قَدِيرٌ', isMarker: false, status: 'hidden' },
];

function wordStyle(status) {
  switch (status) {
    case 'correct': return { color: '#2E7D32' };
    case 'wrong': return { color: '#C62828' };
    case 'cue': return { color: '#BDBDBD' };
    case 'hidden': return { color: 'transparent' };
    default: return { color: C.navy };
  }
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
    <View style={styles.micWrap}>
      <Animated.View style={[styles.micRing, { opacity: pulse, transform: [{ scale: pulse }] }]} />
      <View style={styles.micCircle}>
        <Text style={styles.micEmoji}>🎙</Text>
      </View>
    </View>
  );
}

export default function PostSessionMockup({ navigation }) {
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
          <Text style={styles.headerTitle}>Recap Quiz</Text>
          <Text style={styles.headerSub}>Question 1 of 2</Text>
        </View>
        <TouchableOpacity style={styles.revealBtn} activeOpacity={0.8}>
          <Text style={styles.revealBtnText}>Reveal</Text>
        </TouchableOpacity>
      </View>

      {/* Progress */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: '50%' }]} />
      </View>

      {/* Context chip */}
      <View style={styles.contextChip}>
        <Text style={styles.contextText}>From today's session — locking it in 🔒</Text>
      </View>

      {/* Mushaf */}
      <View style={styles.mushafArea}>
        <View style={styles.mushafCard}>
          <View style={[styles.mushafLine]}>
            {MOCK_LINE.map((w) =>
              w.isMarker ? (
                <Text key={w.id} style={styles.marker}>{w.text}</Text>
              ) : (
                <Text key={w.id} style={[styles.mushafWord, wordStyle(w.status)]}>
                  {w.text}
                </Text>
              )
            )}
          </View>
          <View style={styles.mushafLine}>
            {MOCK_LINE_2.map((w) => (
              <Text key={w.id} style={[styles.mushafWord, wordStyle(w.status)]}>
                {w.text}
              </Text>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.hintBar}>
        <Text style={styles.hintText}>Recite the complete ayah from the beginning</Text>
      </View>

      <View style={styles.micSection}>
        <MicPulse />
      </View>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => navigation.navigate('MockupSummary')}
          activeOpacity={0.88}
        >
          <Text style={styles.doneBtnText}>Finish session →</Text>
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
    backgroundColor: C.cobalt,
    borderRadius: 2,
  },
  contextChip: {
    backgroundColor: C.cobaltDim,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    alignSelf: 'center',
    marginBottom: S.md,
  },
  contextText: {
    fontFamily: F.medium,
    fontSize: 12,
    color: C.cobalt,
  },
  mushafArea: {
    flex: 1,
    paddingHorizontal: S.md,
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
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
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
  doneBtn: {
    backgroundColor: '#1E7A4A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  doneBtnText: {
    fontFamily: F.semiBold,
    fontSize: 16,
    color: C.white,
  },
});
