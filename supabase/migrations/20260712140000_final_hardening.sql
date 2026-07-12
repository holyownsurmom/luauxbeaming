-- Final production hardening

-- 1) Payments fulfillment flag (IPN idempotency)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS payments_fulfilled_at_idx
  ON public.payments (fulfilled_at)
  WHERE fulfilled_at IS NULL;

-- 2) Unique license key per payment (plugin path)
CREATE UNIQUE INDEX IF NOT EXISTS verification_keys_source_payment_id_uidx
  ON public.verification_keys (source_payment_id)
  WHERE source_payment_id IS NOT NULL;

-- 3) Atomic job claim via SKIP LOCKED
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

GRANT EXECUTE ON FUNCTION public.claim_bot_jobs(TEXT, INT) TO service_role;

-- 4) Ensure paused status allowed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_jobs_status_check') THEN
    ALTER TABLE public.bot_jobs DROP CONSTRAINT bot_jobs_status_check;
  END IF;
END $$;

ALTER TABLE public.bot_jobs
  ADD CONSTRAINT bot_jobs_status_check
  CHECK (status IN (
    'pending', 'running', 'stopping', 'stopped', 'error', 'completed', 'paused'
  ));

-- 5) Secure job type
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_jobs_type_check') THEN
    ALTER TABLE public.bot_jobs DROP CONSTRAINT bot_jobs_type_check;
  END IF;
END $$;

ALTER TABLE public.bot_jobs
  ADD CONSTRAINT bot_jobs_type_check
  CHECK (type IN ('mc', 'discord', 'secure'));
