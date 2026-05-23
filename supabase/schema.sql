-- =============================================================================
-- Hifz App — database schema
-- Reference only: paste into Supabase SQL Editor to apply or update.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- users (id matches Supabase Auth user)
-- -----------------------------------------------------------------------------
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  session_minutes integer,
  notification_time time,
  avg_minutes_per_page double precision NOT NULL DEFAULT 2.0
);

CREATE UNIQUE INDEX users_email_key ON public.users (email);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Auto-create public.users row when someone signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email);
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
  cumulative_tier2_mistakes integer NOT NULL DEFAULT 0,
  gate_passed boolean NOT NULL DEFAULT false,
  next_full_review_date date,
  current_portion_ayahs integer
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
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT sessions_status_check CHECK (
    status IN ('in_progress', 'paused', 'complete')
  )
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
  CONSTRAINT scheduled_portions_type_check CHECK (
    type IN ('revision', 'full_juz_review')
  )
);

CREATE INDEX scheduled_portions_user_id_idx ON public.scheduled_portions (user_id);

ALTER TABLE public.scheduled_portions ENABLE ROW LEVEL SECURITY;
