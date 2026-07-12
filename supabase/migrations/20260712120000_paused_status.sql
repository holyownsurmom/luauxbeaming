-- Allow paused status for MC bots (pause messages while staying online)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_jobs_status_check'
  ) THEN
    ALTER TABLE public.bot_jobs DROP CONSTRAINT bot_jobs_status_check;
  END IF;
END $$;

ALTER TABLE public.bot_jobs
  ADD CONSTRAINT bot_jobs_status_check
  CHECK (status IN (
    'pending',
    'running',
    'stopping',
    'stopped',
    'error',
    'completed',
    'paused'
  ));
