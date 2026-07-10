import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { botManager, type LogEntry } from "@/lib/bot-manager.server";

export const Route = createFileRoute("/api/bots/logs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await useSession<{ user?: { id: string } }>({
          password: process.env.SESSION_SECRET!,
          name: "luaux_session",
          maxAge: 60 * 60 * 24 * 30,
        });
        const user = session.data.user;
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const botId = url.searchParams.get("botId");
        const since = url.searchParams.get("since");
        const sinceTs = since ? parseInt(since, 10) : undefined;

        if (botId) {
          const bot = botManager.get(botId);
          if (!bot || bot.userId !== user.id) {
            return Response.json({ error: "Bot not found" }, { status: 404 });
          }
          const logs = botManager.getLogs(botId, sinceTs);
          return Response.json({ logs });
        }

        const allBots = botManager.getAll(user.id);
        const allLogs: LogEntry[] = [];
        for (const bot of allBots) {
          allLogs.push(...botManager.getLogs(bot.id, sinceTs));
        }
        allLogs.sort((a, b) => a.ts - b.ts);
        return Response.json({ logs: allLogs.slice(-200) });
      },
    },
  },
});
