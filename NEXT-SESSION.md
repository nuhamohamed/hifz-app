# Where things stand, and what to do next

Written 27 August 2026, at the end of a long working session.

**Note:** `../HANDOFF.md` is from 18 June and is now substantially wrong. It
still calls the app HifzApp, and predates the whole scheduling rewrite. Trust
this file over that one.

---

## State

Branch `fix/beta-p0-scheduling-and-mistakes`, 14 commits ahead of `main` and
pushed, plus **one working tree of uncommitted changes** across seven files
(the scheduling and quiz-costing work below). `main` is untouched at `a5213e4`.

Ten schema migrations applied and verified against the live Supabase project
`pcjmmogbjohtvnmrupya`. `supabase/schema.sql` is in step with them. `009` adds
`scheduled_portions.status` and `users.age`; `010` adds `sessions.type`.

The full task list lives in an artifact the author has:
**Dawrah TestFlight Checklist**, 74 items. Ask her for the link rather than
rebuilding it from scratch.

---

## The two remaining code tasks are done

Both landed on 28 August, and both were run on the simulator against the live
database before being called done.

### Cost the quiz from the ayahs actually due: done

`getAyahPageShares()` in `mushafDb.js` answers the page-share question for a
scattered set of ayahs, which is what the quiz needs: due items come from
wherever mistakes were made and cross juz freely, so there is no range to
sweep. `dueQuizCost()` in `quizEngine.js` joins that to the due queue, and
`getTodayPlan()` in `planEngine.js` costs the quiz *before* sizing the portion.

Verified on the simulator: with eight of the longest ayahs in the Qur'an due,
the portion gave way from **Al-Fatihah 1 to Al-Baqarah 88 (95 ayat)** to
**Al-Fatihah 1 to Al-Baqarah 62 (69 ayat)**, and the day still totalled 30
minutes. 26 ayahs surrendered to pay for the quiz, which is the quiz being paid
first rather than overrunning.

### Per-portion return dates: done

`scheduleCompletedPass()` in `planEngine.js` replaces the single
`full_juz_review` row. Every portion of the finished pass is written
individually, shifted so the pass begins at `completion_date + interval` and
keeps its internal rhythm.

Verified against the live database with a six-day pass through juz 1 finishing
27 August and earning 7 days: six rows on 3 to 8 September, starting at offsets
1, 26, 51, 76, 101 and 126. Not one row for the whole juz.

### Then the Today screen: done

"Today: about 35 minutes", "2 juz waiting", and the short-on-time line, all
confirmed rendering on the simulator.

---

## Three bugs found on the way, all fixed

- **`updateJuzProgressAfterSession()` threw on every completed session.** It
  read `portionStartAyah`, which was never a parameter and never in scope, so
  it was a `ReferenceError` in strict mode. It fires on the Summary screen, and
  the Summary screen is now the only place a session's consequences are
  applied, so no session had been able to shrink a portion, halve a plan or
  schedule anything since the parameter list last changed. Now passed in.

- **Halving was silently thrown away.** A bad session wrote a halved range into
  `scheduled_portions`, but `mapScheduledRow()` deliberately ignores the stored
  end and recomputes, without the halved flag. Since scheduled rows are the
  normal path, the halving never once took effect. The flag is now read and
  passed through.

- **Portions were picked newest-first.** That worked only because a pass had one
  row outstanding at a time and consumed rows were never deleted; picking the
  newest was how stale rows were stepped over. With a pass now laid out all at
  once, newest-first hands back the *end* of a juz and skips everything before
  it. Now oldest-first, with consumed rows deleted at the end of each session.
  Confirmed on the simulator: a six-portion backlog offers Al-Fatihah 1, not
  offset 126.

Two judgement calls, one of which the author then changed:

1. **A pass is recovered by walking back to the session that started at offset
   1**, rather than by adding a column to mark where a pass began. Self-
   contained, needs no migration, and degrades to the old whole-juz row if it
   ever cannot tell. Kept.
2. **Worked scheduled rows were deleted; they are now marked instead.** The
   author asked about a future progress dashboard, which tipped it: deleting is
   irreversible and the schedule is the only thing `sessions` cannot
   reconstruct. Migration `009` adds `status` to `scheduled_portions`.

   Three states, and the distinction is load-bearing. `done` is ground a session
   actually covered. `superseded` is a row abandoned when a completed pass was
   laid out afresh around it. `pending` is everything still owed, **including
   overdue rows the person has not reached yet**: falling behind never clears
   the backlog, it just leaves it waiting, which is the settled handling of
   overflow. Marking a whole overdue backlog `done` would have been the shorter
   query and would have credited people for portions they skipped.

---

## Checked against the settled decisions, and three things did not match

Worth doing again after any scheduling change, because all three of these read
as correct in the code and were only wrong against the written decision.

- **The estimate had a 5-minute floor.** The decision costs a quiz per ayah from
  its real page share, so three short ayahs is about 22 seconds. A floor turned
  that into "about 5 minutes", overstating a light day eightfold in the one
  place the app promises an honest number. It now rounds to the minute below ten
  and to five above, and shows nothing at all when nothing is due.

