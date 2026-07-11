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

export const Route = createFileRoute("/api/bots/worker/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: { worker_id?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.worker_id) return Response.json({ error: "worker_id required" }, { status: 400 });

        // First, handle any "stopping" jobs that belong to this worker
        const { data: stoppingJobs } = await db()
          .from("bot_jobs")
          .select("id")
          .eq("status", "stopping")
          .eq("worker_id", body.worker_id);

        if (stoppingJobs?.length) {
          await db()
            .from("bot_jobs")
            .update({ status: "stopped", stopped_at: new Date().toISOString() })
            .in(
              "id",
              stoppingJobs.map((j) => j.id),
            );
        }

        // Claim pending jobs (up to 3 at a time)
        const { data: pendingJobs } = await db()
          .from("bot_jobs")
          .select("id, discord_id, type, config")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(3);

        if (!pendingJobs?.length) return Response.json({ jobs: [] });

        // Mark them as running
        const ids = pendingJobs.map((j) => j.id);
        await db()
          .from("bot_jobs")
          .update({
            status: "running",
            worker_id: body.worker_id,
            started_at: new Date().toISOString(),
          })
          .in("id", ids);

        return Response.json({ jobs: pendingJobs });
      },
    },
  },
});
