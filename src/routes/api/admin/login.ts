import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { sessionConfig, timingSafeEqualStrings } from "@/lib/luaux-server.server";

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
        if (!body.password || !timingSafeEqualStrings(String(body.password), password)) {
          return Response.json({ error: "Wrong password" }, { status: 403 });
        }

        await session.update({ ...session.data, isAdmin: true });
        return Response.json({ ok: true });
      },
    },
  },
});
