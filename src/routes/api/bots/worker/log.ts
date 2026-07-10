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

export const Route = createFileRoute("/api/bots/worker/log")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: { job_id?: string; discord_id?: string; level?: string; message?: string }[];
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!Array.isArray(body) || body.length === 0) {
          return Response.json({ error: "Expected non-empty array" }, { status: 400 });
        }

        // Batch insert logs (up to 50 at a time)
        const rows = body.slice(0, 50).map((entry) => ({
          job_id: entry.job_id,
          discord_id: entry.discord_id,
          level: entry.level || "info",
          message: entry.message || "",
        }));

        const { error } = await db().from("bot_logs").insert(rows);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        return Response.json({ ok: true, inserted: rows.length });
      },
    },
  },
});
