import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized } from "@/lib/api-helpers";
import { redactJobConfig } from "@/lib/luaux-server.server";

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
          .in("status", ["pending", "running", "stopping", "paused"])
          .order("created_at", { ascending: false });

        let arIdx = 0;
        let spamIdx = 0;
        const bots = (jobs ?? []).map((j) => {
          const cfg = redactJobConfig(j.config);
          let label = "Bot";
          if (j.type === "mc") {
            label = (cfg.label as string) || (cfg.serverHost as string) || "MC Bot";
          } else if (j.type === "discord") {
            const subType = cfg.subType as string | undefined;
            if (subType === "autoreply") {
              arIdx += 1;
              label = `Auto-Reply #${arIdx}`;
            } else {
              spamIdx += 1;
              const ch = String(cfg.channelId || "").slice(-4);
              label = `Spam #${spamIdx}${ch ? ` ·${ch}` : ""}`;
            }
          } else if (j.type === "secure") {
            label = `Secure-${(cfg.mcUsername as string) || "acct"}`;
          }
          return {
            id: j.id,
            type: j.type,
            status: j.status,
            label,
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
