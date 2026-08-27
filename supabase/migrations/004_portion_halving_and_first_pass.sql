-- Portion sizing state, replacing current_portion_ayahs.
--
-- Portion size is no longer a stored ayah count. It is derived from
-- session_minutes and the person's pace every time a portion is planned, so
-- the only thing that needs persisting is whether the next portion is the full
-- length or half of it. Two sizes exist, never smaller, and nothing ever grows:
-- the minutes someone chose are the ceiling.

ALTER TABLE public.juz_progress
  ADD COLUMN IF NOT EXISTS portion_halved boolean NOT NULL DEFAULT false;

-- Whether the one permitted repeat has been spent on the current stretch.
-- More than 2 mistakes per page sends someone back over the same ground once,
-- at half length. If that repeat also goes badly they move on anyway, still
-- halved, so nobody is pinned to the same five pages during a hard fortnight.
ALTER TABLE public.juz_progress
  ADD COLUMN IF NOT EXISTS repeat_used boolean NOT NULL DEFAULT false;

-- Renamed from gate_passed. The pass/fail gate is gone, but the flag was doing
-- a second, unrelated job: separating "a juz I have finished, now waiting for
-- its review date" from "a juz I have not reached yet". That distinction is
-- what makes someone who knows juz 1 to 15 start at juz 1 and work up, one juz
-- at a time. Same behaviour, honest name, no pass/fail meaning attached.
ALTER TABLE public.juz_progress
  RENAME COLUMN gate_passed TO first_pass_complete;

-- The mistake counter now counts every mistake, tiers having been dropped, and
-- resets at the start of each visit rather than climbing across passes.
ALTER TABLE public.juz_progress
  RENAME COLUMN cumulative_tier2_mistakes TO pass_mistakes;

-- How far the review interval currently stretches for this juz, in days.
-- Null until the first pass completes. Spaced repetition needs somewhere to
-- keep the gap it is multiplying; there has never been one.
ALTER TABLE public.juz_progress
  ADD COLUMN IF NOT EXISTS interval_days integer;

ALTER TABLE public.juz_progress
  DROP COLUMN IF EXISTS current_portion_ayahs;

-- Several juz can legitimately have portions due on the same date now that
-- portions are scheduled individually, so the guard against duplicate writes
-- keys on the juz and its starting offset rather than on the date alone.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_portions_unique_slot
  ON public.scheduled_portions (user_id, juz_number, portion_start_ayah, scheduled_date);
