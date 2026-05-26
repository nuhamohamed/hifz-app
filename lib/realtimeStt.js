import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

const WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const CHUNK_MS = 500;

const RECORDING_OPTIONS = {
  android: {
    extension: '.wav',
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
  },
  ios: {
    extension: '.wav',
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  isMeteringEnabled: false,
  web: {},
};

let ws = null;
let isActive = false;
let accumulatedText = '';
let getExpectedWordCountFn = null;
let onAyahCompleteFn = null;

function countWords(text) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function getWavDataOffset(wavBuffer) {
  // Walk WAV chunks to find where 'data' actually starts
  let offset = 12; // skip RIFF + filesize + WAVE
  while (offset + 8 <= wavBuffer.length) {
    const id = String.fromCharCode(
      wavBuffer[offset],
      wavBuffer[offset + 1],
      wavBuffer[offset + 2],
      wavBuffer[offset + 3]
    );
    const size = wavBuffer.readUInt32LE(offset + 4);
    if (id === 'data') return offset + 8;
    offset += 8 + size;
  }
  return 44; // fallback
}

async function runChunkLoop() {
  while (isActive) {
    try {
      const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
      await new Promise((r) => setTimeout(r, CHUNK_MS));
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();

      if (!uri || !isActive || !ws || ws.readyState !== WebSocket.OPEN) continue;

      const base64Full = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });
      const wavBuffer = Buffer.from(base64Full, 'base64');
      const dataOffset = getWavDataOffset(wavBuffer);
      const pcmBytes = wavBuffer.slice(dataOffset);

      console.log(`[RT] chunk: header=${dataOffset}B pcm=${pcmBytes.length}B`);

      if (pcmBytes.length === 0) continue;

      const pcmBase64 = pcmBytes.toString('base64');

      ws.send(
        JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: pcmBase64,
          sample_rate: 16000,
        })
      );
    } catch (err) {
      console.warn('[RT] chunk error:', err.message);
    }
  }
}

export async function startRealtime(getExpectedWordCount, onAyahComplete) {
  getExpectedWordCountFn = getExpectedWordCount;
  onAyahCompleteFn = onAyahComplete;
  accumulatedText = '';
  isActive = true;

  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) throw new Error('Microphone permission required');

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('EXPO_PUBLIC_ELEVENLABS_API_KEY not set');

  const params = new URLSearchParams({
    model_id: 'scribe_v2_realtime',
    language_code: 'ara',
    commit_strategy: 'vad',
    vad_silence_threshold_secs: '0.4',
    audio_format: 'pcm_16000',
    no_verbatim: 'true',
  });

  await new Promise((resolve, reject) => {
    ws = new WebSocket(`${WS_URL}?${params}`, null, {
      headers: { 'xi-api-key': apiKey },
    });

    const timeout = setTimeout(
      () => reject(new Error('WebSocket connection timeout')),
      5000
    );

    ws.onopen = () => {
      clearTimeout(timeout);
      console.log('[RT] connected');
      resolve();
    };

    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error(e.message ?? 'WebSocket connection failed'));
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      console.log('[RT] message:', msg.message_type);

      if (msg.message_type === 'committed_transcript') {
        const text = (msg.text ?? '').trim();
        console.log('[RT] committed:', text);
        if (!text) return;

        accumulatedText = accumulatedText
          ? `${accumulatedText} ${text}`
          : text;

        const wordCount = countWords(accumulatedText);
        const expected = getExpectedWordCountFn?.() ?? 0;
        console.log(`[RT] wordCount=${wordCount} expected=${expected}`);

        if (wordCount > 0 && wordCount >= Math.max(1, expected - 2)) {
          const done = accumulatedText;
          accumulatedText = '';
          onAyahCompleteFn?.(done);
        }
      }
    };

    ws.onclose = () => console.log('[RT] closed');
  });

  runChunkLoop(); // fire and forget — runs in background
}

export async function stopRealtime() {
  isActive = false;
  accumulatedText = '';
  if (ws) {
    try {
      ws.close();
    } catch {}
    ws = null;
  }
}
