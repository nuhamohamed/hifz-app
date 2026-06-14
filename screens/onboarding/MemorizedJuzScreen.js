import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getCurrentUserId } from '../../lib/auth';
import { getJuzSurahRange } from '../../lib/juzSurahMap';
import { supabase } from '../../lib/supabase';

const JUZ_NUMBERS = Array.from({ length: 30 }, (_, i) => i + 1);

export default function MemorizedJuzScreen({ navigation }) {
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const toggleJuz = (juzNumber) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(juzNumber)) {
        next.delete(juzNumber);
      } else {
        next.add(juzNumber);
      }
      return next;
    });
  };

  const handleContinue = async () => {
    setError('');
    setIsSaving(true);

    try {
      const userId = await getCurrentUserId();

      for (const juzNumber of selected) {
        const range = getJuzSurahRange(juzNumber);

        const { error: progressError } = await supabase
          .from('juz_progress')
          .upsert(
            {
              user_id: userId,
              juz_number: juzNumber,
              cumulative_tier2_mistakes: 0,
              gate_passed: false,
              current_portion_ayahs: 7,
            },
            { onConflict: 'user_id,juz_number' }
          );

        if (progressError) {
          throw new Error(progressError.message);
        }

        const { error: memorizedError } = await supabase
          .from('memorized_portions')
          .insert({
            user_id: userId,
            juz_number: juzNumber,
            surah_start: range.surah_start,
            ayah_start: range.ayah_start,
            surah_end: range.surah_end,
            ayah_end: range.ayah_end,
          });

        if (memorizedError) {
          throw new Error(memorizedError.message);
        }
      }

      navigation.navigate('Schedule');
    } catch (err) {
      setError(err.message ?? 'Failed to save your selection.');
    } finally {
      setIsSaving(false);
    }
  };

  const hasSelection = selected.size > 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>What have you memorized?</Text>
      <Text style={styles.subtitle}>Select every juz you have memorized</Text>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {JUZ_NUMBERS.map((juzNumber) => {
          const isSelected = selected.has(juzNumber);
          return (
            <TouchableOpacity
              key={juzNumber}
              style={[styles.row, isSelected && styles.rowSelected]}
              onPress={() => toggleJuz(juzNumber)}
              activeOpacity={0.7}
            >
              <Text
                style={[styles.rowText, isSelected && styles.rowTextSelected]}
              >
                Juz {juzNumber}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isSaving ? (
        <ActivityIndicator size="large" color="#2e7d32" />
      ) : (
        <TouchableOpacity
          style={[
            styles.continueButton,
            !hasSelection && styles.continueButtonDisabled,
          ]}
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
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 64,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1b1b1b',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    marginBottom: 20,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  row: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#fafafa',
  },
  rowSelected: {
    borderColor: '#2e7d32',
    backgroundColor: '#e8f5e9',
  },
  rowText: {
    fontSize: 17,
    color: '#333',
  },
  rowTextSelected: {
    color: '#1b5e20',
    fontWeight: '600',
  },
  error: {
    color: '#c62828',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  continueButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  continueButtonDisabled: {
    opacity: 0.45,
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
