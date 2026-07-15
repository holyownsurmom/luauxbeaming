-- Per-user verification bot credentials (not central LuauX bot)
ALTER TABLE public.verification_settings
  ADD COLUMN IF NOT EXISTS bot_token TEXT,
  ADD COLUMN IF NOT EXISTS bot_public_key TEXT;

CREATE INDEX IF NOT EXISTS verification_settings_bot_public_key_idx
  ON public.verification_settings (bot_public_key)
  WHERE bot_public_key IS NOT NULL;
