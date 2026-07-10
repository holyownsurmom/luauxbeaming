
-- These tables are only accessed by server functions using the service role.
-- Discord OAuth is custom (iron-session), so auth.uid() is not applicable.
-- Revoke any anon/authenticated grants and add explicit service-role-only policies.

REVOKE ALL ON public.profiles FROM anon, authenticated;
REVOKE ALL ON public.payments FROM anon, authenticated;
REVOKE ALL ON public.mc_accounts FROM anon, authenticated;

GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.payments TO service_role;
GRANT ALL ON public.mc_accounts TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mc_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role only" ON public.profiles;
CREATE POLICY "service role only" ON public.profiles
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service role only" ON public.payments;
CREATE POLICY "service role only" ON public.payments
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service role only" ON public.mc_accounts;
CREATE POLICY "service role only" ON public.mc_accounts
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
