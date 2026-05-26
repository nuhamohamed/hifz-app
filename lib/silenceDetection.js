import { Audio } from 'expo-av';

const SILENCE_THRESHOLD_DB = -35;
const SILENCE_DURATION_MS = 400;
const MIN_RECORDING_MS = 500;
const METER_POLL_MS = 100;

const RECORDING_OPTIONS = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

/**
 * Returns true if the text is purely a sound description (e.g. "[صوت فرك]")
 * with no actual spoken Arabic words.
 */
function isNoisyClip(text) {
  // Remove all bracketed descriptions and whitespace; if nothing remains, it's noise.
  return text.replace(/\[[^\]]*\]/g, '').replace(/[.،؟!\s]/g, '').length === 0;
}

let isListening = false;
let isProcessingSegment = false;
let recording = null;
let pollIntervalId = null;
let recordingStartedAt = null;
let silenceStartedAt = null;
let accumulatedText = '';
let onClipRecordedCallback = null;
let getExpectedWordCountCallback = null;
let onAyahCompleteCallback = null;

function countAccumulatedWords() {
  const trimmed = accumulatedText.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

async function startNewRecording() {
  const { recording: newRecording } =
    await Audio.Recording.createAsync(RECORDING_OPTIONS);
  recording = newRecording;
  recordingStartedAt = Date.now();
  silenceStartedAt = null;
}

async function handleSilenceDetected() {
  if (!isListening || isProcessingSegment || !recording) {
    return;
  }

  isProcessingSegment = true;
  const currentRecording = recording;
  recording = null;

  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }

  try {
    await currentRecording.stopAndUnloadAsync();
    const uri = currentRecording.getURI();

    if (!uri) {
      if (isListening) {
        await startNewRecording();
        startMeterPolling();
      }
      return;
    }

    // Start capturing the next clip immediately so no speech is lost
    // during the ElevenLabs API call.
    if (isListening) {
      await startNewRecording();
      startMeterPolling();
    }

    const clipText = await onClipRecordedCallback(uri);
    const trimmedClip = (clipText ?? '').trim();

    if (trimmedClip && !isNoisyClip(trimmedClip)) {
      accumulatedText = accumulatedText
        ? `${accumulatedText} ${trimmedClip}`
        : trimmedClip;
    }

    if (!isListening) {
      return;
    }

    const expectedWordCount = getExpectedWordCountCallback?.() ?? 0;
    const wordCount = countAccumulatedWords();

    console.log(
      `[SD] clip="${trimmedClip}" wordCount=${wordCount} expected=${expectedWordCount}`
    );

    // Only trigger ayah completion when we have enough words.
    // Mid-ayah pauses accumulate text and keep listening.
    if (wordCount < 1) {
      return;
    }

    if (wordCount >= Math.max(1, expectedWordCount - 2)) {
      const completedText = accumulatedText;
      accumulatedText = '';
      await onAyahCompleteCallback?.(completedText);
    }
  } catch {
    if (isListening && !recording) {
      try {
        await startNewRecording();
        startMeterPolling();
      } catch {
        await stopListening();
      }
    }
  } finally {
    isProcessingSegment = false;
  }
}

function startMeterPolling() {
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
  }

  pollIntervalId = setInterval(async () => {
    if (!isListening || isProcessingSegment || !recording) {
      return;
    }

    try {
      const status = await recording.getStatusAsync();
      if (!status.isRecording) {
        return;
      }

      const elapsed = Date.now() - recordingStartedAt;
      if (elapsed < MIN_RECORDING_MS) {
        silenceStartedAt = null;
        return;
      }

      if (status.metering === undefined) {
        silenceStartedAt = null;
        return;
      }

      if (status.metering < SILENCE_THRESHOLD_DB) {
        if (silenceStartedAt === null) {
          silenceStartedAt = Date.now();
        } else if (Date.now() - silenceStartedAt >= SILENCE_DURATION_MS) {
          silenceStartedAt = null;
          await handleSilenceDetected();
        }
      } else {
        silenceStartedAt = null;
      }
    } catch {
      // Recording may have been stopped externally; polling will resume after next clip.
    }
  }, METER_POLL_MS);
}

/**
 * Start continuous recording with silence-based clip segmentation.
 *
 * @param {function(string): Promise<string>} onClipRecorded — transcribe one clip, return text
 * @param {function(): number} getExpectedWordCount — word count for the current expected ayah
 * @param {function(string): Promise<void>} onAyahComplete — called when enough text is accumulated
 */
export async function startListening(
  onClipRecorded,
  getExpectedWordCount,
  onAyahComplete
) {
  console.log('startListening called');
  try {
    if (isListening) {
      await stopListening();
    }

    onClipRecordedCallback = onClipRecorded;
    getExpectedWordCountCallback = getExpectedWordCount;
    onAyahCompleteCallback = onAyahComplete;
    accumulatedText = '';

    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Microphone permission is required for silence detection.');
    }
    console.log('mic permission granted');

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    isListening = true;
    isProcessingSegment = false;

    await startNewRecording();
    console.log('recording started');
    startMeterPolling();
  } catch (err) {
    console.error('startListening error:', err);
    throw err;
  }
}

/**
 * Stop listening, clear timers, and release any active recording.
 */
export async function stopListening() {
  isListening = false;
  isProcessingSegment = false;
  accumulatedText = '';

  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }

  if (recording) {
    try {
      const status = await recording.getStatusAsync();
      if (status.isRecording) {
        await recording.stopAndUnloadAsync();
      }
    } catch {
      // Ignore cleanup errors when stopping.
    }
    recording = null;
  }

  recordingStartedAt = null;
  silenceStartedAt = null;
  onClipRecordedCallback = null;
  getExpectedWordCountCallback = null;
  onAyahCompleteCallback = null;
}
