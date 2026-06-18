import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { getCurrentUserId } from '../../lib/auth';
import { JUZ_DATA, getJuzRangeLabel, getJuzSurahRange } from '../../lib/juzSurahMap';
import { supabase } from '../../lib/supabase';

const JUZ_NUMBERS = Array.from({ length: 30 }, (_, i) => i + 1);

function Checkbox({ checked, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.checkbox} activeOpacity={0.7}>
      {checked ? <Text style={styles.checkboxTick}>✓</Text> : null}
    </TouchableOpacity>
  );
}

function Chevron({ expanded }) {
  return <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>;
}

export default function MemorizedJuzScreen({ navigation }) {
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

  const hasSelection =
    fullJuz.size > 0 ||
    fullSurah.size > 0 ||
    Object.keys(ayahUpTo).length > 0;

  const validate = () => null; // slider values are always in range

  const handleContinue = async () => {
    setError('');
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    if (!hasSelection) { setError('Please select at least one juz, surah, or ayah range.'); return; }

    setIsSaving(true);
    try {
      const userId = await getCurrentUserId();
      const savedJuzProgress = new Set();

      const upsertJuzProgress = async (juzNumber) => {
        if (savedJuzProgress.has(juzNumber)) return;
        savedJuzProgress.add(juzNumber);
        const { error: e } = await supabase.from('juz_progress').upsert(
          { user_id: userId, juz_number: juzNumber, cumulative_tier2_mistakes: 0, gate_passed: false, current_portion_ayahs: 7 },
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

      navigation.navigate('Schedule');
    } catch (err) {
      setError(err.message ?? 'Failed to save your selection.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>What have you memorized?</Text>
      <Text style={styles.subtitle}>
        Check a juz to mark it fully memorized, or expand it to select surahs and ayahs.
      </Text>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {JUZ_NUMBERS.map((juzNumber) => {
          const isFull = fullJuz.has(juzNumber);
          const isExpanded = expandedJuz.has(juzNumber);
          const juzData = JUZ_DATA[juzNumber - 1];

          return (
            <View key={juzNumber}>
              {/* Juz row */}
              <View style={[styles.row, isFull && styles.rowSelected]}>
                <Checkbox checked={isFull} onPress={() => toggleFullJuz(juzNumber)} />
                <View style={styles.rowBody}>
                  <Text style={[styles.rowTitle, isFull && styles.rowTitleSelected]}>
                    Juz {juzNumber}
                  </Text>
                  <Text style={[styles.rowSub, isFull && styles.rowSubSelected]}>
                    {getJuzRangeLabel(juzNumber)}
                  </Text>
                </View>
                {!isFull ? (
                  <TouchableOpacity onPress={() => toggleExpandJuz(juzNumber)} style={styles.chevronBtn} activeOpacity={0.7}>
                    <Chevron expanded={isExpanded} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Surah rows */}
              {!isFull && isExpanded
                ? juzData.surahs.map((seg) => {
                    const surahKey = `${juzNumber}-${seg.surahNumber}`;
                    const isSurahFull = fullSurah.has(surahKey);
                    const isSurahExpanded = expandedSurah.has(surahKey);
                    const ayahVal = ayahUpTo[surahKey] ?? '';

                    return (
                      <View key={surahKey}>
                        <View style={[styles.surahRow, isSurahFull && styles.surahRowSelected]}>
                          <Checkbox checked={isSurahFull} onPress={() => toggleFullSurah(surahKey)} />
                          <View style={styles.rowBody}>
                            <Text style={[styles.surahTitle, isSurahFull && styles.rowTitleSelected]}>
                              {seg.surahName}
                            </Text>
                            <Text style={[styles.rowSub, isSurahFull && styles.rowSubSelected]}>
                              Ayahs {seg.startAyah}–{seg.endAyah}
                            </Text>
                          </View>
                          {!isSurahFull ? (
                            <TouchableOpacity onPress={() => toggleExpandSurah(surahKey)} style={styles.chevronBtn} activeOpacity={0.7}>
                              <Chevron expanded={isSurahExpanded} />
                            </TouchableOpacity>
                          ) : null}
                        </View>

                        {/* Ayah range picker */}
                        {!isSurahFull && isSurahExpanded ? (
                          <View style={styles.ayahRow}>
                            <View style={styles.ayahHeader}>
                              <Text style={styles.ayahLabel}>Up to ayah:</Text>
                              <Text style={styles.ayahValue}>
                                {ayahVal || seg.startAyah} / {seg.endAyah}
                              </Text>
                            </View>
                            <Slider
                              style={styles.slider}
                              minimumValue={seg.startAyah}
                              maximumValue={seg.endAyah}
                              step={1}
                              value={ayahVal || seg.startAyah}
                              onValueChange={(v) => setAyahForKey(surahKey, v)}
                              minimumTrackTintColor="#2e7d32"
                              maximumTrackTintColor="#e0e0e0"
                              thumbTintColor="#2e7d32"
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

      {isSaving ? (
        <ActivityIndicator size="large" color="#2e7d32" style={styles.loader} />
      ) : (
        <TouchableOpacity
          style={[styles.continueButton, !hasSelection && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!hasSelection}
          activeOpacity={0.8}
        >
          <Text style={styles.continueButtonText}>Continue</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 64, paddingHorizontal: 24, paddingBottom: 24 },
  title: { fontSize: 26, fontWeight: '700', color: '#1b1b1b', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 20, lineHeight: 20 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 8 },

  // Juz row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    backgroundColor: '#fafafa',
  },
  rowSelected: { borderColor: '#2e7d32', backgroundColor: '#e8f5e9' },
  rowBody: { flex: 1, marginHorizontal: 10 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  rowTitleSelected: { color: '#1b5e20' },
  rowSub: { fontSize: 13, color: '#888', marginTop: 1 },
  rowSubSelected: { color: '#388e3c' },
  chevronBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  chevron: { fontSize: 16, color: '#555' },

  // Surah row (indented)
  surahRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e8e8e8',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 4,
    marginLeft: 28,
    backgroundColor: '#fff',
  },
  surahRowSelected: { borderColor: '#2e7d32', backgroundColor: '#e8f5e9' },
  surahTitle: { fontSize: 15, fontWeight: '600', color: '#333' },

  // Ayah picker (double-indented)
  ayahRow: {
    marginLeft: 56,
    marginBottom: 8,
    marginRight: 12,
  },
  ayahHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  ayahLabel: { fontSize: 13, color: '#555' },
  ayahValue: { fontSize: 13, fontWeight: '700', color: '#1b5e20' },
  slider: { width: '100%', height: 36 },

  // Checkbox (circle)
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#2e7d32',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxTick: { fontSize: 14, color: '#2e7d32', fontWeight: '700', lineHeight: 16 },

  error: { color: '#c62828', fontSize: 14, textAlign: 'center', marginBottom: 10 },
  loader: { marginBottom: 8 },
  continueButton: { backgroundColor: '#2e7d32', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  continueButtonDisabled: { opacity: 0.45 },
  continueButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
