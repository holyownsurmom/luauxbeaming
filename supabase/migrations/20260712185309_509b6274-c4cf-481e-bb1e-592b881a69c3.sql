REVOKE EXECUTE ON FUNCTION public.claim_bot_jobs(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_bot_jobs(text, integer) TO service_role;