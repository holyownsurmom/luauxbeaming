-- ============================================================
-- TABLE: verification_settings
-- Verification bot settings for each Discord user's server
-- ============================================================
CREATE TABLE IF NOT EXISTS public.verification_settings (
  discord_id TEXT PRIMARY KEY REFERENCES public.profiles(discord_id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  verified_role_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_title TEXT NOT NULL DEFAULT 'Verification Required',
  message_description TEXT NOT NULL DEFAULT 'Click the button below to verify your account and gain access to the server.',
  button_text TEXT NOT NULL DEFAULT 'Verify',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.verification_settings TO service_role;
ALTER TABLE public.verification_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.verification_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER verification_settings_touch BEFORE UPDATE ON public.verification_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
