-- Bundle payments create multiple keys per payment (one per plugin).
-- Old unique on source_payment_id alone breaks discord-bundle.
DROP INDEX IF EXISTS public.verification_keys_source_payment_id_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS verification_keys_source_payment_plugin_uidx
  ON public.verification_keys (source_payment_id, plugin_id)
  WHERE source_payment_id IS NOT NULL;
