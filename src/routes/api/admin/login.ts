import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";

const cfg = () => ({
  password: process.env.SESSION_SECRET!,
  name: "luaux_session",
  maxAge: 60 * 60 * 24 * 30,
});

type SessionData = {
  user?: { id: string; username: string; global_name: string | null; avatar: string | null };
  isAdmin?: boolean;
};

export const Route = createFileRoute("/api/admin/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await useSession<SessionData>(cfg());
        if (!session.data.user) {
          return Response.json({ error: "Not logged in" }, { status: 401 });
        }

        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (body.password !== process.env.ADMIN_PASSWORD) {
          return Response.json({ error: "Wrong password" }, { status: 403 });
        }

        await session.update({ isAdmin: true });
        return Response.json({ ok: true });
      },
    },
  },
});
