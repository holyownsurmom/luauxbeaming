CREATE TABLE public.admins (
  discord_id text PRIMARY KEY,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT ALL ON public.admins TO service_role;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.admins FOR ALL TO service_role USING (true) WITH CHECK (true);