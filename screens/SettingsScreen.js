import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Slider from '@react-native-community/slider';
import { useNavigation } from '@react-navigation/native';
import { getCurrentUserId } from '../lib/auth';
import { scheduleDailyNotification } from '../lib/notifications';
import { supabase } from '../lib/supabase';

function formatNotificationTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}:00`;
}

function formatTimeDisplay(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
}

export default function SettingsScreen() {
  const navigation = useNavigation();
  const [sessionMinutes, setSessionMinutes] = useState(30);
  const [reminderTime, setReminderTime] = useState(() => {
    const d = new Date();
    d.setHours(8, 0, 0, 0);
    return d;
  });
  const [showTimePicker, setShowTimePicker] = useState(Platform.OS === 'ios');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const userId = await getCurrentUserId();
        const { data, error: fetchError } = await supabase
          .from('users')
          .select('session_minutes, notification_time')
          .eq('id', userId)
          .maybeSingle();

        if (fetchError) throw new Error(fetchError.message);

        if (data?.session_minutes) {
          setSessionMinutes(data.session_minutes);
        }
        if (data?.notification_time) {
          const [h, m] = data.notification_time.split(':').map(Number);
          const d = new Date();
          d.setHours(h, m, 0, 0);
          setReminderTime(d);
        }
      } catch (err) {
        setError(err.message ?? 'Failed to load settings.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const onTimeChange = (_event, selectedDate) => {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (selectedDate) setReminderTime(selectedDate);
  };

  const handleSave = async () => {
    setError('');
    setSaved(false);
    setIsSaving(true);
    try {
      const userId = await getCurrentUserId();

      const { error: updateError } = await supabase
        .from('users')
        .update({
          session_minutes: sessionMinutes,
          notification_time: formatNotificationTime(reminderTime),
        })
        .eq('id', userId);

      if (updateError) throw new Error(updateError.message);

      await scheduleDailyNotification(
        reminderTime.getHours(),
        reminderTime.getMinutes()
      );

      setSaved(true);
    } catch (err) {
      setError(err.message ?? 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2e7d32" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Edit Settings</Text>

      <Text style={styles.label}>Session length</Text>
      <Text style={styles.valueText}>{sessionMinutes} minutes</Text>
      <Slider
        style={styles.slider}
        minimumValue={15}
        maximumValue={120}
        step={5}
        value={sessionMinutes}
        onValueChange={setSessionMinutes}
        minimumTrackTintColor="#2e7d32"
        maximumTrackTintColor="#e0e0e0"
        thumbTintColor="#2e7d32"
      />
      <View style={styles.sliderLabels}>
        <Text style={styles.sliderLabel}>15 min</Text>
        <Text style={styles.sliderLabel}>120 min</Text>
      </View>

      <Text style={[styles.label, styles.labelSpaced]}>Daily reminder</Text>

      {Platform.OS === 'android' ? (
        <TouchableOpacity
          style={styles.timeButton}
          onPress={() => setShowTimePicker(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.timeButtonText}>{formatTimeDisplay(reminderTime)}</Text>
        </TouchableOpacity>
      ) : null}

      {showTimePicker ? (
        <DateTimePicker
          value={reminderTime}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onTimeChange}
        />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saved ? <Text style={styles.savedText}>Saved.</Text> : null}

      {isSaving ? (
        <ActivityIndicator size="large" color="#2e7d32" style={styles.loader} />
      ) : (
        <TouchableOpacity
          style={styles.saveButton}
          onPress={handleSave}
          activeOpacity={0.8}
        >
          <Text style={styles.saveButtonText}>Save</Text>
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
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  backButton: {
    marginBottom: 16,
  },
  backButtonText: {
    fontSize: 16,
    color: '#2e7d32',
    fontWeight: '600',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1b1b1b',
    marginBottom: 32,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  labelSpaced: {
    marginTop: 28,
  },
  valueText: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1b5e20',
    marginBottom: 8,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sliderLabel: {
    fontSize: 13,
    color: '#757575',
  },
  timeButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#2e7d32',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  timeButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1b5e20',
  },
  error: {
    color: '#c62828',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  savedText: {
    color: '#2e7d32',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
    fontWeight: '600',
  },
  loader: {
    marginTop: 24,
  },
  saveButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 'auto',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
