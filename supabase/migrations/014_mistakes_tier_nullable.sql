-- Tiers are gone from the app: every mistake counts the same everywhere, and
-- has for a while. What kept the old severity heuristic alive was this column
-- being NOT NULL with no default, so every insert had to put *something* in it.
-- The number it wrote drove nothing and was read by nothing.
--
-- Made nullable rather than dropped. The 67 rows that carry a tier are the only
-- record of how mistakes were graded while that grading was live, and migration
-- 012 already settled the principle here: mistake history is kept, not deleted,
-- because rewriting it changes what past sessions looked like. New rows simply
-- leave it empty.
alter table public.mistakes
  alter column tier drop not null;

comment on column public.mistakes.tier is
  'Dead. Severity grade from when mistakes were tiered; nothing reads it and new rows leave it null. Kept for the rows written while tiering was live.';
