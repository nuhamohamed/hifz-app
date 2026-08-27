-- Wall-clock seconds spent in the recitation phase alone, so reciting pace can
-- be measured. started_at and completed_at span the whole session including
-- both quizzes, which would make everyone look far slower than they read.
--
-- Null on older sessions and on any session that did not reach recitation.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS recitation_seconds integer;

COMMENT ON COLUMN public.sessions.recitation_seconds IS
  'Wall clock for the recitation phase only. Feeds avg_minutes_per_page once five plausible sessions exist. Implausible values are discarded rather than averaged, since this is wall clock and includes any pause.';
