import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { sessionConfig } from "@/lib/luaux-server.server";

type SessionData = {
  user?: { id: string; username: string; global_name: string | null; avatar: string | null };
  isAdmin?: boolean;
};

export const Route = createFileRoute("/api/admin/logout")({
  server: {
    handlers: {
      POST: async () => {
        const session = await useSession<SessionData>(sessionConfig());
        await session.update({ ...session.data, isAdmin: false });
        return Response.json({ ok: true });
      },
    },
  },
});
