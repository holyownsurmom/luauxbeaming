-- Production security / ops helpers

-- Atomic bot-hour spend (returns true if hour was deducted)
CREATE OR REPLACE FUNCTION public.spend_bot_hour(p_discord_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_id TEXT;
BEGIN
  UPDATE public.profiles
  SET bot_hours_remaining = bot_hours_remaining - 1
  WHERE discord_id = p_discord_id
    AND bot_hours_remaining >= 1
  RETURNING discord_id INTO updated_id;
  RETURN updated_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.spend_bot_hour(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_bot_hour(TEXT) TO service_role;

-- Allow secure verification jobs for users without a profiles row
-- (guild members verifying via owner-configured bot)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_jobs_discord_id_fkey'
  ) THEN
    ALTER TABLE public.bot_jobs DROP CONSTRAINT bot_jobs_discord_id_fkey;
  END IF;
END $$;
