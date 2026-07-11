CREATE TABLE IF NOT EXISTS public.blacklisted_users (
  discord_id TEXT PRIMARY KEY,
  reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
