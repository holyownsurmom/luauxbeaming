import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";

const cfg = () => ({
  password: process.env.SESSION_SECRET!,
  name: "luaux_session",
  maxAge: 60 * 60 * 24 * 30,
});

export const Route = createFileRoute("/api/discord/logout")({
  server: {
    handlers: {
      POST: async () => {
        const session = await useSession(cfg());
        await session.clear();
        return Response.json({ ok: true });
      },
    },
  },
});
