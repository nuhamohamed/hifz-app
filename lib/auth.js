import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

/**
 * @returns {Promise<string>} Authenticated user's UUID
 * @throws {Error} If not signed in
 */
export async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }
  if (!data.session) {
    throw new Error('Not signed in.');
  }
  return data.session.user.id;
}

/**
 * Guarantees a Supabase session exists, creating an anonymous one on first
 * launch. Anonymous users get a real auth.users row (and therefore a real
 * UUID), so every user_id-keyed table keeps working untouched. When the user
 * later signs in for real, linkGoogleAccount() upgrades this same UUID in
 * place, so their history carries over with no migration.
 * @returns {Promise<object>} The Supabase session
 */
export async function ensureSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }
  if (data.session) {
    return data.session;
  }

  const { data: anon, error: anonError } = await supabase.auth.signInAnonymously();
  if (anonError) {
    throw new Error(anonError.message);
  }
  return anon.session;
}

/**
 * True when the current session belongs to an anonymous (not yet signed-in)
 * user. Drives whether the UI offers "save your progress".
 */
export async function isAnonymous() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.is_anonymous === true;
}

// Must match `expo.scheme` in app.json and the CFBundleURLSchemes entry the
// native project registers, or the browser sheet never hands control back.
// This exact URL also has to be added to Supabase's allowed redirect URLs
// before Google sign-in can work.
const OAUTH_REDIRECT_URL = 'dawrah://auth-callback';

/**
 * Opens Google's consent screen in a browser sheet, then exchanges the
 * returned authorization code for a Supabase session. Resolves silently if
 * the user cancels the browser sheet.
 * @throws {Error} If Google or Supabase reports an error
 */
export async function signInWithGoogle() {
  // Every beta user is anonymous, and a plain OAuth sign-in would mint a NEW
  // uuid -- silently orphaning all of their sessions, mistakes and progress,
  // which are keyed on the old one. Linking keeps the uuid, so their history
  // simply becomes a Google account's history. Callers get the safe behaviour
  // without having to know which function to reach for.
  if (await isAnonymous()) {
    return linkGoogleAccount();
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: OAUTH_REDIRECT_URL,
      skipBrowserRedirect: true,
    },
  });
  if (error) {
    throw new Error(error.message);
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT_URL);
  if (result.type !== 'success' || !result.url) {
    return; // user cancelled or dismissed the sheet
  }

  const url = new URL(result.url);
  const authError = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (authError) {
    throw new Error(authError);
  }

  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('Google sign-in did not return an authorization code.');
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    throw new Error(exchangeError.message);
  }
}

/**
 * Upgrades the current anonymous user into a permanent Google account,
 * keeping the same UUID so all existing sessions, mistakes and quiz_queue
 * rows stay attached. Use this when sign-in is reintroduced -- do NOT use
 * signInWithGoogle() for an anonymous user, as that starts a fresh UUID and
 * strands their history.
 *
 * Requires "Manual linking" to be enabled in Supabase Auth settings.
 * @throws {Error} If the Google identity is already attached to another user
 */
export async function linkGoogleAccount() {
  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: {
      redirectTo: OAUTH_REDIRECT_URL,
      skipBrowserRedirect: true,
    },
  });
  if (error) {
    throw new Error(error.message);
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT_URL);
  if (result.type !== 'success' || !result.url) {
    return; // user cancelled or dismissed the sheet
  }

  const url = new URL(result.url);
  const authError = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (authError) {
    throw new Error(authError);
  }

  const code = url.searchParams.get('code');
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      throw new Error(exchangeError.message);
    }
  }

  // handle_new_user() only fires on INSERT, so public.users.email is still
  // null from the anonymous signup -- backfill it from the linked identity.
  const { data: userData } = await supabase.auth.getUser();
  const email = userData?.user?.email;
  if (email) {
    await supabase.from('users').update({ email }).eq('id', userData.user.id);
  }
}
