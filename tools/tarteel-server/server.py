"""
A stand-in for Speechmatics' real-time API, backed by Tarteel's Whisper model
running on this Mac. Development only: it exists so the app's transcription can
be compared, on a real phone and a real voice, without rewriting the app.

The phone connects here instead of to Speechmatics when the developer switch in
Settings says "Tarteel (Mac)". It speaks the small part of the Speechmatics
protocol the app uses: StartRecognition in, RecognitionStarted back, binary
16 kHz PCM in, AddPartialTranscript / AddTranscript back, EndOfStream in,
EndOfTranscript back. Nothing else in the app has to change.

Whisper is not a streaming model. It transcribes a clip of up to 30 seconds and
pads anything shorter to 30, so a pass costs roughly the same whatever its
length. Streaming is built on top of it here:

- The audio since the last pause is re-transcribed every time enough new audio
  has arrived. Each pass sees everything said so far in the stretch, so earlier
  words are usually stable and only the tail changes.
- A word is committed (sent as AddTranscript) once AGREE passes in a row
  have produced it in the same place. The last word of a pass may be cut off
  mid-word, so it needs one more pass than that. Committing on first sight
  was tried and measured: on a window under two seconds Whisper produced junk
  ("ذ ذ") for the opening of an ayah, and the real words were lost.
- At a pause long enough to be a waqf or an ayah end, the stretch is finished:
  one final pass commits whatever is left, and the next stretch starts empty.
  That keeps every window well under Whisper's 30 seconds.
- Silence is never transcribed. Whisper invents text for silence, and a
  recogniser that hears Qur'an in a quiet room would be worse than useless.

Run:  python3 server.py            (listens on 0.0.0.0:8765)
"""

import asyncio
import json
import os
import re
import time
import uuid

import numpy as np
import torch
from aiohttp import web
from transformers import GenerationConfig, WhisperForConditionalGeneration, WhisperProcessor

MODEL_ID = os.environ.get('MODEL_ID', 'tarteel-ai/whisper-base-ar-quran')
PORT = int(os.environ.get('PORT', '8765'))
SAMPLE_RATE = 16000

# Commit a word after this many passes have agreed on it. 1 = latency first.
AGREE = int(os.environ.get('AGREE', '2'))
# New audio needed before another pass is worth running.
MIN_NEW_AUDIO_S = float(os.environ.get('MIN_NEW_AUDIO_S', '0.3'))
# A pause this long ends a stretch.
PAUSE_S = float(os.environ.get('PAUSE_S', '0.45'))
# Never let a stretch approach Whisper's 30 seconds.
MAX_STRETCH_S = 24.0

FRAME = int(0.03 * SAMPLE_RATE)
# Arabic diacritics and Quranic marks, stripped only to compare words between
# passes. What is sent to the app keeps them; the app normalises for itself.
MARKS = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')


def log(*args):
    print(time.strftime('%H:%M:%S'), *args, flush=True)


def device():
    if torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


class Engine:
    def __init__(self):
        self.device = device()
        log(f'loading {MODEL_ID} on {self.device}')
        self.proc = WhisperProcessor.from_pretrained(MODEL_ID)
        self.model = WhisperForConditionalGeneration.from_pretrained(MODEL_ID).to(self.device).eval()
        # The fine-tune shipped a generation config older than current
        # transformers accepts. The base model's is the one it was trained from.
        self.model.generation_config = GenerationConfig.from_pretrained('openai/whisper-base')
        self.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32))  # warm up
        log('ready')

    def transcribe(self, audio):
        feats = self.proc(audio, sampling_rate=SAMPLE_RATE, return_tensors='pt').input_features
        with torch.no_grad():
            ids = self.model.generate(
                feats.to(self.device), language='ar', task='transcribe', max_new_tokens=220
            )
        return self.proc.batch_decode(ids, skip_special_tokens=True)[0].strip()


def compare_form(word):
    return MARKS.sub('', word)


def frame_rms(audio):
    n = len(audio) // FRAME
    if n == 0:
        return np.zeros(0)
    return np.sqrt(np.mean(audio[: n * FRAME].reshape(n, FRAME) ** 2, axis=1))


