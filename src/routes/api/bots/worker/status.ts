import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";

const db = workerDb;

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

        if (!body.worker_id) {
          return Response.json({ error: "worker_id required" }, { status: 400 });
        }
        const jobIds = Array.isArray(body.job_ids) ? body.job_ids.filter(Boolean) : [];
        if (!jobIds.length) {
          return Response.json({ jobs: [] });
        }

        // Query by job ids only — worker may have been reassigned; secret already auth'd
        const { data: jobs } = await db()
          .from("bot_jobs")
          .select("id, status")
          .in("id", jobIds);

        return Response.json({ jobs: jobs ?? [] });
      },
    },
  },
});