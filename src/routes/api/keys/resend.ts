import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/keys/resend")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        let body: { key_id?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.key_id) {
          return Response.json({ error: "key_id required" }, { status: 400 });
        }

        const db = admin();

        // Fetch the key — must belong to the user
        const { data: keyRow } = await db
          .from("verification_keys")
          .select("id, key, expires_at, discord_id, plugin_id, delivered")
          .eq("id", body.key_id)
          .eq("discord_id", user.id)
          .maybeSingle();

        if (!keyRow) {
          return Response.json({ error: "Key not found" }, { status: 404 });
        }

        // Map plugin_id to label
        const LABELS: Record<string, string> = {
          verification: "Verification Bot",
          "discord-spam": "Discord Spam",
          "discord-autoreply": "Discord Auto-Reply",
        };
        const label = LABELS[keyRow.plugin_id] ?? keyRow.plugin_id;

        try {
          const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
            method: "POST",
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ recipient_id: user.id }),
          });

          if (!dmRes.ok) {
            const errText = await dmRes.text();
            return Response.json(
              { error: "Could not open DM. Please open a DM with the LuauX bot first.", detail: errText },
              { status: 400 },
            );
          }

          const dm = (await dmRes.json()) as { id: string };
          const isLifetime = new Date(keyRow.expires_at).getTime() - Date.now() > 365 * 24 * 60 * 60 * 1000;

          await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content:
                `🔑 **LuauX ${label} — License Key**\n\n` +
                `Your ${isLifetime ? "lifetime" : "monthly"} license key:\n\`\`\`${keyRow.key}\`\`\`\n` +
                (isLifetime
                  ? `This key never expires.\n\n`
                  : `Expires: <t:${Math.floor(new Date(keyRow.expires_at).getTime() / 1000)}:F>\n\n`) +
                `Keep this key private.`,
            }),
          });

          // Mark as delivered
          await db
            .from("verification_keys")
            .update({ delivered: true })
            .eq("id", keyRow.id);

          return Response.json({ ok: true });
        } catch (e) {
          console.warn("[keys/resend] DM failed", e);
          return Response.json({ error: "Failed to send DM" }, { status: 500 });
        }
      },
    },
  },
});