class Stream:
    """One phone connection: the audio of the current stretch and what has
    already been committed from it."""

    def __init__(self, ws, engine):
        self.ws = ws
        self.engine = engine
        self.audio = np.zeros(0, dtype=np.float32)
        self.last_pass_len = 0
        self.committed = 0          # words of this stretch already sent as final
        self.history = []           # recent passes' words, newest last
        self.speech_floor = 0.01    # rises with the loudest speech heard
        self.ended = False
        self.wake = asyncio.Event()
        self.lock = asyncio.Lock()

    def add_audio(self, pcm_bytes):
        chunk = np.frombuffer(pcm_bytes, dtype='<i2').astype(np.float32) / 32768.0
        self.audio = np.concatenate([self.audio, chunk])
        self.wake.set()

    def silence_threshold(self):
        rms = frame_rms(self.audio)
        if len(rms):
            self.speech_floor = max(self.speech_floor * 0.999, float(np.percentile(rms, 90)) * 0.15, 0.006)
        return self.speech_floor

    def has_speech(self, audio):
        rms = frame_rms(audio)
        return bool(len(rms)) and float(rms.max()) > self.speech_floor * 2

    def trailing_pause(self):
        """Seconds of silence at the end of the stretch."""
        rms = frame_rms(self.audio)
        thr = self.silence_threshold()
        quiet = 0
        for v in rms[::-1]:
            if v >= thr:
                break
            quiet += 1
        return quiet * FRAME / SAMPLE_RATE

    async def send(self, message, **body):
        # The app closes its socket straight after EndOfStream, so a reply can
        # find it gone. That is the normal end of a session, not an error.
        if self.ws.closed:
            return
        try:
            await self.ws.send_str(json.dumps({'message': message, **body}, ensure_ascii=False))
        except (ConnectionResetError, RuntimeError):
            pass

    async def send_words(self, words, final):
        if not words:
            return
        text = ' '.join(words)
        if final:
            await self.send(
                'AddTranscript',
                metadata={'transcript': text},
                results=[
                    {'type': 'word', 'alternatives': [{'content': w, 'confidence': 1.0}]} for w in words
                ],
            )
        else:
            await self.send('AddPartialTranscript', metadata={'transcript': text}, results=[])

    async def run_pass(self, finishing):
        audio = self.audio.copy()
        self.last_pass_len = len(audio)
        if not self.has_speech(audio):
            return
        t0 = time.time()
        text = await asyncio.get_running_loop().run_in_executor(None, self.engine.transcribe, audio)
        words = text.split()
        took = time.time() - t0

        self.history = (self.history + [[compare_form(w) for w in words]])[-(AGREE + 1):]

        def agreed(i, passes):
            recent = self.history[-passes:]
            return len(recent) == passes and all(i < len(p) and p[i] == recent[-1][i] for p in recent)

        if finishing:
            upto = len(words)
        else:
            # Longest run of words the recent passes agree on.
            upto = 0
            while upto < len(words):
                last = upto == len(words) - 1
                if not agreed(upto, AGREE + 1 if last else AGREE):
                    break
                upto += 1

        new_final = words[self.committed:upto] if upto > self.committed else []
        if new_final:
            self.committed = upto
            await self.send_words(new_final, final=True)
        tail = words[self.committed:]
        await self.send_words(tail, final=False)
        log(
            f'pass {len(audio)/SAMPLE_RATE:5.1f}s in {took:.2f}s'
            f'{" FINAL" if finishing else ""}  +{" ".join(new_final)}  ~{" ".join(tail)}'
        )

    def end_stretch(self):
        self.audio = np.zeros(0, dtype=np.float32)
        self.last_pass_len = 0
        self.committed = 0
        self.history = []

    async def loop(self):
        while not self.ended:
            await self.wake.wait()
            self.wake.clear()
            async with self.lock:
                stretch_s = len(self.audio) / SAMPLE_RATE
                new_s = (len(self.audio) - self.last_pass_len) / SAMPLE_RATE
                pause = self.trailing_pause()
                if stretch_s > PAUSE_S and pause >= PAUSE_S and self.has_speech(self.audio):
                    if self.last_pass_len < len(self.audio):
                        await self.run_pass(finishing=True)
                    self.end_stretch()
                elif stretch_s > 0 and not self.has_speech(self.audio) and stretch_s > 2:
                    # Nothing but room noise so far: drop it rather than let it grow.
                    self.end_stretch()
                elif stretch_s >= MAX_STRETCH_S:
                    await self.run_pass(finishing=True)
                    self.end_stretch()
                elif new_s >= MIN_NEW_AUDIO_S:
                    await self.run_pass(finishing=False)

    async def finish(self):
        self.ended = True
        self.wake.set()
        async with self.lock:
            if len(self.audio) > self.last_pass_len:
                await self.run_pass(finishing=True)
            self.end_stretch()


async def handle(request):
    ws = web.WebSocketResponse(max_msg_size=0)
    await ws.prepare(request)
    stream = Stream(ws, request.app['engine'])
    worker = None
    log('phone connected from', request.remote)
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.BINARY:
                stream.add_audio(msg.data)
            elif msg.type == web.WSMsgType.TEXT:
                data = json.loads(msg.data)
                kind = data.get('message')
                if kind == 'StartRecognition':
                    # The GPU goes cold when idle: the first pass on the phone
                    # took 4.5 s against a usual 0.3, so the first words of a
                    # recitation arrived 5 s late. Warm it before replying, while
                    # the phone is still opening the microphone.
                    await asyncio.get_running_loop().run_in_executor(
                        None, stream.engine.transcribe, np.zeros(SAMPLE_RATE, dtype=np.float32)
                    )
                    await stream.send('RecognitionStarted', id=str(uuid.uuid4()))
                    worker = asyncio.create_task(stream.loop())
                elif kind == 'EndOfStream':
                    await stream.finish()
                    await stream.send('EndOfTranscript')
                    break
    finally:
        stream.ended = True
        stream.wake.set()
        if worker:
            worker.cancel()
        log('phone disconnected')
    return ws


def main():
    app = web.Application()
    app['engine'] = Engine()
    app.router.add_get('/{tail:.*}', handle)
    web.run_app(app, host='0.0.0.0', port=PORT, print=lambda *_: log(f'listening on :{PORT}'))


if __name__ == '__main__':
    main()
