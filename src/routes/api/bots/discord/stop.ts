import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { botManager } from "@/lib/bot-manager.server";

export const Route = createFileRoute("/api/bots/discord/stop")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await useSession<{ user?: { id: string } }>({
          password: process.env.SESSION_SECRET!,
          name: "luaux_session",
          maxAge: 60 * 60 * 24 * 30,
        });
        const user = session.data.user;
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: { botId?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const botId = body.botId;
        if (!botId) return Response.json({ error: "botId required" }, { status: 400 });

        const bot = botManager.get(botId);
        if (!bot || bot.userId !== user.id) {
          return Response.json({ error: "Bot not found" }, { status: 404 });
        }

        await botManager.stop(botId);
        return Response.json({ ok: true });
      },
    },
  },
});
