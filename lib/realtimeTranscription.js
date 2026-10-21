import { ExpoAudioStreamModule } from '@siteed/audio-studio';
import { Audio } from 'expo-av';
import { LegacyEventEmitter } from 'expo-modules-core';
import { normalizeArabic } from './arabicUtils';
import { alignAyahProgress } from './liveWordJudge';
import { supabase } from './supabase';
import { reportHandledError } from './sentry';

// The project URL is public by design and already in the bundle; it is the
// address of the service, not a credential. What used to be here and should
// not have been is the Speechmatics key.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

/**
 * Realtime recitation listening: streams mic PCM to Speechmatics real-time
 * STT over WebSocket and accumulates finalised transcript segments.
 *
 * Requires a development build — @siteed/audio-studio is a native module
 * and does not exist in Expo Go.
 */

/**
 * Speechmatics' own routing endpoint, which lands the connection in whichever
 * region is nearest the reciter.
 *
 * It was pointed at Europe while the people using the app are not, so every
 * quarter second of audio crossed the Atlantic and the verdict on it crossed
 * back. Measured from here on 2026-09-11: 0.37s to complete a handshake with
 * eu2, 0.11s through global routing. A temporary key is not tied to a region,
 * so this needs nothing else to change.
 */
const WS_URL = 'wss://global.rt.speechmatics.com/v2';
const SAMPLE_RATE = 16000;
/**
 * How much audio to gather before sending it.
 *
 * A quarter of a second of recitation sat on the phone before anything could
 * begin to judge it, which is a quarter second added to every mistake the app
 * reports. A tenth is still a comfortable number of messages a second and the
 * audio leaves while the word is still being said.
 */
const CHUNK_INTERVAL_MS = 100;

const emitter = new LegacyEventEmitter(ExpoAudioStreamModule);

/**
 * The last thing the native recorder said went wrong, and when.
 *
 * The module collapses every reason a start can fail into one string,
 * "Failed to start recording.", and rejects the promise with that. The reason
 * it actually had, whether the microphone input was unavailable, a call was in
 * progress, or the engine itself refused to start, it sends separately on an
 * `error` event that nothing was listening to. So a report of a session that
 * would not start named the symptom and nothing else (Sentry DAWRAH-5), and
 * there was no way to tell those causes apart from here.
 *
 * Kept with a timestamp because the event arrives just before the rejection
 * rather than with it, and a reason from a minute ago belongs to something
 * else.
 */
let lastNativeError = null;
emitter.addListener('error', (event) => {
  const message = typeof event === 'string' ? event : event?.message;
  if (!message) return;
  lastNativeError = { message, at: Date.now() };
  console.warn('[RT] native recorder error:', message);
});

/** How recently the native reason must have arrived to explain this failure. */
const NATIVE_ERROR_WINDOW_MS = 5000;

/** The native reason for a failure happening now, if it gave one. */
function recentNativeError() {
  if (!lastNativeError) return null;
  if (Date.now() - lastNativeError.at > NATIVE_ERROR_WINDOW_MS) return null;
  return lastNativeError.message;
}

/**
 * Stop listening after this long without speech, and let a tap resume.
 *
 * There was no limit of any kind: once transcription started it ran until the
 * screen closed or the app was force-quit, so a phone left on a table kept the
 * microphone open and kept billing. Speechmatics charges per minute of audio,
 * which makes this the most effective cost control in the app: limiting how
 * many sessions someone starts does nothing about how long they stay.
 *
 * Two minutes rather than one because somebody genuinely stuck on an ayah can
 * sit silent for a long while trying to remember it, and cutting them off
 * mid-thought is worse than the audio it saves. Getting the microphone back
 * costs a tap and a couple of seconds of reconnecting, so an early cutoff is
 * not a free mistake.
 */
const SILENCE_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Hard ceiling on a single sitting, matching the top of the session-length
 * slider so it can never interrupt a real session. Catches what silence
 * detection cannot: a television or a conversation in the room, where the app
 * keeps hearing *something* and never falls quiet.
 */
const MAX_SESSION_MS = 2 * 60 * 60 * 1000;

/** How often the two limits above are checked. */
const WATCHDOG_INTERVAL_MS = 5000;

/**
 * How long to wait before asking the microphone a second time. Long enough for
 * an audio session to finish coming up or a route change to settle, short
 * enough that a person waiting to recite does not read it as the app hanging.
 */
const START_RETRY_DELAY_MS = 400;

// How long stopListening waits on the native recorder before moving on.
const STOP_RECORDING_TIMEOUT_MS = 3000;

/**
 * How much audio to hold while the connection is still being set up.
 *
 * Chunks are CHUNK_INTERVAL_MS apart, so this is twelve seconds against a
 * setup that realistically takes one to three. Past the cap the newest audio
 * is dropped rather than the oldest: what the alignment cannot do without is
 * the start of the ayah, and a transcript missing its opening is exactly the
 * failure this whole arrangement exists to prevent.
 */
const MAX_PENDING_CHUNKS = 48;

