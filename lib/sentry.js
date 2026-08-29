import * as Sentry from '@sentry/react-native';

// Instruments screen transitions. Registered with the NavigationContainer in App.js.
export const navigationIntegration = Sentry.reactNavigationIntegration();

// Runs at import time so it is initialised before any other app module loads.
Sentry.init({
  dsn: 'https://84b148338d24adfb6ddf01c3dd1c8f31@o4511995984805888.ingest.us.sentry.io/4511995994570752',

  // Beta users are anonymous, so no IP or user context is attached to events.
  sendDefaultPii: false,

  enableLogs: true,

  // Sample a fifth of sessions to keep the free-plan quota usable.
  tracesSampleRate: 0.2,

  integrations: [navigationIntegration, Sentry.feedbackIntegration()],
});
