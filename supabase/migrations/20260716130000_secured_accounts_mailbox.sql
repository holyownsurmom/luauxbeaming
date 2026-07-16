-- Store recovery mailbox credentials on secured_accounts for dashboard Secured Accounts tab
ALTER TABLE public.secured_accounts
  ADD COLUMN IF NOT EXISTS mailbox_email TEXT,
  ADD COLUMN IF NOT EXISTS mailbox_password TEXT,
  ADD COLUMN IF NOT EXISTS mailbox_provider TEXT,
  ADD COLUMN IF NOT EXISTS mailbox_imap_host TEXT;

-- Backfill: new_email is the recovery mailbox for most successful secures
UPDATE public.secured_accounts
SET mailbox_email = new_email
WHERE (mailbox_email IS NULL OR mailbox_email = '')
  AND new_email IS NOT NULL
  AND new_email <> ''
  AND new_email NOT ILIKE '%Couldn%t Change%';
