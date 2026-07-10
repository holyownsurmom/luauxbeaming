-- Bot jobs table: Lovable UI writes here, bot-worker picks up
CREATE TABLE public.bot_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL REFERENCES public.profiles(discord_id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('mc', 'discord')),
  config JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'stopping', 'stopped', 'error')),
  worker_id TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_jobs_status_idx ON public.bot_jobs(status) WHERE status IN ('pending', 'stopping');
CREATE INDEX IF NOT EXISTS bot_jobs_discord_idx ON public.bot_jobs(discord_id, created_at DESC);
CREATE TRIGGER bot_jobs_touch BEFORE UPDATE ON public.bot_jobs FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
GRANT ALL ON public.bot_jobs TO service_role;
ALTER TABLE public.bot_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.bot_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Bot logs table: bot-worker writes here, Lovable UI reads
CREATE TABLE public.bot_logs (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.bot_jobs(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'chat', 'bot', 'system')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_logs_job_idx ON public.bot_logs(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bot_logs_user_idx ON public.bot_logs(discord_id, created_at DESC);
GRANT ALL ON public.bot_logs TO service_role;
ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.bot_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
