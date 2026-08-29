import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The project a build is allowed to talk to when it is not a dev build.
 *
 * Which database the app uses is baked in from .env at the moment the bundle
 * is built, and nothing in the build states it. A release build therefore
 * inherits whatever the machine happened to be pointed at, silently. That is
 * fine while there is one database and dangerous the moment there are two:
 * a build shipped to testers while .env pointed somewhere else would write
 * their recitation into the wrong place, and nobody would find out until
 * somebody's progress went missing.
 *
 * Update this deliberately when the production project changes. Having to
 * edit it is the point.
 */
const PRODUCTION_PROJECT_REF = 'pcjmmogbjohtvnmrupya';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase is not configured. EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY must both be set in .env before the ' +
      'bundle is built. Without them, every request fails later with an ' +
      'error that says nothing about the real cause.'
  );
}

if (!__DEV__ && !supabaseUrl.includes(PRODUCTION_PROJECT_REF)) {
  throw new Error(
    `This build points at ${supabaseUrl}, which is not the production ` +
      `project (${PRODUCTION_PROJECT_REF}). Refusing to start rather than ` +
      'write real people\'s data somewhere it does not belong. Check .env ' +
      'and rebuild.'
  );
}

if (__DEV__) {
  // Says out loud which database this build is talking to, so it is never a
  // thing you have to remember or infer.
  console.log(`[supabase] connected to ${supabaseUrl}`);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE returns an auth code in the redirect URL's query string, which is
    // simpler to parse on native than the implicit flow's hash-fragment tokens.
    flowType: 'pkce',
  },
});

// Supabase's token auto-refresh timer only runs while this fires; without it,
// a backgrounded app's session silently expires instead of refreshing.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
