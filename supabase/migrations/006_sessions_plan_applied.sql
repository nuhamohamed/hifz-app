-- Whether this session has already had its consequences applied: the juz
-- mistake count updated, the interval recomputed, and tomorrow's portion
-- scheduled.
--
-- That work used to be guarded by a React ref, which resets on every mount, so
-- opening the summary screen twice for the same session applied it twice:
-- mistakes double-counted, the review interval multiplied twice, and a second
-- scheduled row written. It becomes constant rather than occasional now that
-- the summary is a tab the person can open whenever they like.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS plan_applied boolean NOT NULL DEFAULT false;

UPDATE public.sessions SET plan_applied = true WHERE status = 'complete';