let ws = null;
/**
 * A connection still being set up, so it can be cancelled.
 *
 * It is deliberately not in `ws`: that only holds a socket once it has opened,
 * which left the whole setup window invisible to stopListening. Turning the
 * microphone off during it used to leave the attempt running on its own, to
 * fail alone eight seconds later and report an error nobody was waiting for.
 */
let pendingConnect = null;
/**
 * Invalidates a start that is still in progress. stopListening bumps it, and
 * every await in startListening checks it, so a start that has been overtaken
 * gives up instead of switching the microphone on after the stop.
 */
let startToken = 0;
let audioSubscription = null;
/**
 * Audio heard before the socket was open, oldest first, sent the moment it
 * opens. The microphone now comes up before the network does, so this is
 * everything the reciter said during the gap.
 */
let pendingAudio = [];
/** True while the recorder is running and its chunks are worth holding. */
let isCapturing = false;
/**
 * The start that owns the recorder and the audio listener, by its token.
 *
 * A start that has been overtaken has to undo itself, and without this it
 * would undo whichever start replaced it instead: stop its recorder, take the
 * microphone away from the session actually running. Only the owner cleans up.
 */
let recorderOwner = 0;
let isActive = false;
let watchdog = null;
let lastSpeechAt = 0;
let startedAt = 0;
let accumulatedText = '';  // committed words for the CURRENT ayah (revealed so far)
/**
 * The same words as `accumulatedText`, kept split so every commit can be
 * re-aligned against the ayah from the beginning rather than appended to a
 * decision already made. Re-solving the whole thing is what lets a verdict be
 * revised when later audio contradicts it.
 */
let spokenRaw = [];
/** Per-expected-word verdict from the last alignment, handed to onCommit. */
let lastStatuses = [];
let pendingCarry = '';     // carry-over words from the previous ayah boundary — not yet matched against new ayah
let matchPos = 0;          // index into expectedWords: how many have been matched so far
let discardUntil = 0;
/**
 * Committed words that arrived while the next ayah was still loading.
 *
 * They used to be thrown away. The freeze exists so that words from the ayah
 * just finished are not judged against the one being loaded, which is right,
 * but it waited on a write to the database as well as the load, so on a phone
 * network it could run for the best part of a second. Anyone reciting straight
 * through the boundary, which is what fluency looks like, lost the opening of
 * the next ayah and was then marked wrong for the words they had actually
 * said. Held here instead, and judged against the new ayah once it is ready.
 */
let heldCommits = [];
/** Beyond this the reciter is far past the boundary and the rest is noise. */
const MAX_HELD_COMMITS = 40;
// matchPos value at the moment the ayah was completed (before internal reset to 0).
// Passed to onCommit so skip detection can see the final jump (e.g. position 10→12).
let lastAyahFinalMatchPos = 0;
let callbacks = {
  getExpectedWords: null,  // () => string[] — normalized expected words for current ayah
  onAyahComplete: null,
  onPartial: null,         // real-time partials → live judge only (not for reveal)
  onCommit: null,          // committed words → word reveal
  onError: null,
  onAutoStop: null,        // ('silence' | 'ceiling') → the mic closed itself
  onListening: null,       // the microphone is open, whatever the network is doing
  isGoingBack: null,       // (text) => the reciter has doubled back to an earlier ayah
};

/**
 * Watches the two limits above and closes the microphone itself. Runs on a
 * timer rather than a timeout reset per word, so a long recitation does not
 * churn through thousands of cancelled timers.
 */
function startWatchdog() {
  stopWatchdog();
  const now = Date.now();
  startedAt = now;
  lastSpeechAt = now;

  watchdog = setInterval(() => {
    if (!isActive) return;
    const elapsed = Date.now() - startedAt;
    const quiet = Date.now() - lastSpeechAt;

    if (elapsed >= MAX_SESSION_MS) {
      autoStop('ceiling');
    } else if (quiet >= SILENCE_TIMEOUT_MS) {
      autoStop('silence');
    }
  }, WATCHDOG_INTERVAL_MS);
}

function stopWatchdog() {
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
}

function autoStop(reason) {
  console.log('[RT] closing the microphone:', reason);
  // Captured before stopListening() clears the callbacks.
  const notify = callbacks.onAutoStop;
  stopListening()
    .catch(() => {})
    .finally(() => notify?.(reason));
}

/**
 * Judge one committed phrase against the ayah currently expected, and tell the
 * screen what it did.
 *
 * Lifted out of the message handler so that words held during an ayah change
 * can go through exactly the same path when they are released. A held word
 * that took a different route would be a second way to judge a commit, and
 * only one of them would get fixed when something was wrong with it.
 */
