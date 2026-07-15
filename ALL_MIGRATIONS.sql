-- ============================================================
-- LuauX FULL SCHEMA BOOTSTRAP (run once in Supabase SQL Editor)
-- Project: vbaussorgaosgzbqnwdy (or any empty Supabase project)
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT where possible
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- updated_at helper
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- plans
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_usd NUMERIC(10,2) NOT NULL,
  max_bots INTEGER NOT NULL DEFAULT 0,
  bot_hours INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 30,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'plan',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'plan';

GRANT SELECT ON public.plans TO anon, authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read plans" ON public.plans;
CREATE POLICY "Public can read plans" ON public.plans FOR SELECT USING (true);

-- MC plans (match landing + dashboard purchase UI)
INSERT INTO public.plans (id, name, price_usd, max_bots, bot_hours, duration_days, features, sort_order, kind)
VALUES
  (
    'starter',
    'Starter',
    15.00,
    1,
    150,
    30,
    '["1 concurrent bot","5 bot-hours / day","Basic telemetry & logs","Standard speed","Community Discord"]'::jsonb,
    1,
    'plan'
  ),
  (
    'pro',
    'Pro',
    25.00,
    5,
    210,
    30,
    '["5 concurrent bots","7 bot-hours / day","Full analytics & live console","Advanced scanner + priority queue","Fast speed","Priority Discord support"]'::jsonb,
    2,
    'plan'
  ),
  (
    'enterprise',
    'Enterprise',
    50.00,
    20,
    420,
    30,
    '["20 concurrent bots","14 bot-hours / day","Custom behaviors & API access","Maximum speed","Early access to features","Dedicated 1:1 support"]'::jsonb,
    3,
    'plan'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  price_usd = EXCLUDED.price_usd,
  max_bots = EXCLUDED.max_bots,
  bot_hours = EXCLUDED.bot_hours,
  duration_days = EXCLUDED.duration_days,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  kind = EXCLUDED.kind;

-- Hour top-ups used by purchase page (hours_1, hours_2, ...)
INSERT INTO public.plans (id, name, price_usd, max_bots, bot_hours, duration_days, features, sort_order, kind)
VALUES
  ('hours_1',  '1 Bot Hour',  1.50, 0, 1,  1, '["Extra runtime"]'::jsonb, 50, 'plan'),
  ('hours_2',  '2 Bot Hours', 3.00, 0, 2,  1, '["Extra runtime"]'::jsonb, 51, 'plan'),
  ('hours_5',  '5 Bot Hours', 7.50, 0, 5,  1, '["Extra runtime"]'::jsonb, 52, 'plan'),
  ('hours_10', '10 Bot Hours',15.00,0, 10, 1, '["Extra runtime"]'::jsonb, 53, 'plan'),
  ('hours_24', '24 Bot Hours',36.00,0, 24, 1, '["Extra runtime"]'::jsonb, 54, 'plan')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  price_usd = EXCLUDED.price_usd,
  bot_hours = EXCLUDED.bot_hours,
  kind = EXCLUDED.kind;

-- Plugin plans
INSERT INTO public.plans (id, name, price_usd, max_bots, bot_hours, duration_days, features, sort_order, kind)
VALUES
  (
    'verification',
    'Verification Bot',
    10.00,
    0,
    0,
    30,
    '["Auto-generated license key","Delivered via Discord DM","30 days of access, renew anytime"]'::jsonb,
    100,
    'plugin'
  ),
  (
    'discord-spam',
    'Discord Spam',
    20.00,
    0,
    0,
    36500,
    '["Unlimited tokens with rotation","Custom message pool & interval","Auto-delete sent messages","Replace mode & failure limit","Bring your own proxy","Live console","Lifetime access"]'::jsonb,
    20,
    'plugin'
  ),
  (
    'discord-autoreply',
    'Discord Auto-Reply',
    20.00,
    0,
    0,
    36500,
    '["DM mode & Friend mode","Humanized reply delay & typing","Multi-token rotation","Auto-accept friend requests (safe)","Bring your own proxy","Live console","Lifetime access"]'::jsonb,
    21,
    'plugin'
  ),
  (
    'discord-bundle',
    'Discord Bundle (Spam + Auto-Reply)',
    30.00,
    0,
    0,
    36500,
    '["Discord Spam lifetime","Discord Auto-Reply lifetime","Save $10 vs buying separately","Live consoles","Lifetime access"]'::jsonb,
    19,
    'plugin'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  price_usd = EXCLUDED.price_usd,
  max_bots = EXCLUDED.max_bots,
  bot_hours = EXCLUDED.bot_hours,
  duration_days = EXCLUDED.duration_days,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  kind = EXCLUDED.kind;

-- Remove obsolete plan ids if present
DELETE FROM public.plans
WHERE id IN (
  'basic',
  'elite',
  'verification-lifetime',
  'discord-spam-lifetime',
  'discord-autoreply-lifetime'
);

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  discord_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  global_name TEXT,
  avatar_url TEXT,
  email TEXT,
  active_plan_id TEXT REFERENCES public.plans(id),
  plan_expires_at TIMESTAMPTZ,
  bot_hours_remaining NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.profiles;
CREATE POLICY "service role only" ON public.profiles
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS profiles_touch ON public.profiles;
CREATE TRIGGER profiles_touch
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ------------------------------------------------------------
-- payments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL REFERENCES public.profiles(discord_id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.plans(id),
  np_payment_id TEXT UNIQUE,
  np_order_id TEXT UNIQUE NOT NULL,
  pay_currency TEXT NOT NULL,
  pay_amount NUMERIC(20,8),
  pay_address TEXT,
  price_amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  confirmations INTEGER NOT NULL DEFAULT 0,
  required_confirmations INTEGER NOT NULL DEFAULT 2,
  raw_payload JSONB,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS payments_discord_created_idx
  ON public.payments(discord_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_fulfilled_at_idx
  ON public.payments (fulfilled_at)
  WHERE fulfilled_at IS NULL;

GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.payments;
CREATE POLICY "service role only" ON public.payments
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS payments_touch ON public.payments;
CREATE TRIGGER payments_touch
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ------------------------------------------------------------
-- mc_accounts  (CREATE before any ALTER)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mc_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL REFERENCES public.profiles(discord_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('microsoft','ssid','offline')),
  username TEXT,
  ssid TEXT,
  uuid TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mc_accounts ADD COLUMN IF NOT EXISTS uuid TEXT;

CREATE INDEX IF NOT EXISTS mc_accounts_discord_idx ON public.mc_accounts(discord_id);

GRANT ALL ON public.mc_accounts TO service_role;
ALTER TABLE public.mc_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.mc_accounts;
CREATE POLICY "service role only" ON public.mc_accounts
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- verification_keys
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verification_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered BOOLEAN NOT NULL DEFAULT false,
  source_payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  plugin_id TEXT NOT NULL DEFAULT 'verification'
);

ALTER TABLE public.verification_keys
  ADD COLUMN IF NOT EXISTS plugin_id TEXT NOT NULL DEFAULT 'verification';

CREATE INDEX IF NOT EXISTS verification_keys_discord_idx
  ON public.verification_keys(discord_id, expires_at DESC);

DROP INDEX IF EXISTS public.verification_keys_source_payment_id_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS verification_keys_source_payment_plugin_uidx
  ON public.verification_keys (source_payment_id, plugin_id)
  WHERE source_payment_id IS NOT NULL;

GRANT ALL ON public.verification_keys TO service_role;
ALTER TABLE public.verification_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.verification_keys;
CREATE POLICY "service role only" ON public.verification_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- bot_jobs / bot_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bot_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL REFERENCES public.profiles(discord_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  config JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  worker_id TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_jobs_type_check') THEN
    ALTER TABLE public.bot_jobs DROP CONSTRAINT bot_jobs_type_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_jobs_status_check') THEN
    ALTER TABLE public.bot_jobs DROP CONSTRAINT bot_jobs_status_check;
  END IF;
END $$;

ALTER TABLE public.bot_jobs
  ADD CONSTRAINT bot_jobs_type_check
  CHECK (type IN ('mc', 'discord', 'secure'));

ALTER TABLE public.bot_jobs
  ADD CONSTRAINT bot_jobs_status_check
  CHECK (status IN (
    'pending', 'running', 'stopping', 'stopped', 'error', 'completed', 'paused'
  ));

CREATE INDEX IF NOT EXISTS bot_jobs_status_idx
  ON public.bot_jobs(status)
  WHERE status IN ('pending', 'stopping');
CREATE INDEX IF NOT EXISTS bot_jobs_discord_idx
  ON public.bot_jobs(discord_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bot_jobs_status_created_idx
  ON public.bot_jobs (status, created_at);

DROP TRIGGER IF EXISTS bot_jobs_touch ON public.bot_jobs;
CREATE TRIGGER bot_jobs_touch
  BEFORE UPDATE ON public.bot_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

GRANT ALL ON public.bot_jobs TO service_role;
ALTER TABLE public.bot_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.bot_jobs;
CREATE POLICY "service role only" ON public.bot_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.bot_logs (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.bot_jobs(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'chat', 'bot', 'system')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_logs_job_idx ON public.bot_logs(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bot_logs_user_idx ON public.bot_logs(discord_id, created_at DESC);

GRANT ALL ON public.bot_logs TO service_role;
ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.bot_logs;
CREATE POLICY "service role only" ON public.bot_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Atomic job claim
CREATE OR REPLACE FUNCTION public.claim_bot_jobs(
  p_worker_id TEXT,
  p_limit INT DEFAULT 3
)
RETURNS SETOF public.bot_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH cte AS (
    SELECT id
    FROM public.bot_jobs
    WHERE status = 'pending'
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 3), 10))
  )
  UPDATE public.bot_jobs j
  SET
    status = 'running',
    worker_id = p_worker_id,
    started_at = NOW()
  FROM cte
  WHERE j.id = cte.id
  RETURNING j.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_bot_jobs(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_bot_jobs(text, integer) TO service_role;

-- ------------------------------------------------------------
-- admins
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admins (
  discord_id TEXT PRIMARY KEY,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.admins TO service_role;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.admins;
CREATE POLICY "service role only" ON public.admins
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- blacklist
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blacklisted_users (
  discord_id TEXT PRIMARY KEY,
  reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

GRANT ALL ON public.blacklisted_users TO service_role;
ALTER TABLE public.blacklisted_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.blacklisted_users;
CREATE POLICY "service role only" ON public.blacklisted_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.blacklisted_ips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip TEXT NOT NULL,
  reason TEXT,
  source_discord_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blacklisted_ips_ip_idx ON public.blacklisted_ips(ip);
CREATE INDEX IF NOT EXISTS blacklisted_ips_source_idx ON public.blacklisted_ips(source_discord_id);

GRANT ALL ON public.blacklisted_ips TO service_role;
ALTER TABLE public.blacklisted_ips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.blacklisted_ips;
DROP POLICY IF EXISTS "service_role_all" ON public.blacklisted_ips;
CREATE POLICY "service role only" ON public.blacklisted_ips
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.user_login_ips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_login_ips_discord_idx ON public.user_login_ips(discord_id);
CREATE INDEX IF NOT EXISTS user_login_ips_ip_idx ON public.user_login_ips(ip);

GRANT ALL ON public.user_login_ips TO service_role;
ALTER TABLE public.user_login_ips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.user_login_ips;
DROP POLICY IF EXISTS "service_role_all" ON public.user_login_ips;
CREATE POLICY "service role only" ON public.user_login_ips
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- verification settings / sessions / secured accounts
-- ------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS verification_settings_guild_id_idx
  ON public.verification_settings (guild_id);

GRANT ALL ON public.verification_settings TO service_role;
ALTER TABLE public.verification_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.verification_settings;
DROP POLICY IF EXISTS "service_role_all" ON public.verification_settings;
CREATE POLICY "service role only" ON public.verification_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS verification_settings_touch ON public.verification_settings;
CREATE TRIGGER verification_settings_touch
  BEFORE UPDATE ON public.verification_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.verification_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  mc_username TEXT NOT NULL,
  mc_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','otp_sent','authenticated','securing','secured','failed')),
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
DROP POLICY IF EXISTS "service role only" ON public.verification_sessions;
DROP POLICY IF EXISTS "service_role_all" ON public.verification_sessions;
CREATE POLICY "service role only" ON public.verification_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS verification_sessions_touch ON public.verification_sessions;
CREATE TRIGGER verification_sessions_touch
  BEFORE UPDATE ON public.verification_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.secured_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.verification_sessions(id) ON DELETE SET NULL,
  discord_id TEXT NOT NULL,
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
DROP POLICY IF EXISTS "service role only" ON public.secured_accounts;
DROP POLICY IF EXISTS "service_role_all" ON public.secured_accounts;
CREATE POLICY "service role only" ON public.secured_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

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
DROP POLICY IF EXISTS "service role only" ON public.verification_security_emails;
DROP POLICY IF EXISTS "service_role_all" ON public.verification_security_emails;
CREATE POLICY "service role only" ON public.verification_security_emails
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Lock down direct client access
REVOKE ALL ON public.profiles FROM anon, authenticated;
REVOKE ALL ON public.payments FROM anon, authenticated;
REVOKE ALL ON public.mc_accounts FROM anon, authenticated;
REVOKE ALL ON public.bot_jobs FROM anon, authenticated;
REVOKE ALL ON public.bot_logs FROM anon, authenticated;
REVOKE ALL ON public.verification_keys FROM anon, authenticated;
REVOKE ALL ON public.admins FROM anon, authenticated;

-- Done
SELECT 'LuauX schema ready' AS status;

-- Atomic bot-hour spend
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

-- Secure jobs may reference guild members without a profiles row
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_jobs_discord_id_fkey'
  ) THEN
    ALTER TABLE public.bot_jobs DROP CONSTRAINT bot_jobs_discord_id_fkey;
  END IF;
END $$;

-- Payment grant ledger (idempotent fulfills)
CREATE TABLE IF NOT EXISTS public.payment_grants (
  payment_id UUID PRIMARY KEY REFERENCES public.payments(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  hours_added NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_grants_discord_idx ON public.payment_grants (discord_id, created_at DESC);
GRANT ALL ON public.payment_grants TO service_role;
ALTER TABLE public.payment_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.payment_grants;
CREATE POLICY "service role only" ON public.payment_grants FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.payment_grants FROM anon, authenticated;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS granted_at TIMESTAMPTZ;

-- Orphan job sweeper (worker crash / network partition)
CREATE OR REPLACE FUNCTION public.reclaim_stale_bot_jobs(
  p_stale_minutes INT DEFAULT 45
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT;
  mins INT := GREATEST(5, LEAST(COALESCE(p_stale_minutes, 45), 1440));
BEGIN
  WITH doomed AS (
    UPDATE public.bot_jobs
    SET
      status = 'error',
      error = COALESCE(
        NULLIF(error, ''),
        'Worker lost contact — job reclaimed as stale'
      ) || ' (stale reclaim)',
      stopped_at = NOW(),
      worker_id = NULL
    WHERE status IN ('running', 'stopping', 'paused')
      AND COALESCE(updated_at, started_at, created_at) < NOW() - (mins || ' minutes')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*)::INT INTO n FROM doomed;
  RETURN COALESCE(n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.reclaim_stale_bot_jobs(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_stale_bot_jobs(INT) TO service_role;

CREATE INDEX IF NOT EXISTS bot_jobs_stale_reclaim_idx
  ON public.bot_jobs (status, updated_at)
  WHERE status IN ('running', 'stopping', 'paused');

CREATE OR REPLACE FUNCTION public.refund_bot_hour(p_discord_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_id TEXT;
BEGIN
  UPDATE public.profiles
  SET bot_hours_remaining = bot_hours_remaining + 1
  WHERE discord_id = p_discord_id
  RETURNING discord_id INTO updated_id;
  RETURN updated_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_bot_hour(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_bot_hour(TEXT) TO service_role;

-- Optional MSA refresh_token + global leaderboard
ALTER TABLE public.mc_accounts
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.leaderboard_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT 'secured'
    CHECK (event_type IN ('secured')),
  source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leaderboard_events_created_idx ON public.leaderboard_events (created_at DESC);
CREATE INDEX IF NOT EXISTS leaderboard_events_discord_created_idx ON public.leaderboard_events (discord_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_events_source_unique ON public.leaderboard_events (source_id) WHERE source_id IS NOT NULL;
GRANT ALL ON public.leaderboard_events TO service_role;
ALTER TABLE public.leaderboard_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.leaderboard_events;
CREATE POLICY "service role only" ON public.leaderboard_events FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.leaderboard_events FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.leaderboard_daily_totals (
  day DATE PRIMARY KEY,
  total INT NOT NULL DEFAULT 0
);
GRANT ALL ON public.leaderboard_daily_totals TO service_role;
ALTER TABLE public.leaderboard_daily_totals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.leaderboard_daily_totals;
CREATE POLICY "service role only" ON public.leaderboard_daily_totals FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.leaderboard_daily_totals FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_leaderboard_event(
  p_discord_id TEXT,
  p_username TEXT,
  p_source_id UUID DEFAULT NULL,
  p_event_type TEXT DEFAULT 'secured'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id UUID;
  d DATE := (timezone('utc', now()))::DATE;
BEGIN
  IF p_discord_id IS NULL OR length(trim(p_discord_id)) = 0 THEN
    RETURN false;
  END IF;
  IF p_source_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.leaderboard_events WHERE source_id = p_source_id
  ) THEN
    RETURN false;
  END IF;
  INSERT INTO public.leaderboard_events (discord_id, username, event_type, source_id)
  VALUES (
    p_discord_id,
    COALESCE(NULLIF(trim(p_username), ''), 'Unknown'),
    COALESCE(NULLIF(p_event_type, ''), 'secured'),
    p_source_id
  )
  RETURNING id INTO new_id;
  INSERT INTO public.leaderboard_daily_totals (day, total)
  VALUES (d, 1)
  ON CONFLICT (day) DO UPDATE SET total = public.leaderboard_daily_totals.total + 1;
  RETURN new_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.record_leaderboard_event(TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_leaderboard_event(TEXT, TEXT, UUID, TEXT) TO service_role;
