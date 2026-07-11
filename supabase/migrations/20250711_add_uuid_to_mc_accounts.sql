-- Add uuid column to mc_accounts table
ALTER TABLE mc_accounts ADD COLUMN IF NOT EXISTS uuid UUID;