import { ExpoAudioStreamModule } from '@siteed/audio-studio';
import { Audio } from 'expo-av';
import { LegacyEventEmitter } from 'expo-modules-core';
import { normalizeArabic } from './arabicUtils';

/**
 * Realtime recitation listening: streams mic PCM to Speechmatics real-time
 * STT over WebSocket and accumulates finalised transcript segments.
 *
 * Requires a development build — @siteed/audio-studio is a native module
 * and does not exist in Expo Go.
 */

const WS_URL = 'wss://eu2.rt.speechmatics.com/v2';
const SAMPLE_RATE = 16000;
const CHUNK_INTERVAL_MS = 250;
// How many expected words to look ahead when a committed word doesn't match
// the current position. 5 lets the system recover from multi-word skips
// (e.g. user jumps from position 3 to position 7) without getting stuck.
const MAX_SKIP = 5;

const emitter = new LegacyEventEmitter(ExpoAudioStreamModule);

/**
 * Stop listening after this long without speech, and let a tap resume.
 *
 * There was no limit of any kind: once transcription started it ran until the
 * screen closed or the app was force-quit, so a phone left on a table kept the
 * microphone open and kept billing. Speechmatics charges per minute of audio,
 * which makes this the most effective cost control in the app: limiting how
 * many sessions someone starts does nothing about how long they stay.
 *
 * 90 rather than 60 seconds because somebody genuinely stuck on an ayah can sit
 * silent for a minute while they try to remember, and cutting them off
 * mid-thought is worse than the few seconds of audio it saves.
 */
const SILENCE_TIMEOUT_MS = 90 * 1000;

/**
 * Hard ceiling on a single sitting, matching the top of the session-length
 * slider so it can never interrupt a real session. Catches what silence
 * detection cannot: a television or a conversation in the room, where the app
 * keeps hearing *something* and never falls quiet.
 */
const MAX_SESSION_MS = 2 * 60 * 60 * 1000;

/** How often the two limits above are checked. */
const WATCHDOG_INTERVAL_MS = 5000;

let ws = null;
let audioSubscription = null;
let isActive = false;
let watchdog = null;
let lastSpeechAt = 0;
let startedAt = 0;
let accumulatedText = '';  // committed words for the CURRENT ayah (revealed so far)
let pendingCarry = '';     // carry-over words from the previous ayah boundary — not yet matched against new ayah
let matchPos = 0;          // index into expectedWords: how many have been matched so far
let discardUntil = 0;
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
 * Process a newly committed chunk of text word-by-word against the expected
 * ayah sequence. Returns the completed ayah text if the last expected word was
 * matched, otherwise null.
 *
 * On completion the carry-over words (next-ayah words that appeared in the
 * same commit) are left in accumulatedText so they are immediately available
 * for the next ayah without any discard window eating them.
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
    accumulatedText = '';
    matchPos = 0;
    return rawText; // non-null signals completion; value is ignored for disconnected-letter ayahs
  }

  // Merge any carry-over from the previous ayah boundary into this commit so
  // those words advance matchPos rather than sitting inert in accumulatedText.
  const incomingText = pendingCarry ? `${pendingCarry} ${rawText}` : rawText;
  pendingCarry = '';

  const rawWords = incomingText.split(/\s+/).filter(Boolean);
  const normWords = rawWords.map((w) => normalizeArabic(w));
  let completionAt = -1;

  for (let ti = 0; ti < normWords.length && matchPos < expectedWords.length; ti++) {
    const ew = expectedWords[matchPos];
    if (normWords[ti] === ew) {
      matchPos++;
      if (matchPos >= expectedWords.length) {
        completionAt = ti;
        break;
      }
    } else {
      // Look ahead up to MAX_SKIP positions. This lets the system recover when
      // the user (or STT) skips several words — e.g. jumping from position 3
      // to position 7 — without getting permanently stuck waiting for the
      // skipped words to appear. Each skipped position is later marked wrong
      // by onCommit's skip-detection logic.
      let found = false;
      for (let skip = 1; skip <= MAX_SKIP && matchPos + skip < expectedWords.length; skip++) {
        const fw = expectedWords[matchPos + skip];
        if (normWords[ti] === fw) {
          matchPos += skip + 1;
          found = true;
          if (matchPos >= expectedWords.length) {
            completionAt = ti;
          }
          break;
        }
      }
      if (!found) {
        // True insertion — wrong word or noise, skip silently, matchPos stays.
      } else if (completionAt >= 0) {
        break;
      }
    }
  }

  if (completionAt >= 0) {
    const matchedPart = rawWords.slice(0, completionAt + 1).join(' ');
    const carryPart   = rawWords.slice(completionAt + 1).join(' ');
    const done = accumulatedText ? `${accumulatedText} ${matchedPart}` : matchedPart;
    // Store carry-over in pendingCarry rather than accumulatedText so onCommit
    // doesn't immediately reveal those words on the mushaf before they're recited.
    pendingCarry = carryPart;
    // Save the final matchPos before reset so onCommit can detect any skip that
    // triggered completion (e.g. a one-word-skip over the second-to-last word).
    lastAyahFinalMatchPos = matchPos;
    accumulatedText = '';
    matchPos = 0;
    return done;
  }

  // Not done — accumulate the merged incoming text for reveal and judge.
  accumulatedText = accumulatedText ? `${accumulatedText} ${incomingText}` : incomingText;
  return null;
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
      if (Date.now() < discardUntil) break;
      const commitText = msg.metadata?.transcript?.trim();
      console.log('[RT] committed:', commitText);
      if (!commitText) break;
      lastSpeechAt = Date.now();

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
        callbacks.onCommit?.(lastAyahFinalMatchPos);
        console.log(`[RT] ayah complete, finalMatchPos=${lastAyahFinalMatchPos} text="${done}"`);
        // Brief discard so loadAyah can update ayahDataRef before the next
        // commit arrives. Carry-over words are already in accumulatedText
        // so they won't be lost even if a partial fires during this window.
        discardUntil = Date.now() + 150;
        Promise.resolve(callbacks.onAyahComplete?.(done)).catch((err) => {
          reportError(err?.message ?? 'onAyahComplete failed');
        });
      } else {
        // Reveal matched expected words only — passing matchPos (not raw accumulated
        // text) prevents skipped/inserted words from inflating the reveal count.
        callbacks.onCommit?.(matchPos);
        console.log(`[RT] matchPos=${matchPos} accumulated="${accumulatedText}"`);
      }
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
async function getTemporaryJwt(apiKey) {
  const resp = await fetch(
    'https://mp.speechmatics.com/v1/api_keys?type=rt',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 60 }),
    }
  );
  if (!resp.ok) {
    throw new Error(
      `Speechmatics token exchange failed (HTTP ${resp.status})`
    );
  }
  const data = await resp.json();
  if (!data.key_value) {
    throw new Error('Speechmatics token exchange returned no key_value');
  }
  return data.key_value;
}

