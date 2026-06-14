# HifzApp — Session Handoff (2026-06-13 v3)

Quran memorisation (hifz) revision app. React Native + Expo SDK 54, Supabase backend,
**Speechmatics** realtime STT, quran.com API for comparison text, mushaf.db for display.
Project root: `HifzApp/HifzApp/` (nested).

## Run Metro (always run in foreground so you can see logs)
```
pkill -f "expo start" 2>/dev/null; sleep 1
cd /Users/Nuha/Documents/HifzApp/HifzApp && npx expo start --dev-client --clear
```
Kill any stale background Metro first — two instances = port conflict = phone hits wrong one.
Then shake phone → Reload, or close/reopen app.
Mac IP: `ipconfig getifaddr en0` → enter as `http://<IP>:8081` if auto-connect fails.

**If phone shows old code after reload:** shake → "Change Bundle Location" → enter `http://<IP>:<port>` matching what Metro printed in the terminal (check for 8081 vs 8082).

## Build toolchain (see memory: ios-build-toolchain)
- Xcode 26.5, iPhone 17 Pro physical device, free Apple ID signing.
- `ios/HifzApp/HifzApp.entitlements` is an empty `<dict/>` (aps-environment removed).
- First install: Settings → General → VPN & Device Management → Trust developer.

## STT: Speechmatics
Key: `EXPO_PUBLIC_SPEECHMATICS_API_KEY` in `.env`
- `max_delay: 1.0, max_delay_mode: 'flexible'` — forces commits every ≤1 s without pause
- `enable_partials: true` — real-time partials used for live judge / mistake detection only
- Endpoint: `wss://eu2.rt.speechmatics.com/v2`
- Audio: PCM S16LE, 16 kHz, 250 ms chunks via @siteed/audio-studio

---

## Architecture: how completion + mistake detection works (after this session's changes)

### Completion path (`lib/realtimeTranscription.js`)
- Speechmatics fires `AddPartialTranscript` (unstable, real-time) and `AddTranscript` (committed, ~1 s cadence)
- **Partials** → `onPartial(committed + partial)` → live judge only (NOT word reveal)
- **Commits** → `processCommitWords(text)` → word-by-word match against `getExpectedWords()`
  - `matchPos` advances as each expected word is found in committed text
  - On STT omission (1 word): lookahead of +1 to skip missing expected word
  - On STT insertion (extra word): skip silently
  - When `matchPos === expectedWords.length`: fires `onAyahComplete(done)` immediately — **no silence wait**
  - Carry-over words (next-ayah words in same commit) stored in `accumulatedText` for next ayah
- **Commits** also fire `onCommit(accumulatedText)` → `setRevealedWordCount` in RecitationScreen

### Word reveal
- Only committed words drive `revealedWordCount` (not partials — Speechmatics over-predicts Quran text)
- Words 0..revealedCount-1 shown on mushaf; green tint if not in liveWrongIndices

### Mistake detection path (`lib/liveWordJudge.js`)
- Live judge runs on EVERY partial/commit via `liveJudgeRef.current.update(text)`
- Uses DP alignment against expected ayah words
- Fires `onMistake(wrongEntries, liveText)` when a word is clearly wrong
- Skipped for disconnected-letter ayahs (`isDisconnectedLetters`)

### Disconnected letters (الم، يس، الر، etc.)
- `getExpectedWords()` returns `[]` for these ayahs
- `processCommitWords` sees empty expected list → advances on first commit
- `onAyahComplete` already has `isDisconnectedLetters` branch → marks correct, advances

### Mistake state machine (`RecitationScreen.js`)
- `mistakeStateRef.current`: `'none'` | `'awaiting_retry'` | `'tier2_readback'`
- `none` → `awaiting_retry`: first mistake detected in `onAyahComplete`
- `awaiting_retry` → `none`: correct on retry
- `awaiting_retry` → `tier2_readback`: second mistake; shows full ayah with diff highlight, asks to read aloud
- `tier2_readback` → `none` + advance: always advances regardless of correctness
- `getExpectedWords()` returns words[0..n-3] in tier2 (reduced threshold, easier completion)

---

## Known bugs / issues as of this handoff

### 1. CRITICAL: Carry-over words advance `accumulatedText` but not `matchPos`
When `processCommitWords` fires completion for Ayah N, leftover words from the same commit
become `accumulatedText` for Ayah N+1. BUT `matchPos` resets to 0, so the next commit to
`processCommitWords` tries to match expectedWords[0] again — it doesn't re-match the
carry-over words already in `accumulatedText`. The carry-over words ARE in the final `done`
text (correct for wordDiff) but they're NOT advancing `matchPos`, so subsequent commits
keep treating everything as "insertions" and matchPos never moves. This causes the system
to get permanently stuck on Ayah N+1 if the carry-over contained its first words.

