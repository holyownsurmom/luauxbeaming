-- Remove "all plugins" marketing claims from plan feature lists
UPDATE public.plans
SET features = (
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(features, '[]'::jsonb)) AS elem
  WHERE elem !~* 'all plugins'
)
WHERE features IS NOT NULL
  AND features::text ~* 'all plugins';