function openWebSocket(jwt) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${WS_URL}?jwt=${encodeURIComponent(jwt)}`
    );

    const timeout = setTimeout(
      () => reject(new Error('Transcription connection timed out.')),
      8000
    );

    socket.onopen = () => {
      clearTimeout(timeout);
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
      resolve(socket);
    };
    socket.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error(e.message ?? 'Transcription connection failed.'));
    };
    socket.onmessage = handleServerMessage;
    socket.onclose = (e) => {
      if (isActive) {
        console.warn('[RT] WS closed — code:', e?.code, 'reason:', e?.reason);
        reportError('Transcription connection closed unexpectedly.');
      }
    };
  });
}

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
 *        closed itself: 90 seconds without speech, or two hours in one sitting
 */
export async function startListening({
  getExpectedWords,
  onAyahComplete,
  onPartial,
  onCommit,
  onError,
  onAutoStop,
}) {
  if (isActive) {
    await stopListening();
  }

  callbacks = { getExpectedWords, onAyahComplete, onPartial, onCommit, onError, onAutoStop };
  accumulatedText = '';
  pendingCarry = '';
  matchPos = 0;
  lastAyahFinalMatchPos = 0;

  const apiKey = process.env.EXPO_PUBLIC_SPEECHMATICS_API_KEY;
  if (!apiKey) {
    throw new Error('EXPO_PUBLIC_SPEECHMATICS_API_KEY is not set in .env');
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

  const jwt = await getTemporaryJwt(apiKey);
  console.log('[RT] JWT obtained');
  ws = await openWebSocket(jwt);
  console.log('[RT] WebSocket opened');
  isActive = true;
  // Only once the socket is open, so connection time is not counted as silence.
  startWatchdog();

  let audioChunkCount = 0;
  audioSubscription = emitter.addListener('AudioData', (event) => {
    const base64Pcm = event?.encoded;
    audioChunkCount += 1;
    if (audioChunkCount === 1) {
      console.log('[RT] first AudioData chunk, length:', base64Pcm?.length ?? 'undefined');
    }
    if (!base64Pcm || !isActive || ws?.readyState !== WebSocket.OPEN) {
      if (audioChunkCount <= 3) {
        console.log('[RT] chunk skipped — base64Pcm:', !!base64Pcm, 'isActive:', isActive, 'wsState:', ws?.readyState);
      }
      return;
    }
    try {
      // Speechmatics expects raw binary PCM frames, not base64 JSON.
      ws.send(base64ToArrayBuffer(base64Pcm));
    } catch (e) {
      console.warn('[RT] failed to send audio chunk:', e?.message);
    }
  });

  try {
    await ExpoAudioStreamModule.startRecording({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      encoding: 'pcm_16bit',
      interval: CHUNK_INTERVAL_MS,
    });
    console.log('[RT] recording + streaming started');
  } catch (err) {
    console.error('[RT] startRecording failed:', err?.message ?? err);
    throw err;
  }
}

/** Returns the committed words accumulated so far for the current ayah. */
export function getAccumulatedText() {
  return accumulatedText;
}

/**
 * Cancel an active discard window started by resetUtterance so the stream
 * resumes immediately. Call this after loadAyah / setup is complete.
 */
export function resumeListening() {
  discardUntil = 0;
}

/**
 * Clear the accumulated transcript and suppress incoming messages for
 * discardMs milliseconds.
 */
export function resetUtterance({ discardMs = 1200 } = {}) {
  accumulatedText = '';
  pendingCarry = '';
  matchPos = 0;
  lastAyahFinalMatchPos = 0;
  discardUntil = Date.now() + discardMs;
}

/** Stop the mic stream and close the transcription session. */
export async function stopListening() {
  isActive = false;
  stopWatchdog();
  accumulatedText = '';
  pendingCarry = '';
  matchPos = 0;
  lastAyahFinalMatchPos = 0;
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

  try {
    await ExpoAudioStreamModule.stopRecording();
  } catch {
    // not recording — fine
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
  };
}

/** True while the microphone is open. Lets a screen show the right control. */
export function isListening() {
  return isActive;
}
