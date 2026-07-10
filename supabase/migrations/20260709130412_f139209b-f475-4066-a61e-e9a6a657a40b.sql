
-- Add plugin_id column to track which plugin a key belongs to
ALTER TABLE public.verification_keys
  ADD COLUMN IF NOT EXISTS plugin_id TEXT NOT NULL DEFAULT 'verification';

-- Add two new plugin plans: Discord Spam and Discord Auto-Reply
-- Both $10 lifetime one-time purchases (duration = 100 years)
INSERT INTO public.plans (id, name, price_usd, max_bots, bot_hours, duration_days, features, sort_order, kind)
VALUES
  ('discord-spam', 'Discord Spam', 10.00, 0, 0, 36500,
   '["Unlimited tokens with rotation","Custom message pool & interval","Auto-delete sent messages","Replace mode & failure limit","Bring your own proxy, or use our premium pool (Enterprise)","Live console"]'::jsonb,
   20, 'plugin'),
  ('discord-autoreply', 'Discord Auto-Reply', 10.00, 0, 0, 36500,
   '["DM mode & Friend mode","Humanized reply delay & typing","Multi-token rotation","Auto-accept friend requests (safe)","Bring your own proxy, or use our premium pool (Enterprise)","Live console"]'::jsonb,
   21, 'plugin')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  price_usd = EXCLUDED.price_usd,
  features = EXCLUDED.features,
  duration_days = EXCLUDED.duration_days,
  kind = EXCLUDED.kind,
  sort_order = EXCLUDED.sort_order;
