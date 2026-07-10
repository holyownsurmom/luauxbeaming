import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/logs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const url = new URL(request.url);
        const botId = url.searchParams.get("botId");
        const since = url.searchParams.get("since");
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 500);

        const db = admin();
        let query = db
          .from("bot_logs")
          .select("job_id, level, message, created_at")
          .eq("discord_id", user.id)
          .order("created_at", { ascending: true })
          .limit(limit);

        if (botId) {
          query = query.eq("job_id", botId);
        }

        if (since) {
          const sinceDate = new Date(parseInt(since, 10)).toISOString();
          query = query.gt("created_at", sinceDate);
        }

        const { data: rows } = await query;

        const logs = (rows ?? []).map((r) => ({
          ts: new Date(r.created_at).getTime(),
          level: r.level,
          msg: r.message,
          botId: r.job_id,
        }));

        return Response.json({ logs });
      },
    },
  },
});
