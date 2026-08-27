-- How many times this ayah has been failed. Counted only; nothing changes
-- behaviour at any threshold yet. After a couple of weeks of beta the pattern
-- says which problem exists: different people stuck on different ayahs is real
-- memory trouble, many people stuck on the SAME ayah is the recogniser failing
-- on that verse. Those need opposite fixes, so building either now is a guess.
ALTER TABLE public.quiz_queue
  ADD COLUMN IF NOT EXISTS lapses integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.quiz_queue.lapses IS
  'Times failed. Flagged as a leech at 8, Anki''s threshold. No more than 3 flagged items may appear in one quiz.';
