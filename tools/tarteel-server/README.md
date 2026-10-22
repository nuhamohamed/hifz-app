# Tarteel recogniser server (development only)

Runs Tarteel's Quran Whisper model (`tarteel-ai/whisper-base-ar-quran`) on this
Mac and answers the phone in the same message format as Speechmatics, so a dev
build can recite into the real microphone and be transcribed by Tarteel
instead. Nothing here ships to testers.

## Use it

1. Start it, and leave the terminal open:

   ```
   python3 tools/tarteel-server/server.py
   ```

   It prints `listening on :8765` when ready. The first run downloads the
   model (about 300 MB).

2. Run the dev build on the phone, loaded from Metro on this Mac, with the
   phone on the same Wi-Fi.
3. In the app: Settings → Developer: recogniser → Tarteel (Mac).
4. Recite. The terminal prints every pass: how long the audio was, how long
   it took, which words were committed (`+`) and which are still provisional
   (`~`).

The phone finds the Mac through the Metro address, so there is no IP to set.
If macOS asks whether Python may accept incoming connections, allow it.

## How it streams

Whisper transcribes whole clips, not a stream. The server re-transcribes the
audio since the last pause each time a little more arrives, commits a word
once two passes agree on it, and starts afresh at each pause. See the
docstring at the top of `server.py`.

Measured on an M2 Mac, streaming recorded recitation at real speed: every word
correct; words committed a median 0.45 to 0.7 s after they were spoken, at
worst under 2 s.

Settings, as environment variables: `AGREE` (passes that must agree, default
2), `PAUSE_S` (pause that ends a stretch, default 0.45), `PORT` (default 8765).
