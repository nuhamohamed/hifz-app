-- One row per short-lived Speechmatics token issued, used only to rate limit.
-- Written by the speechmatics-token edge function with the service role; the
-- app has no business writing its own quota rows, so there is no client policy.
CREATE TABLE IF NOT EXISTS public.transcription_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  issued_on date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcription_tokens_user_day_idx
  ON public.transcription_tokens (user_id, issued_on);

-- RLS on with NO policies: the service role bypasses it, everyone else is
-- refused. A person should not be able to read, and certainly not delete,
-- their own quota rows.
ALTER TABLE public.transcription_tokens ENABLE ROW LEVEL SECURITY;
