import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

function authWorker(request: Request): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;
  const token = request.headers.get("x-worker-secret") || "";
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
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

        const client = db();

        // Atomic-ish claim: only update rows still pending, then return those we own.
        // (True SKIP LOCKED needs a Postgres RPC; this CAS pattern prevents most double-claims.)
        const { data: pendingJobs } = await client
          .from("bot_jobs")
          .select("id, discord_id, type, config, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(3);

        if (!pendingJobs?.length) return Response.json({ jobs: [] });

        const claimed: typeof pendingJobs = [];
        const startedAt = new Date().toISOString();

        for (const job of pendingJobs) {
          const { data: updated, error } = await client
            .from("bot_jobs")
            .update({
              status: "running",
              worker_id: body.worker_id,
              started_at: startedAt,
            })
            .eq("id", job.id)
            .eq("status", "pending")
            .select("id, discord_id, type, config")
            .maybeSingle();

          if (!error && updated) claimed.push(updated);
        }

        return Response.json({ jobs: claimed });
      },
    },
  },
});
