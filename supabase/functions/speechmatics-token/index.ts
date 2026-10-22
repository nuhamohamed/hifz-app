/**
 * Mints a short-lived Speechmatics token for the app.
 *
 * The long-lived API key used to be bundled into the app itself, where anyone
 * who installed Dawrah could read it and run transcription on our bill. With a
 * public TestFlight link that is potentially thousands of people, and
 * Speechmatics' own documentation says never to authenticate this way from a
 * client. The key now lives here as a server secret and never leaves.
 *
 * The app already spoke this protocol: it was minting 60-second tokens itself,
 * just doing it on the phone with the permanent key. Only that step moved. The
 * microphone and transcription code is untouched.
 *
 * Someone can still pull a token out of the app, but it expires in 60 seconds
 * and only authenticates the connection handshake.
 */

const SPEECHMATICS_KEY_URL = 'https://mp.speechmatics.com/v1/api_keys?type=rt';
const TOKEN_TTL_SECONDS = 60;

/**
 * Tokens one person may request per day. Every mic start costs one, including
 * the restart after the silence cutoff, so a real evening of revision runs to
 * twenty or more. 20 was the original figure and the first tester hit it in two
 * hours. It limits how many sessions someone can START, not how long they
 * stay: a token authenticates the connection, not its duration.
 * The 90-second silence cutoff in the app is what caps actual audio minutes,
 * and the spending cap on the Speechmatics account is the backstop under both.
 *
 * Anonymous auth means a determined person can make a fresh account for a fresh
 * allowance, so this is a speed bump rather than a wall. That is the accepted
 * trade for having no sign-in during beta.
 */
const DAILY_TOKEN_LIMIT = 200;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-local-date',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/**
 * The day to count against, as the person's phone sees it, so the allowance
 * resets at their midnight rather than at UTC midnight (8pm in New York, 4am
 * in Dubai). The app sends its local `YYYY-MM-DD`; anything malformed, or more
 * than a day from UTC, which no real time zone is, falls back to the UTC date
 * so the header cannot be used to mint extra days.
 */
function localDay(claimed: string | null): string {
  const utc = new Date().toISOString().slice(0, 10);
  if (!claimed || !/^\d{4}-\d{2}-\d{2}$/.test(claimed)) return utc;
  const offset = Math.abs(Date.parse(claimed) - Date.parse(utc)) / 86400000;
  return offset <= 1 ? claimed : utc;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const apiKey = Deno.env.get('SPEECHMATICS_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!apiKey || !supabaseUrl || !serviceKey) {
    console.error('speechmatics-token: missing environment configuration');
    return json({ error: 'Server is not configured.' }, 500);
  }

  // Only signed-in callers, which every user is: the app creates an anonymous
  // Supabase session on first launch.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Not signed in.' }, 401);
  }

  const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: serviceKey },
  });
  if (!userResp.ok) return json({ error: 'Not signed in.' }, 401);
  const user = await userResp.json();
  const userId = user?.id;
  if (!userId) return json({ error: 'Not signed in.' }, 401);

  // Count today's tokens for this person, then record this one. Uses the
  // service role because the app has no business writing its own quota rows.
  const today = localDay(req.headers.get('X-Local-Date'));
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  const countResp = await fetch(
    `${supabaseUrl}/rest/v1/transcription_tokens?user_id=eq.${userId}&issued_on=eq.${today}&select=id`,
    { headers: { ...headers, Prefer: 'count=exact' } }
  );
  const range = countResp.headers.get('content-range') ?? '*/0';
  const used = Number(range.split('/')[1] ?? 0);

  if (used >= DAILY_TOKEN_LIMIT) {
    console.warn(`speechmatics-token: ${userId} hit the daily limit`);
    return json(
      { error: 'Daily transcription limit reached. Try again tomorrow.' },
      429
    );
  }

  const smResp = await fetch(SPEECHMATICS_KEY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl: TOKEN_TTL_SECONDS }),
  });

  if (!smResp.ok) {
    console.error('speechmatics-token: exchange failed', smResp.status);
    return json({ error: 'Could not start transcription.' }, 502);
  }

  const data = await smResp.json();
  if (!data.key_value) {
    console.error('speechmatics-token: no key_value in the response');
    return json({ error: 'Could not start transcription.' }, 502);
  }

  // Recorded after the token is successfully issued, so a Speechmatics outage
  // does not eat someone's daily allowance.
  await fetch(`${supabaseUrl}/rest/v1/transcription_tokens`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: userId, issued_on: today }),
  });

  return json({ token: data.key_value, expiresIn: TOKEN_TTL_SECONDS });
});
