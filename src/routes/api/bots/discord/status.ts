import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/discord/status")({
  server: {
    handlers: {
      GET: async () => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const db = admin();
        const { data: jobs } = await db
          .from("bot_jobs")
          .select("id, status, config, error, started_at, created_at")
          .eq("discord_id", user.id)
          .eq("type", "discord")
          .in("status", ["pending", "running", "stopping", "stopped", "error"])
          .order("created_at", { ascending: false });

        const bots = (jobs ?? []).map((j) => ({
          id: j.id,
          status: j.status,
          label: `Spam-${(j.config as Record<string, unknown>)?.channelId || "???"}`,
          error: j.error,
          startedAt: j.started_at ? new Date(j.started_at).getTime() : null,
          config: j.config,
        }));

        return Response.json({ bots });
      },
    },
  },
});
