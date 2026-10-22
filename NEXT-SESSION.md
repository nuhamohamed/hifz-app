# Where things stand, and what to do next

Rewritten 21 October 2026. Supersedes the 28 August version. `../HANDOFF.md`
(18 June) is badly out of date and should not be trusted.

---

## State

Branch `fix/beta-p0-scheduling-and-mistakes`, 103 commits ahead of `main`, all
pushed, working tree clean. `main` is still untouched at `a5213e4`.

The beta is live on TestFlight. Version 1.0.0; builds 3 to 7 and 9 shipped.
`app.json` and `ios/Dawrah/Info.plist` were bumped to **10** on 11 September;
whether 10 was ever uploaded is unconfirmed, so check App Store Connect. Either
way, run `npm run bump-build` before the next archive (see the
`ios-archive-checklist` memory).

**Nothing from 21 October has reached testers.** Everything below needs a new
TestFlight build.

---

## What happened on 21 October

### The Supabase project had paused itself

The live project `pcjmmogbjohtvnmrupya` showed status INACTIVE. The free plan
pauses after seven quiet days, and the last session in the database was 26
September. The app hung on its launch spinner, and every database call timed
out. The author restored it from the dashboard; all data survived.

**It will happen again whenever testers go quiet for a week.** Either move to
the paid plan or accept it. If the app "won't load", check the project status
before reading any code.

### Five fixes, all pushed

1. **`8bd16bc` An unreachable server shows an error, not a spinner.** Every
   Supabase request now gives up after 20 seconds. A failed onboarding read no
   longer counts as an empty account, which would have sent finished users
   back to Welcome.
2. **`eba11d8` Finishing a portion can no longer freeze.** Two testers recited
   a whole portion in September and never got past the last screen. The finish
   awaited the microphone stop and two saves with no limit on any of them. The
   native stop is now bounded at 3 seconds and reports
   `transcription.stopRecording` to Sentry if it times out. **If that report
   ever arrives, it confirms the cause**; until then it is the best fit, not a
   proven one.
   The same commit fixes a quiet data bug: **the last ayah of every portion was
   never saved**, so its mistakes were dropped and `last_confirmed_ayah` always
   stopped one short.
3. **`331f5af` Resuming a long portion takes seconds.** Resuming fetched every
   already-recited ayah from quran.com one after another, with no timeout:
   about 147 requests in a row for someone near the end of juz 1. Now fetched
   ten at a time, each giving up after 15 seconds. This is the more likely
   cause of the "infinitely loading" reports, since both testers had resumed
   on a later day.
4. **`0de8877` The post-session quiz is gone.** The author decided testers did
   not need it and it cost too much time. "Done, see summary" now completes the
   session and goes straight to the summary. Details below.
5. **`02b58ee`** Comments only.

### What removing the post-session quiz changed

- **Mistakes still come back for review.** The recap was what put a session's
  mistakes into `quiz_queue`. `queueSessionMistakes()` in `lib/quizEngine.js`
  now does it, called from `applyPendingSessionPlans()` when the session is
  scored. That runs after the summary's corrections, so a mistake cleared as a
  misflag is no longer queued. Before, the recap queued it first.
- **The recap's time goes to the portion.** The allowance in `portionMath.js`
  is removed, so a 30-minute session now holds a slightly longer portion. If
  the author would rather keep portions the same size and shorten sessions,
  that is a small change to `recitationBudgetMinutes()`.
- **The Today agenda has no Recap step.** The progress ring is review 25,
  recitation 75.
- **Old sessions are handled.** One left at `phase = 'post_quiz'` by an older
  build, or fully recited but never completed, is completed and shown its
  summary on the next start.
- The pre-session Mistake Review is unchanged, and so are quiz-only days.
- `RECITATION_SHARE` (0.75) in `portionMath.js` is a rough planning figure for
  onboarding, covering both quizzes. It was left alone and could now be raised.

---

## Not yet run on a device

None of the 21 October work has been run on a phone or simulator. The bundle
builds cleanly with `npx expo export`. No simulator had the app installed, and
the finish and resume paths need real recitation to reach. On the next device
build, check:

