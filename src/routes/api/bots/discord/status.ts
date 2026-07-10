import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { botManager } from "@/lib/bot-manager.server";

export const Route = createFileRoute("/api/bots/discord/status")({
  server: {
    handlers: {
      GET: async () => {
        const session = await useSession<{ user?: { id: string } }>({
          password: process.env.SESSION_SECRET!,
          name: "luaux_session",
          maxAge: 60 * 60 * 24 * 30,
        });
        const user = session.data.user;
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const bots = botManager
          .getAll(user.id)
          .filter((b) => b.type === "discord")
          .map((b) => ({
            id: b.id,
            status: b.status,
            label: b.label,
            error: b.error,
            startedAt: b.startedAt,
            config: b.config,
            logCount: b.logs.length,
          }));

        return Response.json({ bots });
      },
    },
  },
});
