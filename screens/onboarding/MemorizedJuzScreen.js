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
import OnboardingProgressDots from '../../components/OnboardingProgressDots';
import { getCurrentUserId } from '../../lib/auth';
import { JUZ_DATA, getJuzRangeLabel, getJuzSurahRange } from '../../lib/juzSurahMap';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../lib/theme';

const JUZ_NUMBERS = Array.from({ length: 30 }, (_, i) => i + 1);

function Checkbox({ checked, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.checkbox, checked && styles.checkboxChecked]} activeOpacity={0.7}>
      {checked ? <Text style={styles.checkboxTick}>✓</Text> : null}
    </TouchableOpacity>
  );
}

function HalfCheckbox({ onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.checkbox, styles.halfCheckbox]} activeOpacity={0.7}>
      <View style={styles.halfFill} />
    </TouchableOpacity>
  );
}

function Chevron({ expanded }) {
  return <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>;
}

export default function MemorizedJuzScreen({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  // Set of juz numbers selected as fully memorized
  const [fullJuz, setFullJuz] = useState(new Set());
  // Set of juz numbers whose surah list is expanded
  const [expandedJuz, setExpandedJuz] = useState(new Set());
  // Set of keys `${juzNumber}-${surahNumber}` selected as fully memorized
  const [fullSurah, setFullSurah] = useState(new Set());
  // Set of surah keys whose ayah picker is expanded
  const [expandedSurah, setExpandedSurah] = useState(new Set());
  // Map surahKey → number (the "up to ayah" slider value)
  const [ayahUpTo, setAyahUpTo] = useState({});

  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, [opacity]);

  const toggleFullJuz = (juzNumber) => {
    setFullJuz((prev) => {
      const next = new Set(prev);
      if (next.has(juzNumber)) {
        next.delete(juzNumber);
      } else {
        next.add(juzNumber);
        // Collapse when marking full — no need to show surahs
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

  const setAyahForKey = (surahKey, value) => {
    setAyahUpTo((prev) => ({ ...prev, [surahKey]: value }));
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

  const hasSelection =
    fullJuz.size > 0 ||
    fullSurah.size > 0 ||
    Object.keys(ayahUpTo).length > 0;

  const handleContinue = async () => {
    setError('');
    if (!hasSelection) { setError('Please select at least one juz, surah, or ayah range.'); return; }

    setIsSaving(true);
    try {
      const userId = await getCurrentUserId();
      const savedJuzProgress = new Set();

      const upsertJuzProgress = async (juzNumber) => {
        if (savedJuzProgress.has(juzNumber)) return;
        savedJuzProgress.add(juzNumber);
        const { error: e } = await supabase.from('juz_progress').upsert(
          // No portion size written here. This screen runs before the app has
          // asked how many minutes they have, so any number set now is a guess.
          // It used to write 7, which then overrode the real calculation for
          // ever: someone asking for 30 minutes got a 90-second session, every
          // day. Portion size is derived from session_minutes and their pace
          // each time getTodayPortion() runs.
          { user_id: userId, juz_number: juzNumber, pass_mistakes: 0, first_pass_complete: false },
          { onConflict: 'user_id,juz_number' }
        );
        if (e) throw new Error(e.message);
      };

      const insertPortion = async (juzNumber, surah_start, ayah_start, surah_end, ayah_end) => {
        await upsertJuzProgress(juzNumber);
        const { error: e } = await supabase.from('memorized_portions').insert(
          { user_id: userId, juz_number: juzNumber, surah_start, ayah_start, surah_end, ayah_end }
        );
        if (e) throw new Error(e.message);
      };

      // Full juzaat
      for (const juzNumber of fullJuz) {
        const range = getJuzSurahRange(juzNumber);
        await insertPortion(juzNumber, range.surah_start, range.ayah_start, range.surah_end, range.ayah_end);
      }

      // Full surahs (within non-full juzaat)
      for (const surahKey of fullSurah) {
        const [juzStr, surahStr] = surahKey.split('-');
        const juzNumber = parseInt(juzStr);
        if (fullJuz.has(juzNumber)) continue; // already covered
        const seg = JUZ_DATA[juzNumber - 1]?.surahs.find((s) => s.surahNumber === parseInt(surahStr));
        if (!seg) continue;
        await insertPortion(juzNumber, seg.surahNumber, seg.startAyah, seg.surahNumber, seg.endAyah);
      }

      // Partial ayah ranges
      for (const [surahKey, ayahNum] of Object.entries(ayahUpTo)) {
        const [juzStr, surahStr] = surahKey.split('-');
        const juzNumber = parseInt(juzStr);
        if (fullJuz.has(juzNumber) || fullSurah.has(surahKey)) continue;
        const seg = JUZ_DATA[juzNumber - 1]?.surahs.find((s) => s.surahNumber === parseInt(surahStr));
        if (!seg) continue;
        await insertPortion(juzNumber, seg.surahNumber, seg.startAyah, seg.surahNumber, ayahNum);
      }

      navigation.navigate('Time', { name });
    } catch (err) {
      setError(err.message ?? 'Failed to save your selection.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <OnboardingProgressDots current={2} total={7} />
        <Text style={styles.step}>Step 3 of 7</Text>
        <Text style={styles.question}>What have you memorized, {name}?</Text>
        <Text style={styles.sub}>Check a juz to mark it fully memorized, or expand it to select surahs and ayahs.</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
                              onValueChange={(v) => setAyahForKey(surahKey, v)}
                              minimumTrackTintColor={colors.primary}
                              maximumTrackTintColor={colors.border}
                              thumbTintColor={colors.primary}
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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, !hasSelection && styles.primaryBtnDisabled]}
          onPress={handleContinue}
          activeOpacity={0.88}
          disabled={!hasSelection || isSaving}
        >
          <Text style={styles.primaryBtnText}>{isSaving ? 'Saving…' : 'Continue'}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: 64, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backBtn: { paddingBottom: spacing.sm, alignSelf: 'flex-start' },
  backBtnText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textMid },
  step: {
    fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm,
  },
  question: {
    fontFamily: fonts.semiBold, fontSize: 26, color: colors.text,
    letterSpacing: -0.3, marginBottom: spacing.sm, lineHeight: 34,
  },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMid, lineHeight: 21 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: 6 },

  selectAllRow: { marginBottom: 0 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },

  juzRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.sm,
    borderWidth: 1.5, borderColor: colors.border,
    paddingVertical: 12, paddingHorizontal: spacing.md,
  },
  surahRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.sm,
    borderWidth: 1.5, borderColor: colors.border,
    paddingVertical: 10, paddingHorizontal: spacing.md,
    marginLeft: 28, marginTop: 4,
  },
  rowSelected: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  rowBody: { flex: 1, marginHorizontal: 10 },
  juzLabel: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text },
  surahLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  labelSelected: { color: colors.primary },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  subSelected: { color: colors.primary },
  chevronBtn: { paddingHorizontal: 4 },
  chevron: { fontSize: 16, color: colors.textMuted },
  checkbox: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.textMuted,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
  },
  checkboxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkboxTick: { fontSize: 13, color: colors.white, fontWeight: '700', lineHeight: 15 },
  halfCheckbox: { borderColor: colors.primary, backgroundColor: colors.card, overflow: 'hidden' },
  halfFill: { position: 'absolute', right: 0, top: 0, width: 11, height: 22, backgroundColor: colors.primary },
  rowPartial: { borderColor: colors.cobaltLight, backgroundColor: 'rgba(26,61,138,0.04)' },
  ayahRow: { marginLeft: 56, marginRight: spacing.md, marginTop: 4, marginBottom: 4 },
  ayahHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  ayahLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMid },
  ayahValue: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.primary },
  slider: { width: '100%', height: 36 },
  error: { color: colors.error, fontSize: 13, textAlign: 'center', paddingHorizontal: spacing.lg, marginBottom: 4 },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: 48, paddingTop: spacing.md },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 17, alignItems: 'center' },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
});
