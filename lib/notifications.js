import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ANDROID_CHANNEL_ID = 'daily-revision';
const DAILY_REMINDER_ID = 'daily-reminder';
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

/**
 * Read the permission without asking for it.
 *
 * This used to call requestPermissionsAsync, which meant any code path that
 * scheduled something could raise the iOS dialog. The evening nudge is
 * scheduled from the Today screen on load, so opening the app could ask for
 * notification permission out of nowhere. Asking belongs at the two places
 * where someone has actually opted in: onboarding, and the reminder switch.
 */
async function hasPermission() {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
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
 *
 * Returns false when permission is refused, rather than scheduling into the
 * void, so a refusal cannot produce a reminder that is queued, never delivered
 * and never reported.
 *
 * Cancels its own identifier first, so calling it repeatedly cannot stack
 * duplicates. Expo does not document scheduling over an existing identifier as
 * a replacement, so the cancel is explicit rather than assumed.
 *
 * @returns {Promise<boolean>} whether a reminder is now scheduled
 */
export async function scheduleDailyNotification(hour, minute) {
  const granted = await hasPermission();
  if (!granted) return false;

  // Cancels its own reminder, not everything. This used to call
  // cancelAllNotifications, so saving the reminder screen destroyed the
  // evening nudge that the Today screen had already scheduled for that day.
  await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID);
  await ensureAndroidChannel();

  const trigger = {
    type: Notifications.SchedulableTriggerInputTypes.DAILY,
    hour: hour % 24,
    minute,
  };
  if (Platform.OS === 'android') {
    trigger.channelId = ANDROID_CHANNEL_ID;
  }

  // The app has been called Dawrah since the rename; this still said HifzApp's
  // name, which is what a tester would have seen on their lock screen.
  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_REMINDER_ID,
    content: {
      title: 'Dawrah',
      body: 'Time to revise. Your portion is ready.',
    },
    trigger,
  });
  return true;
}

/**
 * Take the daily reminder away without touching anything else.
 *
 * Used on a day whose next day holds nothing: no portion due and no review
 * waiting. A reminder then is a notification asking someone to open an app that
 * has nothing for them, which is how people learn to ignore reminders.
 */
export async function cancelDailyNotification() {
  await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID);
}

/**
 * Schedule a one-time 8pm nudge for today, only if we're still before 8pm.
 * Replaces any previously scheduled nudge.
 * Call this on app load when today's session is not yet complete.
 */
export async function scheduleEveningNudge(isOverdue = false) {
  if (!(await hasPermission())) return null;
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
    content: { title: 'Dawrah', body },
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
  if (!(await hasPermission())) return null;
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

