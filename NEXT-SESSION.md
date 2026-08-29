# Where things stand, and what to do next

Rewritten 28 August 2026, at the end of a long session. Supersedes the version
from 27 August, and `../HANDOFF.md` (18 June) is now badly out of date: it still
calls the app HifzApp and predates the whole scheduling rewrite.

---

## State

Branch `fix/beta-p0-scheduling-and-mistakes`, **31 commits ahead of `main`**, all
pushed, working tree clean. `main` is untouched at `a5213e4`.

Ten schema migrations, all applied and verified against the live Supabase
project `pcjmmogbjohtvnmrupya`. `supabase/schema.sql` is in step.

- `009` adds `scheduled_portions.status` and `users.age`
- `010` adds `sessions.type` (`revision` | `quiz_only`)

The task list lives in an artifact the author has, **Dawrah TestFlight
Checklist**. It was updated on 28 August and now reads nineteen decisions, all
settled, with nothing left in the build column. Ask her for the link.

**Both test accounts were cleared.** The next launch is a genuine first launch.

---

## There is nothing left for me to build except one thing

Every item from the author's interface notes is done except:

- **The mistakes list on the Summary screen should scroll in its own region**,
  with the up-next block staying static. The collapse behaviour is built; the
  scroll region is not.

Everything else on that list shipped. See the commit messages, which are
detailed and honest about what was and was not verified.

---

## The real remaining risk is testing, not code

A great deal of new surface landed today: new onboarding, a rebuilt Home banner,
three new Settings screens, portion-by-portion scheduling. **Every genuine bug
found today came from running the app, not from reading it.** That pattern held
without exception:

- the Summary tab rendering a blank grey screen
- a finished day crossing out tomorrow's portion instead of today's
- the resume button clipped behind the tab bar
- a 9am reminder scheduled for people who had turned reminders off
- "Juz 1 Complete!" for a session that was only paused

Three paths are reasoned about but **have never been watched working**, because
they need real recitation into a microphone:

1. The repeat after a bad session
2. A halved portion actually being served
3. A quiz-only day running to its last item

And one more, because the simulator would not accept synthetic taps on a native
control: **the daily reminder switch's on/off gesture**. The off state was
verified through a reload instead.

---

## Deferred work has a home now

Things deliberately left until after the beta live in [POST-BETA.md](POST-BETA.md),
with the reason for waiting on each. Bugs do not go there; they go in the branch.

---

## Parked: fa heard as waw

Reported 28 August, deliberately not fixed. **Say the letter fa where the ayah
has waw, clearly, and no mistake is flagged.**

Ruled out already: the app cannot be the cause. A spoken word either equals the
expected word exactly, after a normalisation that touches neither letter, or it
is marked wrong. No fuzzy match, no similarity threshold, no edit-distance
tolerance anywhere in the decision path. `letterDiff.js` uses Levenshtein only
to colour letters inside a word already judged wrong.

The suspect is the recogniser. There is a note in `realtimeTranscription.js`
saying Speechmatics "over-predicts Quran text in partials", which is why
partials are not used for word reveal. The same pull would explain this: the
model has Quranic text in its training data and completes toward it, so a rare
fa prefix is smoothed into the far commoner waw.

**The next step is evidence, not code.** Commit `918f045` logs per-word
confidence and competing candidates under `__DEV__`. Recite one ayah on a phone
with Metro attached, say the fa deliberately, read the `[RT-DEBUG]` lines:

- **Waw returned confidently, no alternative** → nothing app-side can catch it;
  belongs with "grading mistakes by kind" as after the beta
- **Fa present as a lower-ranked alternative** → real fix: judge against the
  candidates, not only the top one
- **Confidence drops on the substituted word** → the app can at least stop
  claiming the word was correct

---

## Decisions the author made today

Recorded because they are not all in the checklist artifact:

1. **Age is asked, stored, and under-13s are declined.** First question, before
   anything personal is stored. Enforced again as a database constraint.
2. **A quiz-only day is only a quiz.** No fabricated portion, no recitation, and
   it never advances the recitation schedule. This was settled in conversation
   long ago and never written down, which is how it survived a full audit.
3. **Starting a session early re-anchors the schedule.** The whole rotation
   moves earlier, the same rule lateness follows, run backwards. The author was
   told this lets a keen person compress their round and chose it anyway.
4. **Short on time appears only on heavy days**, not every day.
5. **The destructive action is named honestly.** "Erase all my data", red, on
   its own screen listing what goes. Not "Reset settings".
6. **A whole juz in one sitting is allowed** if the person chose enough minutes
   for it. Flagged as daunting for a first session; the author kept it.

---

## Waiting on the author, not on code

- **Apple Developer enrolment** — submitted, still pending. Blocks TestFlight.
- **Spending cap at Speechmatics** — the last transcription item.
- **Legal name and address** for the privacy policy, which has placeholders.
- **`privacy@dawrah.ai` must receive mail.**
- **App Privacy form** — age is a new declaration now that it is stored.
- **`eas login` and `eas init`**, or archive from Xcode.
- **Twelve tests on a real phone**, none run yet.

---

## Things that will waste an hour if you do not know them

See the memory files, particularly `ios-build-toolchain`,
`expo-config-plugin-overrides` and `ios-dev-build-renewal`. The short version:

- `ios/` is **generated**. Never hand-edit it. Change `app.json` and re-run
  prebuild. One plugin overrides `app.json` for the microphone string.
- DerivedData must not live in `~/Documents` (iCloud attributes break codesign)
  nor in `~/Library/Application Support` (node cannot read its own cwd there).
  Use Xcode's default location.
- `pod` needs the portable Ruby's own interpreter and `GEM_HOME`.
- **The Mac's LAN address moves.** It was 192.168.68.59, then .60 on 28 August.
  Read it with `ipconfig getifaddr en0` rather than trusting a remembered one.
  The phone reaches Metro at `http://<that>:8081` via "Enter URL manually".
- **The dev build profile expires 2 September**, seven days from the last
  renewal. Rebuild from Xcode, not the CLI.
- The simulator's coordinate space is **402x874 points**, not the screenshot's
  pixel dimensions. Taps at pixel coordinates land nowhere.

---

## How this work has been going

Every change was run on the simulator before being called done, and where
something was **not** verified the commit says so explicitly. Keep that up. The
commit messages are long on purpose: they carry the reasoning and the measured
before-and-after numbers, so the next person does not have to re-derive them.

Where a decision was the author's to make, it was asked rather than assumed, and
where a recommendation was overruled the decision was recorded and followed.