function judgeCommit(commitText) {
  // The reciter has doubled back to an ayah they already finished.
  //
  // The screen could already see this in the partials and used it to stop
  // marking words wrong, but the committed words came through here and were
  // aligned against the current ayah regardless. So an ayah recited again from
  // further back arrived as a pile of words that did not belong, and the marks
  // that produced outlived the moment: they were written into the ayah's
  // record and stayed there.
  //
  // Dropped instead. The position does not move, nothing is judged, and when
  // they arrive back at the ayah they were on it carries on from exactly where
  // it was. Asked here rather than at the call site so that words released
  // after an ayah change are asked the same question.
  if (callbacks.isGoingBack?.(commitText)) {
    console.log('[RT] doubling back, commit not judged:', commitText);
    return;
  }

  // Match committed words against the expected ayah sequence word-by-word.
  // Returns the completed ayah text when the last expected word is matched,
  // with carry-over words already stored in accumulatedText for the next ayah.
  const done = processCommitWords(commitText);

  // Let the judge see committed (stable) words.
  callbacks.onPartial?.(accumulatedText);

  if (done !== null) {
    // Pass the pre-reset matchPos so RecitationScreen's onCommit can detect
    // any skip that triggered completion (matchPos is 0 after processCommitWords
    // resets it, so we use the saved lastAyahFinalMatchPos instead).
    callbacks.onCommit?.(lastAyahFinalMatchPos, lastStatuses);
    console.log(`[RT] ayah complete, finalMatchPos=${lastAyahFinalMatchPos} text="${done}"`);
    // Brief discard so loadAyah can update ayahDataRef before the next
    // commit arrives. Nothing said in the window is lost: carry-over words are
    // in pendingCarry, and whole commits are held until the window lifts.
    discardUntil = Date.now() + 150;
    Promise.resolve(callbacks.onAyahComplete?.(done)).catch((err) => {
      reportError(err?.message ?? 'onAyahComplete failed');
    });
  } else {
    // Reveal matched expected words only — passing matchPos (not raw accumulated
    // text) prevents skipped/inserted words from inflating the reveal count.
    callbacks.onCommit?.(matchPos, lastStatuses);
    console.log(`[RT] matchPos=${matchPos} accumulated="${accumulatedText}"`);
  }
}

/**
 * Release what was held during an ayah change, oldest first.
 *
 * One of these can complete an ayah of its own, which opens another window
 * immediately. The rest go back on the queue when that happens rather than
 * being judged against an ayah that is no longer the one on screen: that would
 * reintroduce, from the inside, the exact mistake the window exists to
 * prevent.
 */
function drainHeldCommits() {
  if (heldCommits.length === 0) return;
  const queued = heldCommits;
  heldCommits = [];
  console.log('[RT] releasing', queued.length, 'held commits');

  for (let i = 0; i < queued.length; i++) {
    if (Date.now() < discardUntil) {
      heldCommits = queued.slice(i);
      return;
    }
    judgeCommit(queued[i]);
  }
}

/**
 * Re-align everything committed for this ayah against the expected words.
 * Returns the completed ayah text once the ayah is accounted for, otherwise
 * null. Carry-over words (the next ayah started in the same breath) are left
 * in `pendingCarry` for the next call.
 *
 * This used to be a greedy left-to-right matcher that ticked words off one at
 * a time and, when something did not match, either threw it away or guessed a
 * jump forward from a five-word lookahead. Two things went wrong with that.
 * A coincidental hit on a word the Qur'an repeats constantly (و, من, الله)
 * sent the position somewhere it should not have gone, and once moved it could
 * never be walked back. And it reported only a position, so the screen had to
 * infer mistakes from the size of the jump, which cannot tell a real skip from
 * several correct words arriving in one commit.
 *
 * Aligning the whole ayah on every commit fixes both: a coincidental match
 * loses to the arrangement that explains everything else, and the verdict is
 * per word, so nothing has to be inferred from a number.
 */
function processCommitWords(rawText) {
  const expectedWords = callbacks.getExpectedWords?.() ?? [];
  if (expectedWords.length === 0) {
    // Disconnected-letter ayah: advance on first commit regardless of content.
    // Carry rawText into pendingCarry so any words the user spoke in the same
    // breath (e.g. "ذلك" committed alongside "الم") are available to match
    // against the next ayah instead of being silently dropped.
    pendingCarry = [pendingCarry, rawText].filter(Boolean).join(' ');
    lastAyahFinalMatchPos = 0;
    lastStatuses = [];
    accumulatedText = '';
    spokenRaw = [];
    matchPos = 0;
    return rawText; // non-null signals completion; value is ignored for disconnected-letter ayahs
  }

  // Carry-over from the previous ayah boundary goes in front of this commit,
  // so those words are aligned against the new ayah rather than sitting inert.
  const incomingText = pendingCarry ? `${pendingCarry} ${rawText}` : rawText;
  pendingCarry = '';

  spokenRaw = spokenRaw.concat(incomingText.split(/\s+/).filter(Boolean));
  const spokenNorm = spokenRaw.map((w) => normalizeArabic(w));

  const { statuses, matchedCount, consumedSpoken, complete } = alignAyahProgress(
    expectedWords,
    spokenNorm
  );

  lastStatuses = statuses;
  matchPos = matchedCount;
  accumulatedText = spokenRaw.join(' ');

  if (!complete) return null;

  const done = spokenRaw.slice(0, consumedSpoken).join(' ');
  // Held in pendingCarry rather than accumulatedText so onCommit does not
  // reveal these words on the mushaf before they have been recited.
  pendingCarry = spokenRaw.slice(consumedSpoken).join(' ');
  lastAyahFinalMatchPos = matchedCount;
  spokenRaw = [];
  accumulatedText = '';
  matchPos = 0;
  return done;
}

