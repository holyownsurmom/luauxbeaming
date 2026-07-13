import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";

const db = workerDb;

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

        // Batch insert logs (up to 50). Validate required fields so bad rows
        // don't kill the whole flush and leave the console empty.
        const rows = body
          .slice(0, 50)
          .filter((entry) => entry?.job_id && entry?.discord_id && entry?.message != null)
          .map((entry) => ({
            job_id: String(entry.job_id),
            discord_id: String(entry.discord_id),
            level: entry.level || "info",
            message: String(entry.message || "").slice(0, 4000),
          }));

        if (rows.length === 0) {
          return Response.json({ error: "No valid log rows" }, { status: 400 });
        }

        const { error } = await db().from("bot_logs").insert(rows);
        if (error) {
          console.error("[worker/log] insert failed:", error.message);
          return Response.json({ error: error.message }, { status: 500 });
        }

        return Response.json({ ok: true, inserted: rows.length });
      },
    },
  },
});
