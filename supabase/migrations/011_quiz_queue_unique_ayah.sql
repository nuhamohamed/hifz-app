-- Write down a rule the live database already has and the repo never recorded.
--
-- quiz_queue holds one row per ayah waiting for review. Every write to it is an
-- upsert with onConflict 'user_id,surah_number,ayah_number': logging a mistake
-- during recitation, queueing this session's mistakes before the recap, and
-- flagging a context ayah. Postgres can only resolve that conflict target
-- against a unique constraint or index on exactly those columns.
--
-- The index exists on the live project as quiz_queue_user_surah_ayah_key, and
-- has done for long enough that all of the above work. It was created directly
-- against the database and never written into schema.sql or any migration, so
-- the repo has been describing a table that would reject every one of those
-- upserts. Anyone building a database from this repo, for a second environment
-- or a restore, would get an app that records no mistakes and schedules no
-- reviews, and would not find out until someone recited something wrongly.
--
-- IF NOT EXISTS, and the same name the live project already uses, so this is a
-- no-op there and a real index anywhere else.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_queue_user_surah_ayah_key
  ON public.quiz_queue (user_id, surah_number, ayah_number);
