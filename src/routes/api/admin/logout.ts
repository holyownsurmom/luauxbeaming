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

export const Route = createFileRoute("/api/admin/logout")({
  server: {
    handlers: {
      POST: async () => {
        const session = await useSession<SessionData>(cfg());
        await session.update({ ...session.data, isAdmin: false });
        return Response.json({ ok: true });
      },
    },
  },
});
