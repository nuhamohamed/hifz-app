-- Mistake Review failures were invisible after the fact.
--
-- Getting an ayah wrong in the review demoted it to box 0 and counted a lapse,
-- and that was the whole record: nothing was written to `mistakes`, so the
-- session summary listed recitation mistakes only. A misheard word in the
-- review therefore could not be cleared the way the same misheard word could be
-- cleared in the recitation, and it went on shaping the schedule unchallenged.
--
-- `source` says where a mistake came from so the summary can offer each one
-- separately. It defaults to 'recitation', which is what every existing row is.
alter table public.mistakes
  add column if not exists source text not null default 'recitation';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mistakes_source_check'
  ) then
    alter table public.mistakes
      add constraint mistakes_source_check check (source in ('recitation', 'review'));
  end if;
end $$;

comment on column public.mistakes.source is
  'Where the mistake was made: ''recitation'' during the portion, ''review'' during the pre-session Mistake Review.';

-- Clearing a review misflag advances the item a box, the way a correct first
-- answer would have, so it needs to know where the item stood before the failed
-- answer knocked it to zero. Recorded at the moment the mistake is written,
-- because by the time anyone disputes it the queue row has been overwritten.
-- Null on recitation rows, which never had a queue position to lose.
alter table public.mistakes
  add column if not exists review_prev_box_level smallint;

comment on column public.mistakes.review_prev_box_level is
  'Box level the ayah held before this review failure demoted it. Used to advance it correctly when the failure is cleared as a misflag.';

-- The summary now reads one source at a time.
create index if not exists mistakes_live_session_source_idx
  on public.mistakes (session_id, source)
  where dismissed_at is null;
