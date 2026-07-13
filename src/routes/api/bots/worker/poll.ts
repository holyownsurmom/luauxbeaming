import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";

const db = workerDb;

export const Route = createFileRoute("/api/bots/worker/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: { worker_id?: string; limit?: number };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.worker_id) return Response.json({ error: "worker_id required" }, { status: 400 });

        const client = db();
        const limit = Math.min(Math.max(body.limit || 3, 1), 10);

        // Prefer atomic SKIP LOCKED RPC
        const { data: rpcJobs, error: rpcErr } = await client.rpc("claim_bot_jobs", {
          p_worker_id: body.worker_id,
          p_limit: limit,
        });

        if (!rpcErr && Array.isArray(rpcJobs)) {
          const jobs = rpcJobs.map((j: Record<string, unknown>) => ({
            id: j.id,
            discord_id: j.discord_id,
            type: j.type,
            config: j.config,
          }));
          return Response.json({ jobs });
        }

        if (rpcErr) {
          console.warn("[poll] claim_bot_jobs RPC unavailable, CAS fallback:", rpcErr.message);
        }

        // Fallback CAS
        const { data: pendingJobs } = await client
          .from("bot_jobs")
          .select("id, discord_id, type, config, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(limit);

        if (!pendingJobs?.length) return Response.json({ jobs: [] });

        const claimed: Array<{
          id: string;
          discord_id: string;
          type: string;
          config: unknown;
        }> = [];
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
