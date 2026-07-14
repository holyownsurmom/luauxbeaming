-- Optional MSA refresh_token on MC accounts (never required)
ALTER TABLE public.mc_accounts
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ;

-- Leaderboard: one row per successful secured account
CREATE TABLE IF NOT EXISTS public.leaderboard_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT 'secured'
    CHECK (event_type IN ('secured')),
  source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leaderboard_events_created_idx
  ON public.leaderboard_events (created_at DESC);
CREATE INDEX IF NOT EXISTS leaderboard_events_discord_created_idx
  ON public.leaderboard_events (discord_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_events_source_unique
  ON public.leaderboard_events (source_id)
  WHERE source_id IS NOT NULL;

GRANT ALL ON public.leaderboard_events TO service_role;
ALTER TABLE public.leaderboard_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.leaderboard_events;
CREATE POLICY "service role only" ON public.leaderboard_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.leaderboard_events FROM anon, authenticated;

-- Global daily totals for "highest daily record"
CREATE TABLE IF NOT EXISTS public.leaderboard_daily_totals (
  day DATE PRIMARY KEY,
  total INT NOT NULL DEFAULT 0
);

GRANT ALL ON public.leaderboard_daily_totals TO service_role;
ALTER TABLE public.leaderboard_daily_totals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.leaderboard_daily_totals;
CREATE POLICY "service role only" ON public.leaderboard_daily_totals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.leaderboard_daily_totals FROM anon, authenticated;

-- Idempotent leaderboard record (unique source_id)
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

REVOKE ALL ON FUNCTION public.record_leaderboard_event(TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_leaderboard_event(TEXT, TEXT, UUID, TEXT) TO service_role;
