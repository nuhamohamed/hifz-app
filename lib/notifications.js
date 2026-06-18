import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ANDROID_CHANNEL_ID = 'daily-revision';
const EVENING_NUDGE_ID = 'evening-nudge';
const EVENING_NUDGE_HOUR = 20; // 8pm

const EVENING_NUDGE_MESSAGES = [
  "The day isn't over yet. A few minutes is all it takes.",
  "Still time to revise. You got this.",
];

async function ensureAndroidChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Daily revision reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

async function ensurePermissions() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    const { status: newStatus } = await Notifications.requestPermissionsAsync();
    if (newStatus !== 'granted') {
      console.warn('[Notifications] Permission not granted');
      return false;
    }
  }
  return true;
}

/**
 * Request push permissions and return the Expo push token on a physical device.
 * @returns {Promise<string | null>}
 */
export async function registerForPushNotifications() {
  if (!Device.isDevice) return null;

  await ensureAndroidChannel();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const tokenResponse = await Notifications.getExpoPushTokenAsync();
  return tokenResponse.data;
}

/**
 * Schedule the single daily reminder at the user's chosen time.
 * Cancels all existing notifications first.
 */
export async function scheduleDailyNotification(hour, minute) {
  await ensurePermissions();
  await cancelAllNotifications();
  await ensureAndroidChannel();

  const trigger = {
    type: Notifications.SchedulableTriggerInputTypes.DAILY,
    hour: hour % 24,
    minute,
  };
  if (Platform.OS === 'android') {
    trigger.channelId = ANDROID_CHANNEL_ID;
  }

  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Hifz Revision',
      body: '⏰ Time for your Quran revision. Start now.',
    },
    trigger,
  });
}

/**
 * Schedule a one-time 8pm nudge for today, only if we're still before 8pm.
 * Replaces any previously scheduled nudge.
 * Call this on app load when today's session is not yet complete.
 */
export async function scheduleEveningNudge(isOverdue = false) {
  await ensurePermissions();
  await Notifications.cancelScheduledNotificationAsync(EVENING_NUDGE_ID);
  await ensureAndroidChannel();

  const now = new Date();
  const evening = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    EVENING_NUDGE_HOUR,
    0,
    0
  );

  if (now >= evening) return null;

  const body = isOverdue
    ? "You missed yesterday's revision, but you still have today. Start now."
    : EVENING_NUDGE_MESSAGES[Math.floor(Math.random() * EVENING_NUDGE_MESSAGES.length)];

  const trigger = {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: evening,
  };
  if (Platform.OS === 'android') {
    trigger.channelId = ANDROID_CHANNEL_ID;
  }

  return Notifications.scheduleNotificationAsync({
    identifier: EVENING_NUDGE_ID,
    content: { title: 'Hifz Revision', body },
    trigger,
  });
}

/**
 * Cancel the 8pm nudge — call this when the session is marked complete.
 */
export async function cancelEveningNudge() {
  await Notifications.cancelScheduledNotificationAsync(EVENING_NUDGE_ID);
}

/**
 * Fire a test notification after 5 seconds — dev only.
 */
export async function scheduleTestNotification(title, body) {
  await ensurePermissions();
  await ensureAndroidChannel();
  const trigger = {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: 5,
  };
  if (Platform.OS === 'android') trigger.channelId = ANDROID_CHANNEL_ID;
  return Notifications.scheduleNotificationAsync({ content: { title, body }, trigger });
}

/** Cancel all scheduled local notifications. */
export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

