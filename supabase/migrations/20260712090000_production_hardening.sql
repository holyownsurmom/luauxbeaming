-- Production hardening: secure job type, optional FKs for guild members

-- Allow secure jobs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bot_jobs_type_check'
  ) THEN
    ALTER TABLE public.bot_jobs DROP CONSTRAINT bot_jobs_type_check;
  END IF;
END $$;

ALTER TABLE public.bot_jobs
  ADD CONSTRAINT bot_jobs_type_check
  CHECK (type IN ('mc', 'discord', 'secure'));

-- Verification sessions: guild members may not have profiles
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verification_sessions_discord_id_fkey'
  ) THEN
    ALTER TABLE public.verification_sessions
      DROP CONSTRAINT verification_sessions_discord_id_fkey;
  END IF;
END $$;

-- Secured accounts: same — verifying members are not always LuauX users
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'secured_accounts_discord_id_fkey'
  ) THEN
    ALTER TABLE public.secured_accounts
      DROP CONSTRAINT secured_accounts_discord_id_fkey;
  END IF;
END $$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS bot_jobs_status_created_idx
  ON public.bot_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS verification_settings_guild_id_idx
  ON public.verification_settings (guild_id);
