-- Add UUID column to mc_accounts for premium SSID auth on online-mode servers
ALTER TABLE public.mc_accounts ADD COLUMN IF NOT EXISTS uuid TEXT;
