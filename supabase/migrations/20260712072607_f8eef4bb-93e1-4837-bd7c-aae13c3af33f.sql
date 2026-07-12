
ALTER TABLE public.blacklisted_ips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secured_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_login_ips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_security_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.blacklisted_ips FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.secured_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.user_login_ips FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.verification_security_emails FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.verification_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.verification_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
