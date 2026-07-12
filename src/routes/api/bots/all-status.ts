import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/all-status")({
  server: {
    handlers: {
      GET: async () => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const db = admin();
        const { data: jobs } = await db
          .from("bot_jobs")
          .select("id, type, status, config, error, started_at, created_at")
          .eq("discord_id", user.id)
          .in("status", ["pending", "running", "stopping", "stopped", "error"])
          .order("created_at", { ascending: false });

        const bots = (jobs ?? []).map((j) => {
          const cfg = (j.config || {}) as Record<string, unknown>;
          let label = "Bot";
          if (j.type === "mc") {
            label = (cfg.label as string) || "MC Bot";
          } else if (j.type === "discord") {
            const subType = cfg.subType as string | undefined;
            if (subType === "autoreply") {
              label = `Auto-Reply`;
            } else {
              label = `Spam-${(cfg.channelId as string) || "???"}`;
            }
          } else if (j.type === "secure") {
            label = `Secure-${(cfg.mcUsername as string) || "???"}`;
          }
          return {
            id: j.id,
            type: j.type,
            status: j.status,
            label,
            error: j.error,
            startedAt: j.started_at ? new Date(j.started_at).getTime() : null,
            config: j.config,
          };
        });

        return Response.json({ bots });
      },
    },
  },
});
