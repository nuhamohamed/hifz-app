-- =============================================================================
-- Enable RLS and remove the permissive testing policies
--
-- RLS was switched OFF on all 7 tables despite schema.sql claiming otherwise,
-- and 6 tables carried an "allow all for testing" policy (USING true / WITH
-- CHECK true, role public). Together that meant the anon key -- which ships
-- inside the app binary -- granted full read/write over every user's data.
--
-- Anonymous auth users carry the `authenticated` role plus an is_anonymous JWT
-- claim, so auth.uid() works for them exactly as for permanent users. That is
-- what lets beta users run without signing in while still being isolated.
-- =============================================================================

-- public.users had ONLY the permissive policy, so its own-row policy must be
-- created BEFORE that one is dropped or the app locks itself out.
CREATE POLICY users_own ON public.users
  FOR ALL TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY "allow all for testing" ON public.users;
DROP POLICY "allow all for testing" ON public.sessions;
DROP POLICY "allow all for testing" ON public.mistakes;
DROP POLICY "allow all for testing" ON public.quiz_queue;
DROP POLICY "allow all for testing" ON public.juz_progress;
DROP POLICY "allow all for testing" ON public.scheduled_portions;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memorized_portions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.juz_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mistakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_portions ENABLE ROW LEVEL SECURITY;
