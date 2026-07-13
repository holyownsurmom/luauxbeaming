import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

function authWorker(request: Request): boolean {
  const token = request.headers.get("x-worker-secret");
  return token === process.env.WORKER_SECRET;
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function notifyErrorDiscord(userId: string, jobType: string, errorMsg: string) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;

  const typeLabel =
    jobType === "mc" ? "MC Auto-Message" :
    jobType === "discord" ? "Discord Auto-Spam" :
    jobType === "secure" ? "Verification Bot" :
    "Bot";

  const site = (process.env.SITE_URL || "https://luaux.wtf").replace(/\/$/, "");
  const message = `⚠️ **${typeLabel}** crashed or errored.\n\n**Error:** \`${errorMsg.slice(0, 500)}\`\n\nCheck your logs at ${site}/dashboard/logs`;

  try {
    const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: userId }),
    });
    if (!dmRes.ok) return;
    const dm = (await dmRes.json()) as { id: string };

    await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } catch {
    /* DM failed — not critical */
  }
}

export const Route = createFileRoute("/api/bots/worker/update")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: { job_id?: string; status?: string; error?: string; worker_id?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.job_id || !body.status) {
          return Response.json({ error: "job_id and status required" }, { status: 400 });
        }

        const allowed = new Set([
          "pending",
          "running",
          "paused",
          "stopping",
          "stopped",
          "error",
          "completed",
        ]);
        if (!allowed.has(body.status)) {
          return Response.json({ error: "invalid status" }, { status: 400 });
        }

        const update: Record<string, unknown> = { status: body.status };
        if (body.error) update.error = body.error;
        if (body.status === "stopped" || body.status === "error" || body.status === "completed") {
          update.stopped_at = new Date().toISOString();
        }
        // Re-queue: clear worker binding so another poll can claim
        if (body.status === "pending") {
          update.worker_id = null;
          update.started_at = null;
          update.stopped_at = null;
          update.error = body.error || null;
        }

        let query = db().from("bot_jobs").update(update).eq("id", body.job_id);
        // Prefer binding updates to the claiming worker when provided
        if (body.worker_id && body.status !== "pending") {
          query = query.eq("worker_id", body.worker_id);
        }

        const { error } = await query;

        if (error) return Response.json({ error: error.message }, { status: 500 });

        if (body.status === "error") {
          const { data: job } = await db()
            .from("bot_jobs")
            .select("discord_id, type")
            .eq("id", body.job_id)
            .maybeSingle();

          if (job?.discord_id && job?.type) {
            notifyErrorDiscord(job.discord_id, job.type, body.error || "Unknown error");
          }
        }

        return Response.json({ ok: true });
      },
    },
  },
});
