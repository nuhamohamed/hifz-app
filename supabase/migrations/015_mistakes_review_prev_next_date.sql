-- Clearing a review misflag promotes the ayah, and the summary now offers an
-- undo on that. Undo has to put the review date back where it was, and the
-- promoted date cannot be reversed to it: it is derived from the new box level
-- and today, so the original is gone the moment the clear lands.
--
-- This column was in migration 013's first draft, dropped when clearing changed
-- from restoring the old position to promoting past it, and is back for the one
-- job the promote cannot do. The clear itself still ignores it.
alter table public.mistakes
  add column if not exists review_prev_next_date date;

comment on column public.mistakes.review_prev_next_date is
  'Review date the ayah held before this review failure moved it. Only used to undo a cleared misflag exactly; the clear itself derives a fresh date from the promoted box.';
