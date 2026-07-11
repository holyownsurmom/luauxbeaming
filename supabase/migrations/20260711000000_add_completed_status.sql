-- Add 'completed' to bot_jobs.status CHECK constraint
ALTER TABLE public.bot_jobs
  DROP CONSTRAINT IF EXISTS bot_jobs_status_check;

ALTER TABLE public.bot_jobs
  ADD CONSTRAINT bot_jobs_status_check
  CHECK (status IN ('pending', 'running', 'stopping', 'stopped', 'completed', 'error'));
