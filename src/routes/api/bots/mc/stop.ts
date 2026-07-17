import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized, notFound } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/mc/stop")({
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

        if (job.status !== "running" && job.status !== "pending" && job.status !== "stopping" && job.status !== "paused") {
          return Response.json({ ok: true, alreadyStopped: true });
        }

        // Pending never reaches the worker — mark stopped immediately (avoid ghost "stopping")
        if (job.status === "pending") {
          await db
            .from("bot_jobs")
            .update({ status: "stopped", error: "Stopped before start" })
            .eq("id", botId);
          return Response.json({ ok: true, stoppedPending: true });
        }

        if (job.status !== "stopping") {
          await db.from("bot_jobs").update({ status: "stopping" }).eq("id", botId);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