**Symptom in logs:** `matchPos=0` stays 0 even as Ayah 2 words (ذلك, الكتاب, etc.) are committed — because the system is waiting for "والذين" (first word of Ayah 4) which arrived as carry-over from Ayah 3 but never re-matched.

**Fix needed:** On each `processCommitWords` call, prepend any pending carry-over words to the incoming commit text before running the matching loop, then clear the carry-over buffer.

### 2. CRITICAL: Carry-over words immediately reveal on mushaf before user recites them
`accumulatedText = carryPart` is set and then `onCommit(accumulatedText)` fires,
setting `revealedWordCount` to include carry-over words. The user sees those words
as "revealed" before saying them.

**Fix needed:** Don't fire `onCommit` for carry-over words immediately. Add a `pendingCarry`
variable; fire it on the next real commit for the new ayah.

### 3. UX: "Harsh cutoff" when ayah completes mid-recitation
The word-by-word match fires `onAyahComplete` the instant the last expected word appears in a commit.
If the user is reciting continuously and a commit spans the boundary, the new ayah loads
while the user is still speaking — the UI abruptly changes context.

### 4. UX: "Autofilling" — mushaf shows words as correct when they weren't
Root cause: carry-over (issue #2 above) + Speechmatics partial over-prediction.
The green reveal appears on words the user didn't recite correctly.

---

## NEW FEATURE REQUEST: Tarteel-style real-time mistake UX

The user wants to rethink the mistake detection UX entirely. Current state: system
accumulates a full ayah, evaluates at the end, shows retry panel. Problems:
- Too late — user doesn't know about the mistake until after the ayah
- Harsh cutoff mid-recitation when switching from retry to normal
- "Autofilling" — words shown as correct they weren't

**Desired behavior (to be confirmed with clarifying questions):**
1. Recite freely, continuously — no stopping
2. As SOON as a wrong word is detected (via live judge), highlight it RED on the mushaf
3. Show a small mistake indicator at the bottom (not a blocking panel)
4. User continues reciting (or stops naturally)
5. When user restarts the ayah from the beginning, system detects this and re-evaluates
6. If they fix all mistakes → advance to next ayah

**Clarifying questions still to be answered by user (see below)**

---

## Clarifying questions for new UX (ANSWER BEFORE IMPLEMENTING)

Before implementing the Tarteel-style UX, get answers to:

1. **What happens during the ayah when a mistake is detected?**
   - Does the user keep reciting forward (current words keep revealing)?
   - Or does the reveal stop at the wrong word?

2. **After detecting a mistake, does the system interrupt the user or stay silent?**
   - Current: blocks with a panel ("Possible mistake detected — please try again")
   - Desired: small non-blocking indicator only?

3. **How does "reciting from the beginning again" get detected?**
   - Option A: first word of the ayah appears in the partial transcript
   - Option B: silence of N seconds, then first word detected
   - Option C: user presses a button to signal restart

4. **On retry: does the user need to recite the WHOLE ayah again, or just the part from the mistake onward?**
   - Whole ayah required (standard in Quran apps)
   - Or: from the wrong word forward?

5. **How many retries are allowed before advancing?**
   - Keep the current 2-tier system (1 retry → tier2 → always advance)?
   - Or unlimited retries until correct?

6. **What should the mushaf look like during retry?**
   - Reset: all words hidden again (standard — re-test from blank)
   - Or: wrong words shown red, correct words shown, only wrong position hidden?

7. **Should the tier2 "read it aloud" feature be kept?**
   - The user seems to want a simpler flow; confirm if tier2 is still needed

8. **Should mistakes still be logged to Supabase mistakes table / quiz_queue?**
   - Yes (keep current Supabase writes) — or change what gets logged?

---

## Key files

| File | Role |
|------|------|
| `screens/RecitationScreen.js` | Main screen; mistake state machine, ayah advance, UI |
| `lib/realtimeTranscription.js` | STT pipeline: Speechmatics WS, `processCommitWords`, callbacks |
| `lib/liveWordJudge.js` | Real-time DP word alignment; fires `onMistake` |
| `lib/arabicUtils.js` | `normalizeArabic`, `wordDiff`, `alignWords` DP |
| `components/MushafPage.js` | Renders 15-line Madinah page with per-word status tints |
| `lib/mushafDb.js` | SQLite helpers: `getPageLines`, `getPageForAyah` |
| `assets/mushaf.db` | QUL Quran DB: pages, lines, words tables |

## Pending backlog (lower priority)
- PreSessionQuiz + PostSessionQuiz: wire up same live judge / recreateJudge pattern
- Single-use Speechmatics tokens via Supabase Edge Function
- `forceOverwrite: false` in App.js SQLiteProvider once mushaf.db schema stable
- Delete legacy: lib/silenceDetection.js, lib/realtimeStt.js, screens/RecitationScreenRealtime.js, screens/WhisperTest.js
