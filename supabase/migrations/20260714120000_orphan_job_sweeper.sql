-- Reclaim jobs stuck in running/stopping/paused after worker crash / network partition.
-- Uses updated_at (touched on log heartbeats + status updates) so long-lived MC bots
-- that still write logs are not killed; only truly silent orphans are reaped.

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

-- Refund one bot hour (failed enqueue after spend)
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
