
-- Plans catalog
CREATE TABLE public.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_usd NUMERIC(10,2) NOT NULL,
  max_bots INTEGER NOT NULL,
  bot_hours INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read plans" ON public.plans FOR SELECT USING (true);

INSERT INTO public.plans (id, name, price_usd, max_bots, bot_hours, duration_days, features, sort_order) VALUES
  ('basic', 'Basic', 15.00, 1, 50, 30, '["1 concurrent bot","50 bot hours","Live console","Auto-reconnect"]'::jsonb, 1),
  ('pro',   'Pro',   35.00, 3, 200, 30, '["3 concurrent bots","200 bot hours","Discord webhooks","Priority queue","All plugins"]'::jsonb, 2),
  ('elite', 'Elite', 79.00, 10, 720, 30, '["10 concurrent bots","720 bot hours","24/7 uptime","White-glove support","All plugins + beta"]'::jsonb, 3);

-- Profiles (keyed by Discord user id, not auth.users)
CREATE TABLE public.profiles (
  discord_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  global_name TEXT,
  avatar_url TEXT,
  active_plan_id TEXT REFERENCES public.plans(id),
  plan_expires_at TIMESTAMPTZ,
  bot_hours_remaining NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- No policies: server-only access

-- Payments (NOWPayments invoices)
CREATE TABLE public.payments (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.payments(discord_id, created_at DESC);
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Minecraft accounts / SSIDs
CREATE TABLE public.mc_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL REFERENCES public.profiles(discord_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('microsoft','ssid','offline')),
  username TEXT,
  ssid TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.mc_accounts(discord_id);
GRANT ALL ON public.mc_accounts TO service_role;
ALTER TABLE public.mc_accounts ENABLE ROW LEVEL SECURITY;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER payments_touch BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
