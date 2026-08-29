# After the beta

Things deliberately not built before the beta, with the reason for waiting.
Nothing here is a bug. Bugs go in the branch and get fixed.

The common thread: each of these needs data the beta will produce, and would
otherwise be designed against guesses.

---

## Make the session length suggestion react to a person's real mistake rate

**What it is.** The suggested session length is computed from two things: how
many juz someone has memorised, and how long a page actually takes them. It
never looks at how many mistakes they make.

That matters because the review is paid for out of the session before the new
portion is, so a person making three or four mistakes a page gets a shorter
portion every day and goes round their memorisation in six or eight weeks
rather than four. The app handles this correctly and quietly: the portion
shrinks, a bad session halves the next one, and whatever does not fit waits as
a backlog.

What it never does is *say* so. It keeps showing the same suggestion, because
the suggestion cannot see mistakes. Someone steadily falling behind is told
fifteen minutes is enough while their "portions waiting" count climbs.

**Why it waits.** It is a feature with real design questions, not a fix:

- How many sessions before a mistake rate is worth trusting? Two bad days in a
  row are not a pattern, and re-suggesting off noise is worse than not
  re-suggesting at all.
- Nudge, or quietly re-suggest? Changing someone's setting without asking is
  wrong; a banner every day is nagging.
- What do you say to a person who is falling behind? "You are making too many
  mistakes, give us more time" is the reading nobody wants, and the honest
  version of that sentence is hard to write.

**What the beta gives you.** Actual mistake rates from real people, which is
exactly the input this needs and the one thing that cannot be guessed. Design it
against those numbers, not against an assumption.

---

## Grade mistakes by kind

Every mistake counts the same today: one flagged ayah is one mistake, whether it
was a single letter or a whole line. The `tier` column still exists on the
mistakes table and is still written, but nothing reads it.

Waiting for the same reason: what the tiers should be, and what should change
because of them, is a question about real recitation data rather than about
code.

---

## Judge recitation against the recogniser's alternatives, not only its top result

Conditional on the evidence, and only if the `fa` heard as `waw` report turns out
to be recogniser-side. See the "Parked: fa heard as waw" section of
[NEXT-SESSION.md](NEXT-SESSION.md) for what has been ruled out and what the
`[RT-DEBUG]` output needs to show.

If the recogniser returns `waw` confidently with no alternative, nothing in the
app can catch it and this belongs here. If `fa` is present as a lower-ranked
candidate, it is a real fix and belongs in the branch, not in this file.
