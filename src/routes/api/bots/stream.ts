import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { botManager } from "@/lib/bot-manager.server";

export const Route = createFileRoute("/api/bots/stream")({
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

        const encoder = new TextEncoder();
        let closed = false;

        const stream = new ReadableStream({
          start(controller) {
            const send = (data: Record<string, unknown>) => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              } catch {}
            };

            send({ type: "connected", userId: user.id });

            const unsub = botManager.subscribeGlobal((entry) => {
              const bot = botManager.get(entry.botId);
              if (bot && bot.userId === user.id) {
                send({ type: "log", ...entry });
              }
            });

            const heartbeat = setInterval(() => {
              if (closed) {
                clearInterval(heartbeat);
                unsub();
                return;
              }
              send({ type: "heartbeat", ts: Date.now() });
            }, 15000);

            const cleanup = () => {
              if (closed) return;
              closed = true;
              clearInterval(heartbeat);
              unsub();
              try { controller.close(); } catch {}
            };

            request.signal.addEventListener("abort", cleanup);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
