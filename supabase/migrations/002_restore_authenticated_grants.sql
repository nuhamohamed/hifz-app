-- =============================================================================
-- Restore data grants to the authenticated role
-- Run in the Supabase SQL Editor.
--
-- The authenticated and service_role roles had their DML grants revoked at some
-- point, leaving only `anon` able to read/write. That worked while the app was
-- effectively unauthenticated, but anonymous auth gives users the
-- `authenticated` role, which then fails with:
--     permission denied for table users
-- These are Supabase's own defaults for a public schema.
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Same treatment for anything created later.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
