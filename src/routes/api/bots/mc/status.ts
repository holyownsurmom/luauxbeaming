import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/mc/status")({
  server: {
    handlers: {
      GET: async () => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const db = admin();
        // Only live jobs — finished ones are nuked/hidden via clear-all
        const { data: jobs } = await db
          .from("bot_jobs")
          .select("id, status, config, error, started_at, created_at")
          .eq("discord_id", user.id)
          .eq("type", "mc")
          .in("status", ["pending", "running", "stopping"])
          .order("created_at", { ascending: false });

        const bots = (jobs ?? []).map((j) => ({
          id: j.id,
          status: j.status,
          label:
            (j.config as Record<string, unknown>)?.label ||
            (j.config as Record<string, unknown>)?.serverHost ||
            "MC Bot",
          error: j.error,
          startedAt: j.started_at ? new Date(j.started_at).getTime() : null,
          config: j.config,
        }));

        return Response.json({ bots });
      },
    },
  },
});
