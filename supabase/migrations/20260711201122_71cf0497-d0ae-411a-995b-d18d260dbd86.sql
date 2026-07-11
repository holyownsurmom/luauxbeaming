ALTER TABLE public.blacklisted_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.blacklisted_users FOR ALL TO service_role USING (true) WITH CHECK (true);