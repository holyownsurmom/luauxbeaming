-- Lower MC plan prices + $1/hr bot hours; Pro/Enterprise include Discord plugins in features text.
UPDATE public.plans
SET
  price_usd = 7.00,
  features = '["1 concurrent bot","5 bot-hours / day","Basic telemetry & logs","Standard speed","Community Discord"]'::jsonb
WHERE id = 'starter';

UPDATE public.plans
SET
  price_usd = 16.00,
  features = '["5 concurrent bots","7 bot-hours / day","Discord Auto-Spam included","Discord Auto-Reply included","Full analytics & live console","Priority Discord support"]'::jsonb
WHERE id = 'pro';

UPDATE public.plans
SET
  price_usd = 35.00,
  features = '["20 concurrent bots","14 bot-hours / day","Discord Auto-Spam included","Discord Auto-Reply included","Custom behaviors & API access","Dedicated 1:1 support"]'::jsonb
WHERE id = 'enterprise';

UPDATE public.plans SET price_usd = 1.00 WHERE id = 'hours_1';
UPDATE public.plans SET price_usd = 2.00 WHERE id = 'hours_2';
UPDATE public.plans SET price_usd = 5.00 WHERE id = 'hours_5';
UPDATE public.plans SET price_usd = 10.00 WHERE id = 'hours_10';
UPDATE public.plans SET price_usd = 24.00 WHERE id = 'hours_24';
