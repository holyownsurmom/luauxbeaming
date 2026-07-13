-- Idempotent payment grant ledger (prevents double hours / false repair)

CREATE TABLE IF NOT EXISTS public.payment_grants (
  payment_id UUID PRIMARY KEY REFERENCES public.payments(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  hours_added NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_grants_discord_idx
  ON public.payment_grants (discord_id, created_at DESC);

GRANT ALL ON public.payment_grants TO service_role;
ALTER TABLE public.payment_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.payment_grants;
CREATE POLICY "service role only" ON public.payment_grants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.payment_grants FROM anon, authenticated;

-- Mark fulfillment grant applied (optional column for fast checks)
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS granted_at TIMESTAMPTZ;
