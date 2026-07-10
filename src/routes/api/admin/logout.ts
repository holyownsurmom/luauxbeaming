import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { sessionConfig, type SessionData } from "@/lib/session";

export const Route = createFileRoute("/api/admin/logout")({
  server: {
    handlers: {
      POST: async () => {
        const session = await useSession<SessionData>(sessionConfig());
        await session.update({ isAdmin: false });
        return Response.json({ ok: true });
      },
    },
  },
});
