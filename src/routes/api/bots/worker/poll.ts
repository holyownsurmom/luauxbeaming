import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";

const db = workerDb;
/** Module-scoped so reclaim is not run on every worker poll tick */
let lastReclaimAt = 0;

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

        // Reclaim at most once every 10 minutes (was every poll ~3s — heavy on Supabase)
        const now = Date.now();
        const RECLAIM_EVERY_MS = 10 * 60_000;
        if (now - lastReclaimAt >= RECLAIM_EVERY_MS) {
          lastReclaimAt = now;
          try {
            const { data: reclaimed, error: reclaimErr } = await client.rpc(
              "reclaim_stale_bot_jobs",
              { p_stale_minutes: 45 },
            );
            if (reclaimErr) {
              // Fallback without RPC: mark silent running/stopping jobs as error
              const cutoff = new Date(Date.now() - 45 * 60 * 1000).toISOString();
              const { error: fbErr } = await client
                .from("bot_jobs")
                .update({
                  status: "error",
                  error: "Worker lost contact — job reclaimed as stale (fallback)",
                  stopped_at: new Date().toISOString(),
                  worker_id: null,
                })
                .in("status", ["running", "stopping", "paused"])
                .lt("updated_at", cutoff);
              if (fbErr) {
                console.warn("[poll] orphan reclaim fallback failed:", fbErr.message);
              }
            } else if (typeof reclaimed === "number" && reclaimed > 0) {
              console.warn(`[poll] reclaimed ${reclaimed} stale bot job(s)`);
            }
          } catch (e) {
            console.warn("[poll] orphan reclaim error:", e);
          }
        }

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
        const { data: pendingJobs, error: listErr } = await client
          .from("bot_jobs")
          .select("id, discord_id, type, config, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(limit);

        if (listErr) {
          console.error("[poll] pending list failed:", listErr.message);
          return Response.json({ jobs: [], error: listErr.message });
        }

        if (!pendingJobs?.length) return Response.json({ jobs: [] });

        const claimed: Array<{
          id: string;
          discord_id: string;
          type: string;
          config: unknown;
        }> = [];
        const startedAt = new Date().toISOString();

        for (const job of pendingJobs) {
          try {
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
          } catch {
            /* skip */
          }
        }

        return Response.json({ jobs: claimed });
      },
    },
  },
});
