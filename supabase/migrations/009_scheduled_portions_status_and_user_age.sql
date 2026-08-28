-- A scheduled portion is no longer deleted once it has been worked.
--
-- It used to be: the row that drove a session was removed, because portions are
-- picked oldest-first and a leftover row would simply be handed back the next
-- day. That worked, but it threw away the only record of what the app had
-- planned, which a progress or consistency view would need. Marking is
-- reversible and deleting is not.
--
--   pending     waiting to be worked
--   done        a session covered it
--   superseded  the pass was rescheduled before this row was ever reached
ALTER TABLE public.scheduled_portions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.scheduled_portions
  DROP CONSTRAINT IF EXISTS scheduled_portions_status_check;

ALTER TABLE public.scheduled_portions
  ADD CONSTRAINT scheduled_portions_status_check
  CHECK (status IN ('pending', 'done', 'superseded'));

-- Every read of "what is due" filters on this, so it leads the index.
CREATE INDEX IF NOT EXISTS scheduled_portions_pending_idx
  ON public.scheduled_portions (user_id, status, scheduled_date);

-- Age, collected at onboarding alongside name and gender.
--
-- Stored rather than checked and discarded, which is a deliberate choice: it
-- means Dawrah holds personal data about its users and must say so in the
-- privacy policy and Apple's App Privacy form. Under-13s are refused at
-- onboarding rather than stored, which keeps this out of COPPA and out of the
-- UK/EU parental consent regime.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS age integer;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_age_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_age_check CHECK (age IS NULL OR (age >= 13 AND age <= 120));
