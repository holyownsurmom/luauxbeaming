import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized, forbidden } from "@/lib/api-helpers";
import { isAdminSession } from "@/lib/luaux-server.server";

export const Route = createFileRoute("/api/admin/blacklist")({
  server: {
    handlers: {
      GET: async () => {
        const user = await getSessionUser();
        if (!user) return unauthorized();
        const isAdm = await isAdminSession();
        if (!isAdm) return forbidden("Admin only");

        const db = admin();
        const { data, error } = await db
          .from("blacklisted_users")
          .select("discord_id, reason, created_at")
          .order("created_at", { ascending: false });

        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ users: data ?? [] });
      },

      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();
        const isAdm = await isAdminSession();
        if (!isAdm) return forbidden("Admin only");

        let body: { discord_id?: string; reason?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const discordId = body.discord_id?.trim();
        if (!discordId) {
          return Response.json({ error: "discord_id required" }, { status: 400 });
        }

        const db = admin();
        const { error } = await db.from("blacklisted_users").upsert(
          {
            discord_id: discordId,
            reason: body.reason?.trim() || "",
          },
          { onConflict: "discord_id" },
        );

        if (error) return Response.json({ error: error.message }, { status: 500 });

        // Auto-collect all known IPs for this user and blacklist them
        const { data: knownIps } = await db
          .from("user_login_ips")
          .select("ip")
          .eq("discord_id", discordId);

        if (knownIps && knownIps.length > 0) {
          const ipEntries = knownIps.map((row) => ({
            ip: row.ip,
            source_discord_id: discordId,
            reason: body.reason?.trim() || "",
          }));
          await db.from("blacklisted_ips").upsert(ipEntries, {
            onConflict: "ip,source_discord_id",
            ignoreDuplicates: true,
          });
        }

        return Response.json({ ok: true, ips_collected: knownIps?.length ?? 0 });
      },

      DELETE: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();
        const isAdm = await isAdminSession();
        if (!isAdm) return forbidden("Admin only");

        let body: { discord_id?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const discordId = body.discord_id?.trim();
        if (!discordId) {
          return Response.json({ error: "discord_id required" }, { status: 400 });
        }

        const db = admin();
        const { error } = await db.from("blacklisted_users").delete().eq("discord_id", discordId);

        // Also remove their IPs from the blacklisted_ips table
        await db.from("blacklisted_ips").delete().eq("source_discord_id", discordId);

        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
