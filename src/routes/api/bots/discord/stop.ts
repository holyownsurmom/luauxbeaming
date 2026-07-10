import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized, notFound } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/discord/stop")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        let body: { botId?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const botId = body.botId;
        if (!botId) return Response.json({ error: "botId required" }, { status: 400 });

        const db = admin();
        const { data: job } = await db
          .from("bot_jobs")
          .select("id, discord_id, status")
          .eq("id", botId)
          .maybeSingle();

        if (!job || job.discord_id !== user.id) {
          return notFound("Bot not found");
        }

        if (job.status !== "running" && job.status !== "pending") {
          return Response.json({ error: "Bot is not running" }, { status: 400 });
        }

        await db
          .from("bot_jobs")
          .update({ status: "stopping" })
          .eq("id", botId);

        return Response.json({ ok: true });
      },
    },
  },
});
