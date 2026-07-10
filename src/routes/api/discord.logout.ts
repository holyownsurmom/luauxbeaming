import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { sessionConfig } from "@/lib/session";

export const Route = createFileRoute("/api/discord/logout")({
  server: {
    handlers: {
      POST: async () => {
        const session = await useSession(sessionConfig());
        await session.clear();
        return Response.json({ ok: true });
      },
    },
  },
});