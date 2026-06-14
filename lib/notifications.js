import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ANDROID_CHANNEL_ID = 'daily-revision';
const OVERDUE_NOTIFICATION_ID = 'overdue-reminder';

async function ensureAndroidChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Daily revision reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

/**
 * Request push permissions and return the Expo push token on a physical device.
 *
 * @returns {Promise<string | null>}
 */
export async function registerForPushNotifications() {
  if (!Device.isDevice) {
    return null;
  }

  await ensureAndroidChannel();

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const tokenResponse = await Notifications.getExpoPushTokenAsync();
  return tokenResponse.data;
}

function buildDailyTrigger(hour, minute) {
  const trigger = {
    type: Notifications.SchedulableTriggerInputTypes.DAILY,
    hour: hour % 24,
    minute,
  };

  if (Platform.OS === 'android') {
    trigger.channelId = ANDROID_CHANNEL_ID;
  }

  return trigger;
}

/**
 * Schedule three daily local notifications at the chosen time and +2 / +4 hours.
 *
 * @param {number} hour 0–23
 * @param {number} minute 0–59
 * @param {string | null} surahName
 * @param {number | null} startAyah
 * @param {number | null} endAyah
 * @returns {Promise<string[]>} notification identifiers
 */
export async function scheduleDailyNotification(
  hour,
  minute,
  surahName,
  startAyah,
  endAyah
) {
  await cancelAllNotifications();
  await ensureAndroidChannel();

  const reminders = surahName
    ? [
        {
          hourOffset: 0,
          title: 'Time for your hifz revision',
          body: `Today's portion: ${surahName}, Ayahs ${startAyah}–${endAyah}`,
        },
        {
          hourOffset: 2,
          title: "Don't forget your hifz revision",
          body: "You haven't revised yet today. It only takes a few minutes.",
        },
        {
          hourOffset: 4,
          title: 'Last reminder for today',
          body: 'Complete your revision before the day ends.',
        },
      ]
    : [
        {
          hourOffset: 0,
          title: 'Time for your hifz revision',
          body: 'You have ayahs due for review today.',
        },
        {
          hourOffset: 2,
          title: "Don't forget your hifz revision",
          body: 'Your quiz items are waiting.',
        },
        {
          hourOffset: 4,
          title: 'Last reminder for today',
          body: 'Complete your revision before the day ends.',
        },
      ];

  const identifiers = [];

  for (const reminder of reminders) {
    const reminderHour = (hour + reminder.hourOffset) % 24;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: reminder.title,
        body: reminder.body,
      },
      trigger: buildDailyTrigger(reminderHour, minute),
    });
    identifiers.push(id);
  }

  return identifiers;
}

/** Cancel all scheduled local notifications. */
export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * One-time reminder when a scheduled portion rolled forward from a past date.
 *
 * @returns {Promise<string>} notification identifier
 */
export async function scheduleOverdueNotification() {
  await Notifications.cancelScheduledNotificationAsync(OVERDUE_NOTIFICATION_ID);
  await ensureAndroidChannel();

  const trigger = {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: 60,
  };
  if (Platform.OS === 'android') {
    trigger.channelId = ANDROID_CHANNEL_ID;
  }

  return Notifications.scheduleNotificationAsync({
    identifier: OVERDUE_NOTIFICATION_ID,
    content: {
      title: "You missed yesterday's revision",
      body: 'Pick up where you left off — your portion is waiting.',
    },
    trigger,
  });
}
