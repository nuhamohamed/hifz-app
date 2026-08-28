# Where things stand, and what to do next

Written 27 August 2026, at the end of a long working session.

**Note:** `../HANDOFF.md` is from 18 June and is now substantially wrong. It
still calls the app HifzApp, and predates the whole scheduling rewrite. Trust
this file over that one.

---

## State

Branch `fix/beta-p0-scheduling-and-mistakes`, **14 commits ahead of `main`**,
all pushed. `main` is untouched at `a5213e4`. Working tree clean.

Eight schema migrations applied and verified against the live Supabase project
`pcjmmogbjohtvnmrupya`. `supabase/schema.sql` is in step with them.

The full task list lives in an artifact the author has:
**Dawrah TestFlight Checklist**, 74 items. Ask her for the link rather than
rebuilding it from scratch.

---

## The two remaining code tasks

They are one piece of work, because both read the same number.

### Cost the quiz from the ayahs actually due

`getTodayPortion(db, userId, dueQuizMinutes)` already takes this parameter and
**every caller passes 0**. That was deliberate: the plumbing went in early so
the sizing work could land without waiting on it.

`portionMath.js` has `quizItemMinutes(pageShare, minutesPerPage)` and
`quizMinutes(items, minutesPerPage)` ready to use. What is missing is joining
the due `quiz_queue` rows to their page share, which `getJuzAyahPages` in
`mushafDb.js` already returns per ayah.

Why it matters: the quiz is never cut and the portion gives way, so the portion
cannot be sized correctly until the quiz's real cost is known. An ayah's cost
varies enormously — An-Naba 1 is 3 seconds, Al-Baqarah 282 is two minutes — so
a flat per-item estimate is wrong by a factor of 40.

### Per-portion return dates

`updateJuzProgressAfterSession()` in `planEngine.js` currently schedules only
the **next** portion. The settled decision is that when a pass completes, every
portion of it is scheduled individually: the whole pass shifts to begin at
`completion_date + interval` and keeps its internal rhythm.

Worked example the author gave: start juz 2, finish on day 5, earn a 2-day
interval, and day 0's portion is due on day 7, day 1's on day 8.

Why: work then returns at the rate it was created, so the daily load is level
by construction rather than arriving as a lump and being rationed.

`scheduled_portions` already has a unique index on
`(user_id, juz_number, portion_start_ayah, scheduled_date)` that permits several
rows per date, which this needs.

### Then the Today screen

Once the quiz is costed, show `Today: about 35 minutes`, a plain count of
anything waiting, and the line "Short on time? Start anyway. The review comes
first and is the part that matters most."

---

## Waiting on the author, not on code

- **Apple Developer enrollment** — submitted, still pending. Blocks everything.
- **Spending cap at Speechmatics** — the only outstanding transcription item.
- **Legal name and address** for the privacy policy, which still has placeholders.
- **The age question** — an age *gate* (13+, nothing stored) or an age *stored*.
  These have very different privacy consequences. Open decision.
- **`eas login` and `eas init`**, or archive from Xcode instead.

---

## Things that will waste an hour if you do not know them

See the memory files, particularly `ios-build-toolchain` and
`expo-config-plugin-overrides`. The short version:

- `ios/` is **generated**. Never hand-edit it. Change `app.json` and re-run
  prebuild. One plugin overrides `app.json` for the microphone string.
- DerivedData must not live in `~/Documents` (iCloud attributes break codesign)
  nor in `~/Library/Application Support` (node cannot read its own cwd there).
  Use Xcode's default location.
- `pod` needs the portable Ruby's own interpreter and `GEM_HOME`.

---

## How this work has been going

Every change has been run on the simulator before being called done, and that
has repeatedly been the only thing that caught the bug: a 32-second database
query, two missing imports, a permission string that had been wrong for months.
Reading the code was not enough in any of those cases.

Verification claims in the commit messages are real and were checked. Where
something was **not** verified, the commit says so explicitly. Keep that up.