function reportError(message) {
  console.warn('[RT]', message);
  callbacks.onError?.(message);
}

// Decode a base64 string into an ArrayBuffer for binary WebSocket send.
function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buf;
}

function handleServerMessage(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }

  switch (msg.message) {
    case 'RecognitionStarted':
      console.log('[RT] session started, id:', msg.id);
      break;

    case 'AddPartialTranscript': {
      if (Date.now() < discardUntil) break;
      const partialText = msg.metadata?.transcript?.trim();
      if (!partialText) break;
      // Partials count as speech. Waiting for a committed transcript would let
      // someone reciting slowly time out mid-ayah.
      lastSpeechAt = Date.now();
      // Combine committed prefix with the unstable partial tail so the judge
      // sees the full running text in real-time. NOT used for word reveal
      // (Speechmatics over-predicts Quran text in partials).
      const live = accumulatedText ? `${accumulatedText} ${partialText}` : partialText;
      // Pass partialText separately so callers can use just the raw current speech
      // (not the accumulated prefix) for retry detection.
      callbacks.onPartial?.(live, partialText);
      break;
    }

    case 'AddTranscript': {
      const commitText = msg.metadata?.transcript?.trim();
      if (Date.now() < discardUntil) {
        // Speech either way, so the silence watchdog must see it.
        if (commitText) {
          lastSpeechAt = Date.now();
          if (heldCommits.length < MAX_HELD_COMMITS) heldCommits.push(commitText);
        }
        break;
      }
      // The window can also end by lapsing rather than by resumeListening, and
      // anything held is still owed to the ayah now current.
      if (heldCommits.length > 0) drainHeldCommits();
      console.log('[RT] committed:', commitText);
      // Dev only. `metadata.transcript` is the flat sentence the app judges
      // against; `results` carries the per-word confidence and any competing
      // candidates, and the app throws all of it away.
      //
      // That matters for one specific complaint: say fa where the ayah has
      // waw, clearly, and no mistake is flagged. The app cannot be the cause,
      // since a word either matches the expected string exactly or is marked
      // wrong. So either the recogniser is returning the waw it expects, or
      // the error is being lost later. This prints enough to tell which, and
      // if the real letter is sitting in the alternatives or showing as low
      // confidence then there is something to build on.
      if (__DEV__) {
        // Printed beside what was expected, because the confidence number on
        // its own says nothing. The question is whether a word the recogniser
        // handed back *because it matched the Qur'an* came back weaker than one
        // it actually heard.
        //
        // Speechmatics' real-time API returns a single alternative per word and
        // has no setting to ask for more, so this list is always one long and
        // "look at the runner-up" is not a fix available to us. Confidence is
        // the only signal left.
        const expectedNow = callbacks.getExpectedWords?.() ?? [];
        console.log(
          `[RT-DEBUG] expecting from ${matchPos}: ${
            expectedNow.slice(matchPos, matchPos + 6).join(' ') || '(none)'
          }`
        );
        for (const r of msg.results ?? []) {
          if (r.type !== 'word') continue;
          const alts = (r.alternatives ?? [])
            .map((a) => `${a.content}@${(a.confidence ?? 0).toFixed(2)}`)
            .join(' | ');
          const heard = normalizeArabic(r.alternatives?.[0]?.content ?? '');
          const hit = expectedNow.indexOf(heard, matchPos);
          console.log(
            `[RT-DEBUG]   heard ${alts}  ${
              hit === matchPos ? '= expected' : hit > matchPos ? `= expected+${hit - matchPos}` : 'NO MATCH'
            }`
          );
        }
      }
      if (!commitText) break;
      // Speech is speech, whichever ayah it belongs to, so the silence
      // watchdog hears it before anything else decides what to do with it.
      lastSpeechAt = Date.now();

      judgeCommit(commitText);
      break;
    }

    case 'Error':
      reportError(msg.reason ?? 'Transcription error.');
      break;
    case 'Warning':
      console.warn('[RT] warning:', msg.reason);
      break;
    default:
      break;
  }
}

// Exchange the long-lived API key for a short-lived JWT required by the
// Speechmatics real-time WebSocket endpoint.
/**
 * Asks our server for a 60-second Speechmatics token.
 *
 * This used to call Speechmatics directly with the long-lived API key, which
 * meant the key had to ship inside the app, where anyone who installed Dawrah
 * could read it out of the bundle and transcribe on our bill. Speechmatics'
 * own documentation says never to authenticate this way from a client.
 *
 * The protocol is unchanged: the app has always connected with a short-lived
 * token. Only the minting moved, from the phone to the speechmatics-token edge
 * function, so nothing about the WebSocket or the audio path is affected.
 */
