-- Plugin pricing:
-- verification: $10 / 30 days only (no public lifetime)
-- discord-spam / discord-autoreply: $20 lifetime only
-- discord-bundle: $30 lifetime (spam + auto-reply)
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
    '["Unlimited tokens with rotation","Custom message pool & interval","Auto-delete sent messages","Replace mode & failure limit","Bring your own proxy, or use our premium pool (Enterprise)","Live console","Lifetime access"]'::jsonb,
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
    '["DM mode & Friend mode","Humanized reply delay & typing","Multi-token rotation","Auto-accept friend requests (safe)","Bring your own proxy, or use our premium pool (Enterprise)","Live console","Lifetime access"]'::jsonb,
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

-- Remove public lifetime / monthly variants we no longer sell
DELETE FROM public.plans
WHERE id IN (
  'verification-lifetime',
  'discord-spam-lifetime',
  'discord-autoreply-lifetime'
);
