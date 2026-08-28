-- =============================================================================
-- Hifz App — database schema
-- Reference only: paste into Supabase SQL Editor to apply or update.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- users (id matches Supabase Auth user)
-- -----------------------------------------------------------------------------
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text,  -- null for anonymous users; backfilled when they link an account
  created_at timestamptz NOT NULL DEFAULT now(),
  session_minutes integer,
  notification_time time,
  avg_minutes_per_page double precision NOT NULL DEFAULT 2.0,
  name text,
  gender text CHECK (gender IN ('male', 'female')),
  -- Collected at onboarding and kept. Under-13s are refused rather than
  -- stored, which is what keeps this out of COPPA and the UK/EU parental
  -- consent regime; the floor is enforced here as well as in the app.
  age integer CHECK (age IS NULL OR (age >= 13 AND age <= 120)),
  onboarding_completed boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX users_email_key ON public.users (email);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Anonymous auth users get the `authenticated` role, so auth.uid() works for
-- them too -- beta users run without signing in and stay isolated from each
-- other. See supabase/migrations/003_enable_rls.sql.
CREATE POLICY users_own ON public.users
  FOR ALL TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Auto-create public.users row when someone signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NULLIF(NEW.email, ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- memorized_portions
-- -----------------------------------------------------------------------------
CREATE TABLE public.memorized_portions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  juz_number integer NOT NULL,
  surah_start integer NOT NULL,
  ayah_start integer NOT NULL,
  surah_end integer NOT NULL,
  ayah_end integer NOT NULL
);

CREATE INDEX memorized_portions_user_id_idx ON public.memorized_portions (user_id);

ALTER TABLE public.memorized_portions ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- juz_progress
-- -----------------------------------------------------------------------------
CREATE TABLE public.juz_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  juz_number integer NOT NULL,
  -- Every mistake made during the current pass. Resets to 0 when the pass
  -- completes, so it cannot climb across visits.
  pass_mistakes integer NOT NULL DEFAULT 0,
  -- Has this juz been through at least one full pass. Separates "waiting for
  -- its review date" from "not reached yet"; carries no pass/fail meaning.
  first_pass_complete boolean NOT NULL DEFAULT false,
  next_full_review_date date,
  -- The gap the spaced repetition schedule is currently multiplying, in days.
  -- Null until the first pass completes.
  interval_days integer,
  -- Two portion sizes exist, full or half. Nothing ever grows: the minutes
  -- the person chose are the ceiling.
  portion_halved boolean NOT NULL DEFAULT false,
  -- Whether the one permitted repeat has been spent on the current stretch.
  repeat_used boolean NOT NULL DEFAULT false
);

CREATE INDEX juz_progress_user_id_idx ON public.juz_progress (user_id);
CREATE UNIQUE INDEX juz_progress_user_id_juz_number_key ON public.juz_progress (user_id, juz_number);

ALTER TABLE public.juz_progress ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- sessions
-- -----------------------------------------------------------------------------
CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  date date NOT NULL,
  status text NOT NULL,
  juz_number integer NOT NULL,
  portion_start_ayah integer NOT NULL,
  portion_end_ayah integer NOT NULL,
  last_confirmed_ayah integer,
  phase text NOT NULL DEFAULT 'pre_quiz',
  started_at timestamptz,
  completed_at timestamptz,
  -- Wall clock for the RECITATION phase alone. started_at to completed_at
  -- spans both quizzes too, which would make everyone look slower than
  -- they read. Feeds avg_minutes_per_page once five plausible sessions
  -- exist; implausible values are discarded rather than averaged.
  recitation_seconds integer,
  -- What kind of day this was. 'quiz_only' means due reviews and nothing else:
  -- the portion columns are unused and the day never advances the recitation
  -- schedule. The screen used to promise "Quiz only today" and then fabricate a
  -- one-ayah portion of juz 1 so the flow had something to run, which walked
  -- people into recitation and rebooked juz they had already finished.
  type text NOT NULL DEFAULT 'revision',
  CONSTRAINT sessions_status_check CHECK (
    status IN ('in_progress', 'paused', 'complete')
  ),
  CONSTRAINT sessions_type_check CHECK (
    type IN ('revision', 'quiz_only')
  ),
  CONSTRAINT sessions_phase_check CHECK (
    phase IN ('pre_quiz', 'revision', 'post_quiz', 'complete')
  ),
  -- Guards the once-per-session plan update: juz mistake count, review
  -- interval, and tomorrow's scheduled portion. Must be persisted rather
  -- than held in component state, since the summary is a tab that can be
  -- reopened at any time.
  plan_applied boolean NOT NULL DEFAULT false
);

CREATE INDEX sessions_user_id_idx ON public.sessions (user_id);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- mistakes
-- -----------------------------------------------------------------------------
CREATE TABLE public.mistakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  surah_number integer NOT NULL,
  ayah_number integer NOT NULL,
  tier integer NOT NULL,
  wrong_words text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mistakes_user_id_idx ON public.mistakes (user_id);
CREATE INDEX mistakes_session_id_idx ON public.mistakes (session_id);

ALTER TABLE public.mistakes ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- quiz_queue
-- -----------------------------------------------------------------------------
CREATE TABLE public.quiz_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  surah_number integer NOT NULL,
  ayah_number integer NOT NULL,
  box_level integer NOT NULL DEFAULT 0,
  next_review_date date,
  context_wrong_count integer NOT NULL DEFAULT 0,
  last_result text,
  times_correct_first integer NOT NULL DEFAULT 0,
  -- Times this ayah has been failed. Flagged as a leech at 8, which is
  -- Anki's threshold. Counted only; no more than 3 flagged items may
  -- appear in one quiz, so they cannot crowd out everything else due.
  lapses integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quiz_queue_user_id_idx ON public.quiz_queue (user_id);

ALTER TABLE public.quiz_queue ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- scheduled_portions
-- -----------------------------------------------------------------------------
CREATE TABLE public.scheduled_portions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  juz_number integer NOT NULL,
  portion_start_ayah integer NOT NULL,
  portion_end_ayah integer NOT NULL,
  type text NOT NULL,
  -- Worked portions are marked, not deleted. Portions are picked oldest-first,
  -- so a row left pending after its session would be handed straight back the
  -- next day; deleting it was the first fix, but that threw away the only
  -- record of what the app had planned. 'superseded' is a row the person never
  -- reached before the pass was rescheduled around it.
  status text NOT NULL DEFAULT 'pending',
  CONSTRAINT scheduled_portions_type_check CHECK (
    type IN ('revision', 'full_juz_review')
  ),
  CONSTRAINT scheduled_portions_status_check CHECK (
    status IN ('pending', 'done', 'superseded')
  )
);

CREATE INDEX scheduled_portions_user_id_idx ON public.scheduled_portions (user_id);

-- Several juz can legitimately have portions due on the same date, so the
-- guard against duplicate writes keys on the juz and its starting offset.
CREATE UNIQUE INDEX scheduled_portions_unique_slot
  ON public.scheduled_portions (user_id, juz_number, portion_start_ayah, scheduled_date);

-- Every read of "what is due" filters on status, so it leads the index.
CREATE INDEX scheduled_portions_pending_idx
  ON public.scheduled_portions (user_id, status, scheduled_date);

ALTER TABLE public.scheduled_portions ENABLE ROW LEVEL SECURITY;
