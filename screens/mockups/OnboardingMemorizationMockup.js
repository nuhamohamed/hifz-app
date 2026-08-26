import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { JUZ_DATA, getJuzRangeLabel } from '../../lib/juzSurahMap';
import { C, F, R, S } from './design';
import { useMockup } from './MockupContext';

const JUZ_NUMBERS = Array.from({ length: 30 }, (_, i) => i + 1);

function ProgressDots({ current, total }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.dot, i === current && styles.dotActive, i < current && styles.dotPast]} />
      ))}
    </View>
  );
}

function Checkbox({ checked, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.checkbox, checked && styles.checkboxChecked]}
      activeOpacity={0.7}
    >
      {checked ? <Text style={styles.checkboxTick}>✓</Text> : null}
    </TouchableOpacity>
  );
}

function HalfCheckbox({ onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.checkbox, styles.halfCheckbox]}
      activeOpacity={0.7}
    >
      <View style={styles.halfFill} />
    </TouchableOpacity>
  );
}

function Chevron({ expanded }) {
  return <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>;
}

export default function OnboardingMemorizationMockup({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const { updateProfile } = useMockup();
  const [fullJuz, setFullJuz] = useState(new Set());
  const [expandedJuz, setExpandedJuz] = useState(new Set());
  const [fullSurah, setFullSurah] = useState(new Set());
  const [expandedSurah, setExpandedSurah] = useState(new Set());
  const [ayahUpTo, setAyahUpTo] = useState({});
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const toggleFullJuz = (juzNumber) => {
    setFullJuz((prev) => {
      const next = new Set(prev);
      if (next.has(juzNumber)) {
        next.delete(juzNumber);
      } else {
        next.add(juzNumber);
        setExpandedJuz((e) => { const ne = new Set(e); ne.delete(juzNumber); return ne; });
      }
      return next;
    });
  };

  const toggleExpandJuz = (juzNumber) => {
    setExpandedJuz((prev) => {
      const next = new Set(prev);
      if (next.has(juzNumber)) { next.delete(juzNumber); } else { next.add(juzNumber); }
      return next;
    });
  };

  const toggleFullSurah = (surahKey) => {
    setFullSurah((prev) => {
      const next = new Set(prev);
      if (next.has(surahKey)) {
        next.delete(surahKey);
      } else {
        next.add(surahKey);
        setExpandedSurah((e) => { const ne = new Set(e); ne.delete(surahKey); return ne; });
      }
      return next;
    });
  };

  const toggleExpandSurah = (surahKey) => {
    setExpandedSurah((prev) => {
      const next = new Set(prev);
      if (next.has(surahKey)) { next.delete(surahKey); } else { next.add(surahKey); }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (fullJuz.size === 30) {
      setFullJuz(new Set());
    } else {
      setFullJuz(new Set(JUZ_NUMBERS));
      setExpandedJuz(new Set());
    }
  };

  const allSelected = fullJuz.size === 30;

  const hasPartialSelection = (juzNumber) => {
    const prefix = `${juzNumber}-`;
    for (const key of fullSurah) { if (key.startsWith(prefix)) return true; }
    for (const key of Object.keys(ayahUpTo)) { if (key.startsWith(prefix)) return true; }
    return false;
  };

  const hasSelection = fullJuz.size > 0 || fullSurah.size > 0 || Object.keys(ayahUpTo).length > 0;

  const handleContinue = () => {
    if (!hasSelection) return;
    updateProfile({
      memorizedJuz: Array.from(fullJuz),
      memorizedPartial: ayahUpTo,
    });
    navigation.navigate('MockupOnboardingTime', { name });
  };

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <ProgressDots current={1} total={6} />
        <Text style={styles.step}>Step 2 of 6</Text>
        <Text style={styles.question}>What have you memorized, {name}?</Text>
        <Text style={styles.sub}>Check a juz to mark it fully memorized, or expand it to select surahs and ayahs.</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Select All row */}
        <TouchableOpacity style={[styles.juzRow, styles.selectAllRow, allSelected && styles.rowSelected]} onPress={handleSelectAll} activeOpacity={0.8}>
          <Checkbox checked={allSelected} onPress={handleSelectAll} />
          <View style={styles.rowBody}>
            <Text style={[styles.juzLabel, allSelected && styles.labelSelected]}>
              {allSelected ? 'Deselect all' : 'Select all juz'}
            </Text>
            <Text style={[styles.rowSub, allSelected && styles.subSelected]}>
              {allSelected ? 'All 30 juz selected' : 'Juz 1–30'}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.divider} />

        {JUZ_NUMBERS.map((juzNumber) => {
          const isFull = fullJuz.has(juzNumber);
          const isExpanded = expandedJuz.has(juzNumber);
          const juzData = JUZ_DATA[juzNumber - 1];

          return (
            <View key={juzNumber}>
              <View style={[styles.juzRow, isFull && styles.rowSelected, !isFull && hasPartialSelection(juzNumber) && styles.rowPartial]}>
                {!isFull && hasPartialSelection(juzNumber)
                  ? <HalfCheckbox onPress={() => toggleExpandJuz(juzNumber)} />
                  : <Checkbox checked={isFull} onPress={() => toggleFullJuz(juzNumber)} />
                }
                <View style={styles.rowBody}>
                  <Text style={[styles.juzLabel, isFull && styles.labelSelected]}>Juz {juzNumber}</Text>
                  <Text style={[styles.rowSub, isFull && styles.subSelected]}>{getJuzRangeLabel(juzNumber)}</Text>
                </View>
                {!isFull ? (
                  <TouchableOpacity onPress={() => toggleExpandJuz(juzNumber)} style={styles.chevronBtn} activeOpacity={0.7}>
                    <Chevron expanded={isExpanded} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {!isFull && isExpanded
                ? juzData.surahs.map((seg) => {
                    const surahKey = `${juzNumber}-${seg.surahNumber}`;
                    const isSurahFull = fullSurah.has(surahKey);
                    const isSurahExpanded = expandedSurah.has(surahKey);
                    const ayahVal = ayahUpTo[surahKey] ?? seg.startAyah;

                    return (
                      <View key={surahKey}>
                        <View style={[styles.surahRow, isSurahFull && styles.rowSelected]}>
                          <Checkbox checked={isSurahFull} onPress={() => toggleFullSurah(surahKey)} />
                          <View style={styles.rowBody}>
                            <Text style={[styles.surahLabel, isSurahFull && styles.labelSelected]}>{seg.surahName}</Text>
                            <Text style={[styles.rowSub, isSurahFull && styles.subSelected]}>Ayahs {seg.startAyah}–{seg.endAyah}</Text>
                          </View>
                          {!isSurahFull ? (
                            <TouchableOpacity onPress={() => toggleExpandSurah(surahKey)} style={styles.chevronBtn} activeOpacity={0.7}>
                              <Chevron expanded={isSurahExpanded} />
                            </TouchableOpacity>
                          ) : null}
                        </View>

                        {!isSurahFull && isSurahExpanded ? (
                          <View style={styles.ayahRow}>
                            <View style={styles.ayahHeader}>
                              <Text style={styles.ayahLabel}>Up to ayah</Text>
                              <Text style={styles.ayahValue}>{ayahVal} / {seg.endAyah}</Text>
                            </View>
                            <Slider
                              style={styles.slider}
                              minimumValue={seg.startAyah}
                              maximumValue={seg.endAyah}
                              step={1}
                              value={ayahVal}
                              onValueChange={(v) => setAyahUpTo((prev) => ({ ...prev, [surahKey]: v }))}
                              minimumTrackTintColor={C.cobalt}
                              maximumTrackTintColor={C.cardBorder}
                              thumbTintColor={C.cobalt}
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                : null}
            </View>
          );
        })}
        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, !hasSelection && styles.primaryBtnDisabled]}
          onPress={handleContinue}
          activeOpacity={0.88}
          disabled={!hasSelection}
        >
          <Text style={styles.primaryBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: { paddingTop: 64, paddingHorizontal: S.lg, paddingBottom: S.md },
  backBtn: { paddingBottom: S.sm, alignSelf: 'flex-start' },
  backBtnText: { fontFamily: F.medium, fontSize: 14, color: C.navyMid },
  dots: { flexDirection: 'row', gap: 6, marginBottom: S.lg },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.navyLight, opacity: 0.3 },
  dotActive: { backgroundColor: C.cobalt, opacity: 1, width: 20 },
  dotPast: { backgroundColor: C.cobalt, opacity: 0.4 },
  step: {
    fontFamily: F.medium, fontSize: 13, color: C.navyLight,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: S.sm,
  },
  question: {
    fontFamily: F.semiBold, fontSize: 26, color: C.navy,
    letterSpacing: -0.3, marginBottom: S.sm, lineHeight: 34,
  },
  sub: { fontFamily: F.regular, fontSize: 14, color: C.navyMid, lineHeight: 21 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: S.md, gap: 6 },

  selectAllRow: { marginBottom: 0 },
  divider: { height: 1, backgroundColor: C.cardBorder, marginVertical: 8 },

  juzRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.white, borderRadius: R.sm,
    borderWidth: 1.5, borderColor: C.cardBorder,
    paddingVertical: 12, paddingHorizontal: S.md,
  },
  surahRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.white, borderRadius: R.sm,
    borderWidth: 1.5, borderColor: C.cardBorder,
    paddingVertical: 10, paddingHorizontal: S.md,
    marginLeft: 28, marginTop: 4,
  },
  rowSelected: { borderColor: C.cobalt, backgroundColor: C.cobaltDim },
  rowBody: { flex: 1, marginHorizontal: 10 },
  juzLabel: { fontFamily: F.semiBold, fontSize: 15, color: C.navy },
  surahLabel: { fontFamily: F.medium, fontSize: 14, color: C.navy },
  labelSelected: { color: C.cobalt },
  rowSub: { fontFamily: F.regular, fontSize: 12, color: C.navyLight, marginTop: 1 },
  subSelected: { color: C.cobalt },
  chevronBtn: { paddingHorizontal: 4 },
  chevron: { fontSize: 16, color: C.navyLight },
  checkbox: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: C.navyLight,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.white,
  },
  checkboxChecked: { borderColor: C.cobalt, backgroundColor: C.cobalt },
  checkboxTick: { fontSize: 13, color: C.white, fontWeight: '700', lineHeight: 15 },
  halfCheckbox: { borderColor: C.cobalt, backgroundColor: C.white, overflow: 'hidden' },
  halfFill: { position: 'absolute', right: 0, top: 0, width: 11, height: 22, backgroundColor: C.cobalt },
  rowPartial: { borderColor: C.cobaltLight, backgroundColor: 'rgba(26,61,138,0.04)' },
  ayahRow: { marginLeft: 56, marginRight: S.md, marginTop: 4, marginBottom: 4 },
  ayahHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  ayahLabel: { fontFamily: F.regular, fontSize: 12, color: C.navyMid },
  ayahValue: { fontFamily: F.semiBold, fontSize: 13, color: C.cobalt },
  slider: { width: '100%', height: 36 },
  footer: { paddingHorizontal: S.lg, paddingBottom: 48, paddingTop: S.md },
  primaryBtn: { backgroundColor: C.cobalt, borderRadius: R.md, paddingVertical: 17, alignItems: 'center' },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { fontFamily: F.semiBold, fontSize: 17, color: C.white },
});
