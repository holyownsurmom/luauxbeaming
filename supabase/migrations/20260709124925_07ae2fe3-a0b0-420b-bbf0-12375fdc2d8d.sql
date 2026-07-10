
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'plan';

INSERT INTO public.plans (id, name, price_usd, duration_days, bot_hours, max_bots, sort_order, features, kind)
VALUES ('verification', 'Verification Bot', 10, 30, 0, 0, 100,
  '["Auto-generated monthly license key","Delivered via Discord DM","Renew anytime"]'::jsonb, 'plugin')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  price_usd = EXCLUDED.price_usd,
  duration_days = EXCLUDED.duration_days,
  features = EXCLUDED.features,
  kind = EXCLUDED.kind;

CREATE TABLE IF NOT EXISTS public.verification_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id text NOT NULL,
  key text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered boolean NOT NULL DEFAULT false,
  source_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS verification_keys_discord_idx ON public.verification_keys(discord_id, expires_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.verification_keys TO authenticated;
GRANT ALL ON public.verification_keys TO service_role;

ALTER TABLE public.verification_keys ENABLE ROW LEVEL SECURITY;

-- Access is only ever through server functions using the service role; no direct client access needed.
CREATE POLICY "service role only" ON public.verification_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);
