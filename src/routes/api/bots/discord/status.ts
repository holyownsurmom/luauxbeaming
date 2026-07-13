import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized } from "@/lib/api-helpers";
import { redactJobConfig } from "@/lib/luaux-server.server";

export const Route = createFileRoute("/api/bots/discord/status")({
  server: {
    handlers: {
      GET: async () => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const db = admin();
        // Fetch all live discord jobs then exclude autoreply client-side.
        // PostgREST `not eq` drops NULL subType rows (spam jobs have no subType).
        const { data: jobs } = await db
          .from("bot_jobs")
          .select("id, status, config, error, started_at, created_at")
          .eq("discord_id", user.id)
          .eq("type", "discord")
          .in("status", ["pending", "running", "stopping", "paused"])
          .order("created_at", { ascending: false });

        const bots = (jobs ?? [])
          .filter((j) => {
            const cfg = (j.config || {}) as { subType?: string };
            return cfg.subType !== "autoreply";
          })
          .map((j) => {
            const cfg = redactJobConfig(j.config);
            const ch = String(cfg.channelId || "???");
            return {
              id: j.id,
              status: j.status,
              label: `Spam-${ch.slice(-6)}`,
              error: j.error,
              startedAt: j.started_at ? new Date(j.started_at).getTime() : null,
              config: cfg,
            };
          });

        return Response.json({ bots });
      },
    },
  },
});
