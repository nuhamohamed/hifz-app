-- A slip on one of the ayahs recited around a review question. Those ayahs are
-- not scored, but a slip still writes to the review queue: it adds the ayah, or
-- on a second slip sends it back to box 0. That used to leave nothing behind,
-- so a misheard context ayah could not be seen on the summary, let alone
-- cleared. It now gets a row like any other mistake, under its own source.
--
-- Clearing one puts the queue row back exactly as it was, so the row keeps
-- what it changed: review_prev_box_level and review_prev_next_date as for a
-- review mistake (both null when the ayah was not in the queue before), plus
-- the context count below.
alter table public.mistakes drop constraint if exists mistakes_source_check;
alter table public.mistakes
  add constraint mistakes_source_check
  check (source in ('recitation', 'review', 'review_context'));

alter table public.mistakes
  add column if not exists context_prev_count integer;

comment on column public.mistakes.context_prev_count is
  'For a review_context mistake, the ayah''s context_wrong_count before this slip. Restored when the mistake is cleared.';
