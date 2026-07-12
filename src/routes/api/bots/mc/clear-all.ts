import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/mc/clear-all")({
  server: {
    handlers: {
      POST: async () => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const db = admin();

        // Force-stop anything still active so the worker aborts sockets
        const { data: active } = await db
          .from("bot_jobs")
          .select("id, status")
          .eq("discord_id", user.id)
          .eq("type", "mc")
          .in("status", ["pending", "running", "stopping"]);

        const activeIds = (active ?? []).map((j) => j.id);

        if (activeIds.length > 0) {
          // pending → stopped immediately; running/stopping → stopping then force stopped
          await db
            .from("bot_jobs")
            .update({ status: "stopping", error: "Nuked by user" })
            .eq("discord_id", user.id)
            .eq("type", "mc")
            .in("status", ["pending", "running", "stopping"]);

          // Immediately mark stopped so they leave the Active list
          await db
            .from("bot_jobs")
            .update({ status: "stopped", error: "Nuked by user" })
            .eq("discord_id", user.id)
            .eq("type", "mc")
            .in("id", activeIds);
        }

        // Hide finished/error/stopped from Active Bots forever by moving to completed
        await db
          .from("bot_jobs")
          .update({ status: "completed" })
          .eq("discord_id", user.id)
          .eq("type", "mc")
          .in("status", ["stopped", "error", "stopping"]);

        // Clear all bot logs for this user (MC jobs)
        const { data: allJobs } = await db
          .from("bot_jobs")
          .select("id")
          .eq("discord_id", user.id)
          .eq("type", "mc");

        const jobIds = (allJobs ?? []).map((j) => j.id);
        if (jobIds.length > 0) {
          // Supabase .in has practical limits — chunk
          for (let i = 0; i < jobIds.length; i += 100) {
            const chunk = jobIds.slice(i, i + 100);
            await db.from("bot_logs").delete().in("job_id", chunk);
          }
        }

        return Response.json({
          ok: true,
          stopped: activeIds.length,
          cleared: true,
        });
      },
    },
  },
});
