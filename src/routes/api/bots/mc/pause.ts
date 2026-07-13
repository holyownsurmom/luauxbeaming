import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized, notFound } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/mc/pause")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        let body: { botId?: string; pause?: boolean };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const botId = body.botId;
        if (!botId) return Response.json({ error: "botId required" }, { status: 400 });

        const pause = body.pause !== false;

        const db = admin();
        const { data: job } = await db
          .from("bot_jobs")
          .select("id, discord_id, status")
          .eq("id", botId)
          .maybeSingle();

        if (!job || job.discord_id !== user.id) {
          return notFound("Bot not found");
        }

        if (pause) {
          if (job.status !== "running" && job.status !== "pending") {
            return Response.json({ ok: true, status: job.status });
          }
          await db.from("bot_jobs").update({ status: "paused" }).eq("id", botId);
          return Response.json({ ok: true, status: "paused" });
        }

        // resume only from paused (never revive a stopping job)
        if (job.status === "paused") {
          await db.from("bot_jobs").update({ status: "running" }).eq("id", botId);
          return Response.json({ ok: true, status: "running" });
        }
        return Response.json({ ok: true, status: job.status });
      },
    },
  },
});