- **A backlog was being erased.** Overdue rows the person had not reached were
  marked `superseded` and replaced with a single rolling portion. That quietly
  rewrote five waiting portions into one larger one, against "nothing is dropped
  and nothing is crammed". They now stay `pending` and come back oldest-first,
  one day at a time. Only the ground a session actually covered is closed out.

- **"Tomorrow: Quiz only" was a lie to anyone behind.** Both tomorrow lookups
  matched tomorrow's date exactly, which was survivable while a juz had one row
  outstanding. With a pass laid out in full, anyone a single day behind has
  their next portion sitting in the past, so the query found nothing and
  promised them a free day. Now `<= tomorrow`, ordered as the planner orders it.
  Confirmed on the simulator: reads "Tomorrow: Juz 1, Al-Baqarah 19-43".

One gap this opened and closed: a session ends where today's budget runs out,
not where the row said it would, so someone who has cut their session length can
stop short of the row they were working through. Without a check the next row
starts beyond where they reached and the ayahs between are skipped for a whole
round. `updateJuzProgressAfterSession` now compares the next pending offset
against where the session actually stopped and fills the gap.

Also removed the em dashes from six user-facing strings, per the standing rule.
One remains in `SessionSummaryScreen` as a placeholder glyph for an empty value,
which is typography rather than copy.

---

## A quiz-only day is now genuinely quiz only

**This decision is not written down in the checklist.** The phrase "quiz only"
does not appear anywhere on that page; the author settled it in conversation and
had to raise it a second time. Worth adding to the artifact so the next session
finds it.

What the app did: the Today screen said "Quiz only today", then fabricated a
one-ayah portion of juz 1 so the session flow had something to hand the
recitation screen. The agenda still listed three steps, and the person was
walked into reciting Al-Fatihah 1. Finishing the day then applied recitation
consequences off that placeholder.

Measured on the simulator with someone who had **finished** juz 1, next review
booked for 18 September: one quiz-only day rebooked juz 1 for **the next
morning, starting at ayah 2**. Three weeks early, near the start of a juz they
had just completed. Merely opening the Summary tab was enough, because that tab
resolves to the most recent session whatever it was.

Migration `010` adds `sessions.type` (`revision` | `quiz_only`). A quiz-only day
now creates a typed session, shows one agenda step rather than three, says
"Start review" rather than "Start session", and ends when the quiz ends.
`SessionSummaryScreen` refuses to apply consequences for one, which is the guard
that matters because of the tab. And a day with nothing due at all now says
"Nothing is due today. Rest, and come back tomorrow." with no button, instead of
offering a session that would have done nothing.

Verified after the fix: zero scheduled rows written, juz 1 still due 18
September, still marked complete.

---

## Age at onboarding

Settled on 28 August: **ask, store, and refuse under-13s.**

`AgeScreen` is now step 1 of 7, ahead of Welcome's successor screens and before
name, gender or memorisation. That position is deliberate. Someone under 13 is
turned away before Dawrah has stored anything personal about them at all, which
is what keeps this outside COPPA in the US and the parental-consent rules in the
UK and EU. The floor is enforced in the app and again as a database constraint.

**This has paperwork consequences that are not done yet.** Dawrah now holds
personal data it did not hold before, so the privacy policy has to say so and
Apple's App Privacy form has to declare it. Both are already on the "before you
submit" list; age is a new line item on each.

## Parked: fa heard as waw, and the recogniser is the suspect

Reported 28 August, deliberately not fixed yet. **Say the letter fa where the
ayah has waw, clearly, and no mistake is flagged.**

Ruled out already, by reading rather than guessing: the app cannot be the
cause. A spoken word either equals the expected word exactly, after a
normalisation that touches neither letter, or it is marked wrong. There is no
fuzzy match, no similarity threshold and no edit-distance tolerance anywhere in
the decision path. `letterDiff.js` does use Levenshtein, but only to colour the
letters inside a word already judged wrong; it never decides.

So the app never sees the fa. Either the recogniser returns the waw the ayah
expects, or the error is lost after arrival.

The strong suspect is the first. There is a note already in
`realtimeTranscription.js` saying Speechmatics "over-predicts Quran text in
partials", which is why partials are not used for word reveal. The same pull
would explain this exactly: the model has Quranic text in its training data and
completes toward it, and a rare fa prefix is smoothed into the far commoner waw
conjunction. Committed transcripts get the same treatment, and those *are* what
the app judges against.

**The next step is evidence, not code.** Commit `918f045` logs per-word
confidence and competing candidates from `results`, which the app otherwise
throws away, under `__DEV__`. Recite one ayah on a phone with Metro attached,
say the fa deliberately, and read the `[RT-DEBUG]` lines. Three outcomes, three
different answers:

- **Waw returned confidently, no alternative.** Nothing app-side can catch it.
  It belongs with "grading mistakes by kind" as after the beta, and probably
  needs a Qur'an-specific model rather than a general Arabic one.
- **Fa present as a lower-ranked alternative.** Real fix available: judge
  against the candidates rather than only the top one.
- **Confidence drops on the substituted word.** The app can at least stop
  claiming the word was correct, and show it unchecked rather than green.

Worth settling before the beta rather than after, because the author's own
decision notes say drifting into a similar-sounding verse is how huffaz lose
their memorisation. This is that class of error.

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
