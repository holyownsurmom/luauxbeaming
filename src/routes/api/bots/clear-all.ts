import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized } from "@/lib/api-helpers";

/**
 * Nuke bots + hide finished jobs + wipe logs.
 * body: { type?: "all" | "mc" | "discord" | "discord-autoreply" }
 */
export const Route = createFileRoute("/api/bots/clear-all")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        let body: { type?: string } = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }

        const kind = (body.type || "all").toLowerCase();
        const db = admin();

        let query = db
          .from("bot_jobs")
          .select("id, type, status, config")
          .eq("discord_id", user.id);

        if (kind === "mc") {
          query = query.eq("type", "mc");
        } else if (kind === "discord" || kind === "discord-autoreply") {
          query = query.eq("type", "discord");
        }

        const { data: jobs, error } = await query;
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const filtered = (jobs || []).filter((j) => {
          if (kind === "discord") {
            const sub = (j.config as { subType?: string } | null)?.subType;
            return sub !== "autoreply";
          }
          if (kind === "discord-autoreply") {
            const sub = (j.config as { subType?: string } | null)?.subType;
            return sub === "autoreply";
          }
          return true;
        });

        const ids = filtered.map((j) => j.id);
        if (ids.length === 0) {
          return Response.json({ ok: true, stopped: 0, cleared: 0 });
        }

        const liveStatuses = new Set(["pending", "running", "stopping", "paused"]);
        const activeIds = filtered.filter((j) => liveStatuses.has(j.status)).map((j) => j.id);

        // 1) Signal workers to abort live jobs
        for (let i = 0; i < activeIds.length; i += 80) {
          const chunk = activeIds.slice(i, i + 80);
          await db
            .from("bot_jobs")
            .update({ status: "stopping", error: "Nuked by user" })
            .eq("discord_id", user.id)
            .in("id", chunk);
        }

        // 2) Mark ALL matched jobs completed so they leave Active lists
        for (let i = 0; i < ids.length; i += 80) {
          const chunk = ids.slice(i, i + 80);
          await db
            .from("bot_jobs")
            .update({ status: "completed", error: "Nuked by user" })
            .eq("discord_id", user.id)
            .in("id", chunk);
        }

        // 3) Wipe logs
        for (let i = 0; i < ids.length; i += 80) {
          const chunk = ids.slice(i, i + 80);
          await db.from("bot_logs").delete().in("job_id", chunk);
        }

        return Response.json({
          ok: true,
          stopped: activeIds.length,
          cleared: ids.length,
        });
      },
    },
  },
});
