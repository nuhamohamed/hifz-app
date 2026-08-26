-- =============================================================================
-- Anonymous auth support
-- Run in the Supabase SQL Editor. Required before the app can launch without
-- a sign-in screen.
-- =============================================================================

-- Anonymous auth users have no email, but public.users.email was NOT NULL and
-- the signup trigger copies NEW.email straight across -- so without this the
-- trigger raises a not-null violation and every anonymous signup fails.
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;

-- Empty-string emails would collide on users_email_key; NULLs do not, since
-- Postgres treats each NULL as distinct in a unique index.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NULLIF(NEW.email, ''));
  RETURN NEW;
END;
$$;
