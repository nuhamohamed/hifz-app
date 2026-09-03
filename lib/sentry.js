import * as Sentry from '@sentry/react-native';

// Instruments screen transitions. Registered with the NavigationContainer in App.js.
export const navigationIntegration = Sentry.reactNavigationIntegration();

// Runs at import time so it is initialised before any other app module loads.
Sentry.init({
  dsn: 'https://84b148338d24adfb6ddf01c3dd1c8f31@o4511995984805888.ingest.us.sentry.io/4511995994570752',

  // The SDK already derives this from __DEV__; stated explicitly so the alert
  // rules that filter on environment:production have a visible source of truth.
  environment: __DEV__ ? 'development' : 'production',

  // Beta users are anonymous, so no IP or user context is attached to events.
  sendDefaultPii: false,

  enableLogs: true,

  // Sample a fifth of sessions to keep the free-plan quota usable.
  tracesSampleRate: 0.2,

  integrations: [navigationIntegration, Sentry.feedbackIntegration()],
});

/**
 * Report an error the app handled and turned into a message on screen.
 *
 * Crashes already reach Sentry on their own: the native SDK catches native
 * ones and Sentry.wrap catches render ones. What never arrived was everything
 * caught in a try/catch — a session that would not start reached the person
 * as a line of red text and reached us not at all, so the first report of a
 * blocked session was the user telling us about it.
 *
 * `where` groups them, since the message itself is often a bare native string
 * like "Failed to start recording." shared by several unrelated causes.
 */
export function reportHandledError(where, error, extra) {
  const err = error instanceof Error ? error : new Error(String(error?.message ?? error));
  Sentry.captureException(err, {
    tags: { handled: 'true', where },
    extra: extra ?? undefined,
  });
}
