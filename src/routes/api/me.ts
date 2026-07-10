import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { sessionConfig, type SessionData } from "@/lib/session";

export const Route = createFileRoute("/api/me")({
  server: {
    handlers: {
      GET: async () => {
        const session = await useSession<SessionData>(sessionConfig());
        return Response.json({ user: session.data.user ?? null, isAdmin: session.data.isAdmin === true });
      },
    },
  },
});