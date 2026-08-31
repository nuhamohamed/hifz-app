-- Dismissing a misflag used to DELETE the row, which destroyed two things: the
-- history behind any mistakes-over-time trend, and the only evidence the
-- recogniser had flagged something a person then disagreed with. That second one
-- is the app's own false-positive rate, which is the number that decides whether
-- transcription is good enough to keep.
--
-- Nullable and additive, so existing rows and the running build are unaffected.
-- Every read is being changed to add `dismissed_at is null`; until that ships an
-- older client simply sees every row as it did before.
alter table public.mistakes
  add column if not exists dismissed_at timestamptz;

comment on column public.mistakes.dismissed_at is
  'Set when the person cleared this as a misflag on the session summary. Non-null rows are excluded from mistake counts, the recap quiz and the review queue, but are kept as the record of a recogniser false positive.';

-- Every mistake read now filters on this, and they all filter by session or user
-- first, so a partial index on the live rows keeps those lookups cheap without
-- indexing history that is never queried on its own.
create index if not exists mistakes_live_session_idx
  on public.mistakes (session_id)
  where dismissed_at is null;
