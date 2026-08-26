import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { C, F, S } from './design';
import { useMockup } from './MockupContext';
import MushafPage from '../../components/MushafPage';
import { getPageForAyah } from '../../lib/mushafDb';

const MOCK_SURAH = 67;
const MOCK_START_AYAH = 1;
const MOCK_END_AYAH = 7;
const TOTAL_AYAHS = MOCK_END_AYAH - MOCK_START_AYAH + 1;

function MicPulse({ onPress }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.micWrap}>
      <Animated.View style={[styles.micRing, { opacity: pulse, transform: [{ scale: pulse }] }]} />
      <View style={styles.micCircle}>
        <Text style={styles.micEmoji}>🎙</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function RecitationMockup({ navigation }) {
  const { addMistake } = useMockup();
  const db = useSQLiteContext();
  const [activeIdx, setActiveIdx] = useState(0);
  const [confirmedStatuses, setConfirmedStatuses] = useState({});
  const [mistakeMsg, setMistakeMsg] = useState(null);
  const [page, setPage] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    const ayahNumber = MOCK_START_AYAH + activeIdx;
    getPageForAyah(db, MOCK_SURAH, ayahNumber)
      .then((p) => { if (p != null) setPage(p); })
      .catch(() => {});
  }, [db, activeIdx]);

  const ayahStatuses = { ...confirmedStatuses };
  ayahStatuses[`${MOCK_SURAH}:${MOCK_START_AYAH + activeIdx}`] = { wrongIndices: [], cue: true };

  const handleMicTap = () => {
    const ayahNumber = MOCK_START_AYAH + activeIdx;
    setConfirmedStatuses((prev) => ({
      ...prev,
      [`${MOCK_SURAH}:${ayahNumber}`]: { wrongIndices: [] },
    }));
    setMistakeMsg(null);

    if (activeIdx < TOTAL_AYAHS - 1) {
      setActiveIdx((i) => i + 1);
    } else {
      navigation.navigate('MockupTransition', {
        title: 'Recap time',
        subtitle: 'Almost done.',
        nextScreen: 'MockupPostSession',
        delay: 2000,
      });
    }
  };

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Recitation Portion</Text>
        <Text style={styles.headerSub}>Al-Mulk · Ayahs {MOCK_START_AYAH}–{MOCK_END_AYAH}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(activeIdx / TOTAL_AYAHS) * 100}%` }]} />
      </View>

      <View style={styles.mushafArea}>
        {page != null && (
          <MushafPage pageNumber={page} ayahStatuses={ayahStatuses} />
        )}
      </View>

      <View style={styles.hintPanel}>
        {mistakeMsg
          ? <Text style={styles.mistakeBannerText}>⚠ {mistakeMsg}</Text>
          : <Text style={styles.hintText}>Recite from the grey ayah</Text>
        }
      </View>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.sideBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.sideBtnText}>✕ Pause</Text>
        </TouchableOpacity>
        <View style={styles.micCol}>
          <MicPulse onPress={handleMicTap} />
          <TouchableOpacity
            onPress={() => navigation.navigate('MockupTransition', { title: 'Recap time', subtitle: 'Almost done.', nextScreen: 'MockupPostSession', delay: 2000 })}
            activeOpacity={0.7}
          >
            <Text style={styles.skipText}>Skip to recap</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[styles.sideBtn, styles.revealSideBtn]} activeOpacity={0.8}>
          <Text style={styles.revealBtnText}>Reveal</Text>
        </TouchableOpacity>
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
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.lg, paddingTop: 10, paddingBottom: 32,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d4c9a8', backgroundColor: C.white,
  },
  sideBtn: {
    backgroundColor: 'rgba(6,21,44,0.07)', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  sideBtnText: { fontFamily: F.medium, fontSize: 13, color: C.navyMid },
  revealSideBtn: { backgroundColor: C.goldLight },
  revealBtnText: { fontFamily: F.semiBold, fontSize: 13, color: C.brown },
  micWrap: { alignItems: 'center', justifyContent: 'center', width: 48, height: 48 },
  micRing: {
    position: 'absolute', width: 42, height: 42,
    borderRadius: 21, backgroundColor: C.cobaltDim,
  },
  micCircle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.cobalt, alignItems: 'center', justifyContent: 'center',
  },
  micEmoji: { fontSize: 16 },
  micCol: { alignItems: 'center', gap: 6 },
  skipText: { fontFamily: F.regular, fontSize: 11, color: C.navyLight },
  hintPanel: { paddingVertical: 8, paddingHorizontal: S.lg },
  hintText: { fontFamily: F.regular, fontSize: 13, color: C.navyLight, textAlign: 'center' },
  mistakeBannerText: { fontFamily: F.medium, fontSize: 13, color: '#C62828', textAlign: 'center' },
});
