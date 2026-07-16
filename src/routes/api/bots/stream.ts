import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, unauthorized } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const encoder = new TextEncoder();
        let closed = false;
        let lastTs = Date.now();

        const stream = new ReadableStream({
          start(controller) {
            const send = (data: Record<string, unknown>) => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              } catch {
                /* ignore send errors */
              }
            };

            send({ type: "connected", userId: user.id });

            const poll = async () => {
              if (closed) return;
              try {
                const db = admin();
                const sinceDate = new Date(lastTs).toISOString();
                const { data: rows } = await db
                  .from("bot_logs")
                  .select("job_id, level, message, created_at")
                  .eq("discord_id", user.id)
                  .gt("created_at", sinceDate)
                  .order("created_at", { ascending: true })
                  .limit(100);

                if (rows?.length) {
                  for (const r of rows) {
                    send({
                      type: "log",
                      ts: new Date(r.created_at).getTime(),
                      level: r.level,
                      msg: r.message,
                      botId: r.job_id,
                    });
                  }
                  lastTs = new Date(rows[rows.length - 1].created_at).getTime();
                }
              } catch {
                /* ignore polling errors */
              }
            };

            const heartbeat = setInterval(() => {
              if (closed) {
                clearInterval(heartbeat);
                return;
              }
              send({ type: "heartbeat", ts: Date.now() });
            }, 15000);

            // 3.5s is enough for live logs; 2s was hammering Supabase per open tab
            const pollInterval = setInterval(poll, 3500);
            poll();

            const cleanup = () => {
              if (closed) return;
              closed = true;
              clearInterval(heartbeat);
              clearInterval(pollInterval);
              try {
                controller.close();
              } catch {
                /* ignore close errors */
              }
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
