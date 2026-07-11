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

export const Route = createFileRoute("/api/bots/worker/update")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: { job_id?: string; status?: string; error?: string; worker_id?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.job_id || !body.status) {
          return Response.json({ error: "job_id and status required" }, { status: 400 });
        }

        const update: Record<string, unknown> = { status: body.status };
        if (body.error) update.error = body.error;
        if (body.status === "stopped" || body.status === "error" || body.status === "completed") {
          update.stopped_at = new Date().toISOString();
        }

        const query = db().from("bot_jobs").update(update).eq("id", body.job_id);
        if (body.worker_id) query.eq("worker_id", body.worker_id);

        const { error } = await query;

        if (error) return Response.json({ error: error.message }, { status: 500 });

        return Response.json({ ok: true });
      },
    },
  },
});
