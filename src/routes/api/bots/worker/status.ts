import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

function authWorker(request: Request): boolean {
  const token = request.headers.get("x-worker-secret");
  return token === process.env.WORKER_SECRET;
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const Route = createFileRoute("/api/bots/worker/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: { worker_id?: string; job_ids?: string[] };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.worker_id || !body.job_ids?.length) {
          return Response.json({ error: "worker_id and job_ids required" }, { status: 400 });
        }

        const { data: jobs } = await db()
          .from("bot_jobs")
          .select("id, status")
          .eq("worker_id", body.worker_id)
          .in("id", body.job_ids);

        return Response.json({ jobs: jobs ?? [] });
      },
    },
  },
});