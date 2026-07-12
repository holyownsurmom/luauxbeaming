import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import {
  sessionConfig,
  timingSafeEqualStrings,
  admin as adminDb,
} from "@/lib/luaux-server.server";

type SessionData = {
  user?: { id: string; username: string; global_name: string | null; avatar: string | null };
  isAdmin?: boolean;
};

export const Route = createFileRoute("/api/admin/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await useSession<SessionData>(sessionConfig());
        if (!session.data.user) {
          return Response.json({ error: "Not logged in" }, { status: 401 });
        }

        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const password = process.env.ADMIN_PASSWORD || "";
        if (!password || password.length < 8) {
          return Response.json(
            { error: "Admin login is not configured" },
            { status: 503 },
          );
        }
        if (!body.password || !timingSafeEqualStrings(String(body.password), password)) {
          return Response.json({ error: "Wrong password" }, { status: 403 });
        }

        const db = adminDb();
        const discordId = session.data.user.id;

        // Correct password → register this Discord account as admin (upsert).
        // Session isAdmin alone is not enough; isAdminSession() always re-checks admins table.
        // OAuth login clears isAdmin so alts never inherit admin without the password.
        const { error: upsertErr } = await db.from("admins").upsert(
          { discord_id: discordId },
          { onConflict: "discord_id" },
        );
        if (upsertErr) {
          return Response.json(
            { error: `Failed to register admin: ${upsertErr.message}` },
            { status: 500 },
          );
        }

        await session.update({ ...session.data, isAdmin: true });
        return Response.json({ ok: true });
      },
    },
  },
});