async function getTemporaryJwt() {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    throw new Error('Not signed in.');
  }

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/speechmatics-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    // The function returns a readable message for the cases a person can act
    // on, notably the daily limit.
    let message = `Could not start transcription (HTTP ${resp.status})`;
    try {
      const body = await resp.json();
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body; keep the status message
    }
    throw new Error(message);
  }

  const data = await resp.json();
  if (!data.token) {
    throw new Error('The server returned no transcription token.');
  }
  return data.token;
}

/**
 * How long to wait for the Speechmatics socket to open before giving up.
 *
 * A handshake that is merely slow is not a failure: on a weak cellular
 * connection the TLS negotiation alone can take several seconds, and the old
 * eight-second limit turned that into a dead-end error screen. Genuine refusals
 * no longer wait for this at all — the close handler below rejects as soon as
 * Speechmatics hangs up — so the only thing left under this limit is a network
 * that has stalled outright.
 */
const WS_OPEN_TIMEOUT_MS = 15000;

/**
 * Raised when a start is abandoned before the microphone ever opened, because
 * the screen turned it off or started again. Nothing failed, so screens check
 * for this and stay quiet rather than reporting it.
 */
export class ListeningCancelled extends Error {
  constructor() {
    super('Listening was cancelled before the connection opened.');
    this.name = 'ListeningCancelled';
  }
}

