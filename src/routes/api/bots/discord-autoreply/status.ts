import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/discord-autoreply/status")({
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
          .eq("config->>subType", "autoreply")
          .in("status", ["pending", "running", "stopping", "paused"])
          .order("created_at", { ascending: false });

        const bots = (jobs ?? []).map((j) => {
          const cfg = j.config as Record<string, unknown> | null;
          const token = cfg?.token as string | undefined;
          return {
            id: j.id,
            status: j.status,
            label: `AutoReply-${token?.substring(0, 8) || "???"}`,
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