1. Recite a short portion to the end, with a mistake or two. "Done, see
   summary" goes to the summary.
2. Those ayahs appear in the next day's Mistake Review.
3. Pause a long portion near the end, then resume. The page appears within a
   few seconds.
4. A mistake on the **last** ayah of the portion appears on the summary.

Still never watched working, carried over from August: the repeat after a bad
session, a halved portion being served, a quiz-only day running to its end,
and the daily reminder switch's on/off gesture.

---

## Sentry

The DSN is in `lib/sentry.js`. Both saved auth tokens (`.env.local` and
`.env.sentry-build-plugin`) can upload but **cannot read issues**, so crash
reports cannot be checked from here. A token with issue read access would fix
that.

---

## Parked: fa heard as waw

Reported 28 August, deliberately not fixed. **Say the letter fa where the ayah
has waw, clearly, and no mistake is flagged.**

The app cannot be the cause: a spoken word either equals the expected word
exactly, after a normalisation that touches neither letter, or it is marked
wrong. There is no fuzzy match anywhere in the decision path. `letterDiff.js`
uses Levenshtein only to colour letters inside a word already judged wrong.

The suspect is the recogniser. A note in `realtimeTranscription.js` says
Speechmatics "over-predicts Quran text in partials". The same pull would smooth
a rare fa prefix into the far commoner waw.

**The next step is evidence, not code.** Commit `918f045` logs per-word
confidence and competing candidates under `__DEV__`. Recite one ayah on a phone
with Metro attached, say the fa deliberately, and read the `[RT-DEBUG]` lines:

- **Waw returned confidently, no alternative:** nothing app-side can catch it.
- **Fa present as a lower-ranked alternative:** judge against the candidates,
  not only the top one.
- **Confidence drops on the substituted word:** the app can at least stop
  claiming the word was correct.

---

## Decisions the author has made

Recorded because they are not all written down elsewhere:

1. **Age is asked, stored, and under-13s are declined.** First question, before
   anything personal is stored. Enforced again as a database constraint.
2. **A quiz-only day is only a quiz.** No fabricated portion, and it never
   advances the recitation schedule.
3. **Starting a session early re-anchors the schedule**, the same rule lateness
   follows, run backwards.
4. **Short on time appears only on heavy days.**
5. **The destructive action is named honestly**: "Erase all my data", red, on
   its own screen.
6. **A whole juz in one sitting is allowed** if the person chose enough minutes.
7. **No post-session quiz** (21 October). Reciting the portion ends the session.

Deferred work lives in [POST-BETA.md](POST-BETA.md), with the reason for
waiting on each.

---

## Settled since August

- Apple Developer enrolment is approved; profiles last a year, not a week.
- The privacy policy is live at https://dawrah.ai/privacy and linked from
  Settings. There is no /terms page.
- The contact address is team@dawrah.ai. There is no privacy@dawrah.ai.
- Speechmatics runs on a $100 free credit with no card on file.

---

## Things that will waste an hour if you do not know them

See the memory files, particularly `ios-build-toolchain`,
`ios-archive-checklist`, `expo-config-plugin-overrides` and
`ios-dev-build-renewal`. The short version:

- `ios/` is **generated**. Never hand-edit it. Change `app.json` and re-run
  prebuild. One plugin overrides `app.json` for the microphone string.
- **Before every archive:** `npm run bump-build`, then `npx expo export`.
  Nothing else moves the build number.
- DerivedData must not live in `~/Documents` (iCloud breaks codesign) nor in
  `~/Library/Application Support`. Use Xcode's default location.
- `pod` needs the portable Ruby's own interpreter and `GEM_HOME`.
- **The Mac's LAN address moves.** Read it with `ipconfig getifaddr en0`. The
  phone reaches Metro at `http://<that>:8081` via "Enter URL manually".
- Build to the phone from Xcode, not the CLI.
- The simulator's coordinate space is **402x874 points**, not the screenshot's
  pixel dimensions.

---

## How this work has been going

Where something was **not** verified, the commit says so explicitly. Keep that
up. The commit messages are long on purpose: they carry the reasoning, so the
next person does not have to re-derive it.

Where a decision was the author's to make, it was asked rather than assumed.