function openWebSocket(jwt) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${WS_URL}?jwt=${encodeURIComponent(jwt)}`
    );

    // Every path below can fire after the promise has settled — rejecting does
    // not stop a socket that is still connecting — so all of them go through
    // one guard.
    let settled = false;
    let cancel = null;

    // Only ever clears our own registration, never a newer attempt's.
    const release = () => {
      if (pendingConnect === cancel) pendingConnect = null;
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      release();
      clearTimeout(timeout);
      resolve(socket);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      release();
      clearTimeout(timeout);
      // Closing matters: an abandoned socket goes on to open, starts a
      // Speechmatics session nobody reads and we are billed for, and its
      // eventual onclose would report "connection closed unexpectedly" over
      // whichever session is running by then.
      try {
        socket.close();
      } catch {
        // already closing
      }
      reject(error);
    };

    const timeout = setTimeout(
      () => fail(new Error('Transcription connection timed out.')),
      WS_OPEN_TIMEOUT_MS
    );

    // Hand stopListening a way to end this attempt now rather than leaving it
    // to time out by itself.
    cancel = () => fail(new ListeningCancelled());
    pendingConnect = cancel;

    socket.onopen = () => {
      // The timeout may have closed this socket already; starting recognition
      // on it would bill a session with no listener.
      if (settled) return;
      // Speechmatics requires a StartRecognition message before audio.
      socket.send(
        JSON.stringify({
          message: 'StartRecognition',
          audio_format: {
            type: 'raw',
            encoding: 'pcm_s16le',
            sample_rate: SAMPLE_RATE,
          },
          transcription_config: {
            language: 'ar',
            operating_point: 'enhanced',
            enable_partials: true,
            // Force commits every ≤1 s so the user doesn't need to pause
            // for Speechmatics to finalise words. "flexible" means it still
            // cuts at natural word boundaries when possible.
            max_delay: 1.0,
            max_delay_mode: 'flexible',
          },
        })
      );
      succeed();
    };
    socket.onerror = (e) => {
      fail(new Error(e.message ?? 'Transcription connection failed.'));
    };
    socket.onmessage = handleServerMessage;
    socket.onclose = (e) => {
      if (!settled) {
        // Closed before it ever opened. This is how Speechmatics refuses a
        // token it will not accept — expired, or over the concurrent-session
        // limit — and reporting it as a timeout both hid the reason and made
        // the user wait out the full limit for it.
        const detail = e?.reason ? `${e.reason} (code ${e.code})` : `code ${e?.code ?? 'unknown'}`;
        fail(new Error(`Transcription connection refused: ${detail}`));
        return;
      }
      if (isActive) {
        console.warn('[RT] WS closed — code:', e?.code, 'reason:', e?.reason);
        reportError('Transcription connection closed unexpectedly.');
      }
    };
  });
}

/**
 * The teardown currently in flight, so a restart can wait for it.
 *
 * The native recorder refuses to start while it still believes it is
 * recording, and the refusal it gives is a bare "Failed to start recording."
 * with the real reason logged only on the native side. Screens call
 * stopListening() from an effect cleanup, which React does not await, so
 * stopping and starting again in quick succession — which the microphone
 * toggle now makes a one-tap action — could re-enter startListening while
 * stopRecording was still unwinding.
 */
let teardown = Promise.resolve();

/**
 * Start streaming the microphone to Speechmatics real-time STT.
 *
 * @param {object} opts
 * @param {function(): string[]} opts.getExpectedWords — normalized expected words for the current ayah
 * @param {function(string): Promise<void>} opts.onAyahComplete
 * @param {function(string): void} [opts.onPartial]   — real-time partials for live judge
 * @param {function(string): void} [opts.onCommit]    — committed text for word reveal
 * @param {function(string): void} [opts.onError]
 * @param {function('silence'|'ceiling'): void} [opts.onAutoStop] the microphone
 *        closed itself: two minutes without speech, or two hours in one sitting
 * @param {function(): void} [opts.onListening] the microphone is open and being
 *        recorded. Fires before the connection is up, because from here the
 *        audio is kept either way and the reciter can begin.
 * @param {function(string): boolean} [opts.isGoingBack] true when this text is
 *        the reciter doubling back to an ayah already finished. Those words are
 *        dropped rather than judged: see the call site below.
 * @param {boolean} [opts.preserveProgress] keep the place already reached in
 *        the current ayah instead of starting it again from its first word.
 *        Set when the microphone is being reopened part-way through an ayah.
 */
export async function startListening({
  getExpectedWords,
  onAyahComplete,
  onPartial,
  onCommit,
  onError,
  onAutoStop,
  onListening,
  isGoingBack,
  preserveProgress = false,
}) {
  // pendingConnect matters as much as isActive here: a start whose socket has
  // not opened yet is not "listening", but it is very much still running. So
  // does isCapturing, now that the microphone comes up first: between the
  // recorder starting and the socket opening there is no socket to notice, and
  // the previous attempt would be left holding the microphone.
  if (isActive || pendingConnect || isCapturing) {
    await stopListening();
  }

  // Anything that stops or restarts listening from here on invalidates this
  // token, and the checks after each await below unwind on it.
  const myToken = ++startToken;
  const overtaken = () => myToken !== startToken;

  await teardown;
  if (overtaken()) throw new ListeningCancelled();

  // Set after the teardown is done, not before: a stopListening the screen did
  // not await finishes by clearing these, and doing that to the callbacks of
  // the start that replaced it would silence the new session.
  callbacks = {
    getExpectedWords, onAyahComplete, onPartial, onCommit, onError, onAutoStop, onListening,
    isGoingBack,
  };

  // Where the reciter had got to in the ayah belongs to the ayah, not to the
  // microphone, so reopening the microphone part-way through one keeps it.
  //
  // It used to be wiped on every start. Someone who stopped the microphone
  // mid-ayah and started it again, without leaving the session, resumed where
  // they had left off and was told the first half of the ayah was missing:
  // the matcher was back at word zero and everything before where they picked
  // up had, as far as it could tell, never been recited. The screen knew
  // better the whole time. It had the words revealed on the page.
  if (!preserveProgress) {
    accumulatedText = '';
    spokenRaw = [];
    lastStatuses = [];
    pendingCarry = '';
    matchPos = 0;
    lastAyahFinalMatchPos = 0;
    heldCommits = [];
  }

  const { granted } = await ExpoAudioStreamModule.requestPermissionsAsync();
  console.log('[RT] mic permission granted:', granted);
  if (!granted) {
    throw new Error('Microphone permission is required.');
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
  });

  if (overtaken()) throw new ListeningCancelled();

  // The microphone comes up first and everything it hears while the token and
  // the socket are still being sorted out is held, then sent the moment the
  // socket opens.
  //
  // It used to come up last. That left a second or two after the tap where the
  // screen said the app was listening and nothing was being heard, and people
  // recite when you tell them to, so the opening of the ayah was simply lost.
  // Worse than lost: the alignment then had to account for a transcript that
  // began in the middle, and marked words wrong that had been recited
  // perfectly. Holding the audio costs nothing, since the same seconds are
  // billed either way.
  pendingAudio = [];
  isCapturing = false;

  let audioChunkCount = 0;
  const sub = emitter.addListener('AudioData', (event) => {
    const base64Pcm = event?.encoded;
    if (!base64Pcm) return;
    // A start that has been overtaken must not feed the one that replaced it:
    // this audio belongs to an ayah the reciter has already left.
    if (overtaken()) return;

    audioChunkCount += 1;
    if (audioChunkCount === 1) {
      console.log('[RT] first AudioData chunk, length:', base64Pcm.length);
    }

    if (isActive && ws?.readyState === WebSocket.OPEN) {
      try {
        // Speechmatics expects raw binary PCM frames, not base64 JSON.
        ws.send(base64ToArrayBuffer(base64Pcm));
      } catch (e) {
        console.warn('[RT] failed to send audio chunk:', e?.message);
      }
      return;
    }

    if (!isCapturing) return;
    if (pendingAudio.length >= MAX_PENDING_CHUNKS) return;
    pendingAudio.push(base64Pcm);
  });
  audioSubscription = sub;

  // Claimed before the recorder is asked to start rather than after, because
  // the wait in between is exactly the window where another start would sail
  // past the guard at the top of this function, see nothing running, and open
  // a second recorder over the top of this one.
  recorderOwner = myToken;
  isCapturing = true;

  try {
    await startRecordingWithRetry(overtaken);
  } catch (err) {
    await abandonStart(myToken, sub);
    if (err instanceof ListeningCancelled) throw err;
    const nativeReason = recentNativeError();
    console.error('[RT] startRecording failed:', err?.message ?? err, '| native:', nativeReason);
    // The native module collapses every reason into one string and logs the
    // real one where nobody can read it: a call in progress, another app
    // holding the audio session, or the engine failing to start all arrive as
    // "Failed to start recording." Say the part the person can act on, and
    // carry the reason the module gave on the side so the report names it.
    if (/failed to start recording|microphone input is unavailable/i.test(err?.message ?? '')) {
      const onACall = /phone call/i.test(nativeReason ?? '');
      const e = new Error(
        onACall
          ? 'The microphone is busy with a call. End the call and try again.'
          : 'Could not reach the microphone. If you are on a call, or another '
            + 'app is using it, close that and try again.'
      );
      e.cause = err;
      e.nativeReason = nativeReason ?? '(the recorder gave no reason)';
      throw e;
    }
    if (nativeReason) err.nativeReason = nativeReason;
    throw err;
  }

  if (overtaken()) {
    await abandonStart(myToken, sub);
    throw new ListeningCancelled();
  }

  console.log('[RT] microphone open, holding audio until the socket is up');
  // The screen can stop saying "connecting" here: from this moment the app
  // really can hear them, whatever the network is still doing.
  onListening?.();

  let jwt;
  try {
    jwt = await getTemporaryJwt();
  } catch (err) {
    await abandonStart(myToken, sub);
    throw err;
  }
  console.log('[RT] JWT obtained');
  if (overtaken()) {
    await abandonStart(myToken, sub);
    throw new ListeningCancelled();
  }

  let socket;
  try {
    socket = await openWebSocket(jwt);
  } catch (err) {
    await abandonStart(myToken, sub);
    throw err;
  }
  console.log('[RT] WebSocket opened');
  if (overtaken()) {
    // Opened just after the stop that was meant to prevent it. Close it here or
    // it becomes a session running with nothing on the other end.
    try {
      socket.close();
    } catch {
      // already closing
    }
    await abandonStart(myToken, sub);
    throw new ListeningCancelled();
  }

  ws = socket;
  isActive = true;
  // Only once the socket is open, so connection time is not counted as silence.
  startWatchdog();
  // Nothing is awaited between opening the socket and this call, so no live
  // chunk can be sent ahead of the held ones and arrive out of order.
  flushPendingAudio();
}

/**
 * Send everything held during setup, oldest first, and go live.
 */
function flushPendingAudio() {
  const held = pendingAudio;
  pendingAudio = [];
  isCapturing = false;
  if (held.length === 0) return;

  console.log('[RT] sending', held.length, 'held chunks');
  for (const chunk of held) {
    if (ws?.readyState !== WebSocket.OPEN) break;
    try {
      ws.send(base64ToArrayBuffer(chunk));
    } catch (e) {
      console.warn('[RT] failed to send held chunk:', e?.message);
      break;
    }
  }
}

/**
 * Undo a start that will not finish: take its listener off, throw away what it
 * held, and close the microphone it opened.
 *
 * Only if this start still owns them. A start can be overtaken by one that has
 * already opened the microphone for itself, and cleaning up blindly would stop
 * that one's recorder and remove its listener, which is a worse outcome than
 * the leak it was trying to prevent.
 */
async function abandonStart(myToken, sub) {
  sub.remove();
  if (audioSubscription === sub) audioSubscription = null;

  if (recorderOwner !== myToken) return;

  recorderOwner = 0;
  isCapturing = false;
  pendingAudio = [];
  try {
    await ExpoAudioStreamModule.stopRecording();
  } catch {
    // not recording, which is the outcome we were after anyway
  }
}

/**
 * Ask the native recorder to start, and ask a second time if the first is
 * refused.
 *
 * The microphone is often unavailable for a moment rather than for good: the
 * audio session is still coming up, the mistake beep from the previous ayah is
 * still unwinding, a headset is connecting, the previous sitting's engine is
 * still letting go. The native module reports that the same way it reports a
 * permanent refusal, so the only way to tell them apart is to wait and ask
 * again.
 *
 * It used to be worse than a refusal. Given an input reporting no channels,
 * the module installed the audio tap with a fabricated 16 kHz format, which
 * AVAudioEngine rejects by raising an ObjC exception, uncatchable from here,
 * so the app died rather than returning an error (Sentry DAWRAH-4). That is
 * fixed in patches/@siteed+audio-studio+3.2.0.patch; this retry is what turns
 * the rejection it now returns into a session that simply starts.
 */
async function startRecordingWithRetry(overtaken) {
  const options = {
    sampleRate: SAMPLE_RATE,
    channels: 1,
    encoding: 'pcm_16bit',
    interval: CHUNK_INTERVAL_MS,
  };

  try {
    await ExpoAudioStreamModule.startRecording(options);
    return;
  } catch (err) {
    if (overtaken()) throw new ListeningCancelled();
    console.warn('[RT] startRecording refused, retrying once:', err?.message ?? err);
  }

  await new Promise((resolve) => setTimeout(resolve, START_RETRY_DELAY_MS));
  if (overtaken()) throw new ListeningCancelled();

  await ExpoAudioStreamModule.startRecording(options);
}

/**
 * Drop the first `discardWords` committed words of the current ayah and match
 * whatever is left from the top of the ayah again.
 *
 * Called when the reciter has gone back to the ayah's first word after a slip.
 * Without this the abandoned attempt stays in the transcript and the ayah is
 * aligned against both runs at once, so the second pass over the opening reads
 * as a pile of inserted words and drags marks onto words that were recited
 * perfectly well the second time.
 *
 * The words after the restart point are kept and re-matched rather than
 * thrown away, because by the time a restart is recognisable some of the new
 * attempt has usually been committed already.
 *
 * Unlike resetUtterance this opens no discard window and touches no ayah
 * boundary state — the reciter is mid-breath and every word from here counts.
 *
 * @param {number} discardWords committed words to drop from the front
 * @returns {{ discarded: string, matchPos: number }} the abandoned attempt, and
 *   where the re-matched remainder left the cursor
 */
export function rewindUtterance(discardWords) {
  const words = accumulatedText.split(/\s+/).filter(Boolean);
  const cut = Math.max(0, Math.min(discardWords, words.length));
  const discarded = words.slice(0, cut).join(' ');
  const retained = words.slice(cut).join(' ');

  accumulatedText = '';
  spokenRaw = [];
  lastStatuses = [];
  matchPos = 0;
  pendingCarry = '';
  if (retained) processCommitWords(retained);

  return { discarded, matchPos };
}

/** Returns the committed words accumulated so far for the current ayah. */
export function getAccumulatedText() {
  return accumulatedText;
}

/**
 * Cancel an active discard window started by resetUtterance so the stream
 * resumes immediately. Call this after loadAyah / setup is complete.
 *
 * Anything the reciter said while the window was open is released here, and
 * judged against the ayah that is now current, which is the one they were
 * reciting when they said it.
 */
export function resumeListening() {
  discardUntil = 0;
  drainHeldCommits();
}

/**
 * Clear the accumulated transcript and suppress incoming messages for
 * discardMs milliseconds.
 */
export function resetUtterance({ discardMs = 1200 } = {}) {
  // Whatever is still held belongs to the ayah being left behind, and this is
  // the call that says it no longer counts.
  heldCommits = [];
  accumulatedText = '';
  spokenRaw = [];
  lastStatuses = [];
  matchPos = 0;
  lastAyahFinalMatchPos = 0;
  discardUntil = Date.now() + discardMs;
  // pendingCarry is deliberately left alone.
  //
  // It holds the words the reciter said past the end of the ayah in the same
  // breath, which is to say the opening of the one now being loaded, and it is
  // the only record of them. Clearing it here threw them away every single
  // time: this call runs on the completion that created them, before any
  // commit has had the chance to consume them. The carry-over mechanism could
  // never once do the job it was written for, and the ayah that followed
  // started life already missing its first words.
}

/** Stop the mic stream and close the transcription session. */

export async function stopListening() {
  const run = stopListeningInner();
  teardown = run.catch(() => {});
  return run;
}

async function stopListeningInner() {
  isActive = false;
  isCapturing = false;
  recorderOwner = 0;
  pendingAudio = [];
  // Both happen first and synchronously, so a start racing this one sees the
  // new token on its next check instead of finishing behind our back.
  startToken += 1;
  if (pendingConnect) {
    const cancel = pendingConnect;
    pendingConnect = null;
    cancel();
  }
  stopWatchdog();
  // The place reached in the ayah is deliberately left alone: a microphone
  // that stops has not un-recited anything. startListening clears it unless
  // it is told the ayah is being resumed, and resetUtterance clears it when
  // the ayah actually changes.
  discardUntil = 0;

  if (audioSubscription) {
    audioSubscription.remove();
    audioSubscription = null;
  }

  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ message: 'EndOfStream' }));
    } catch {
      // ignore
    }
  }

  // Bounded. The native stop runs on a serial queue, so one that never
  // returns leaves every later stop queued behind it, and the screens await
  // this before moving on. A tester who finished a portion sat on "Done,
  // continue to quiz" with nothing happening, which fits exactly that. The
  // socket is closed below regardless, so moving on loses nothing.
  let stopTimer;
  try {
    const timedOut = await Promise.race([
      ExpoAudioStreamModule.stopRecording().then(() => false),
      new Promise((resolve) => {
        stopTimer = setTimeout(() => resolve(true), STOP_RECORDING_TIMEOUT_MS);
      }),
    ]);
    if (timedOut) {
      reportHandledError(
        'transcription.stopRecording',
        new Error(`stopRecording did not return within ${STOP_RECORDING_TIMEOUT_MS}ms`)
      );
    }
  } catch {
    // not recording — fine
  } finally {
    clearTimeout(stopTimer);
  }

  if (ws) {
    try {
      ws.close();
    } catch {
      // already closed
    }
    ws = null;
  }

  callbacks = {
    getExpectedWords: null,
    onAyahComplete: null,
    onPartial: null,
    onCommit: null,
    onError: null,
    onAutoStop: null,
    onListening: null,
    isGoingBack: null,
  };
}

/** True while the microphone is open. Lets a screen show the right control. */
export function isListening() {
  return isActive;
}
