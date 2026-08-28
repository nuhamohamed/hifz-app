-- A quiz-only day is now a real kind of day, not a recitation day in disguise.
--
-- The Today screen said "Quiz only today" and then fabricated a one-ayah
-- portion of juz 1 so the session flow had something to run. The person was
-- walked into recitation anyway, and worse, finishing the day advanced the
-- recitation plan: someone who had completed juz 1 and was not due back for
-- three weeks had it rebooked for the next day starting at ayah 2.
--
--   revision   a recitation day; the portion columns mean what they say
--   quiz_only  due reviews and nothing else; the portion columns are unused
--              and the day never advances the recitation schedule
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'revision';

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_type_check;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_type_check CHECK (type IN ('revision', 'quiz_only'));
