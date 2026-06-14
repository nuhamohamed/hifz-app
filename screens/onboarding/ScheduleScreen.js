import { useState } from 'react';
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
import { CommonActions, useNavigation } from '@react-navigation/native';
import { getCurrentUserId } from '../../lib/auth';
import { scheduleDailyNotification } from '../../lib/notifications';
import { supabase } from '../../lib/supabase';

function formatNotificationTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}:00`;
}

function getDefaultReminderTime() {
  const date = new Date();
  date.setHours(8, 0, 0, 0);
  return date;
}

export default function ScheduleScreen() {
  const navigation = useNavigation();
  const [sessionMinutes, setSessionMinutes] = useState(30);
  const [reminderTime, setReminderTime] = useState(getDefaultReminderTime);
  const [showTimePicker, setShowTimePicker] = useState(Platform.OS === 'ios');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const onTimeChange = (_event, selectedDate) => {
    if (Platform.OS === 'android') {
      setShowTimePicker(false);
    }
    if (selectedDate) {
      setReminderTime(selectedDate);
    }
  };

  const formatTimeDisplay = (date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
  };

  const handleStartPlan = async () => {
    setError('');
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

      if (updateError) {
        throw new Error(updateError.message);
      }

      await scheduleDailyNotification(
        reminderTime.getHours(),
        reminderTime.getMinutes(),
        null,
        null,
        null
      );

      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Today' }],
        })
      );
    } catch (err) {
      setError(err.message ?? 'Failed to start your plan.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your schedule</Text>

      <Text style={styles.label}>How long is each session?</Text>
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

      <Text style={[styles.label, styles.labelSpaced]}>
        What time should we remind you?
      </Text>

      {Platform.OS === 'android' ? (
        <TouchableOpacity
          style={styles.timeButton}
          onPress={() => setShowTimePicker(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.timeButtonText}>
            {formatTimeDisplay(reminderTime)}
          </Text>
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

      {isSaving ? (
        <ActivityIndicator
          size="large"
          color="#2e7d32"
          style={styles.loader}
        />
      ) : (
        <TouchableOpacity
          style={styles.startButton}
          onPress={handleStartPlan}
          activeOpacity={0.8}
        >
          <Text style={styles.startButtonText}>Start my plan</Text>
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
  loader: {
    marginTop: 24,
  },
  startButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 'auto',
  },
  startButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
