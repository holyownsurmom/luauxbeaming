import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";
import { envStr } from "@/lib/luaux-server.server";

const db = workerDb;

/** Worker polls this to keep verification bots online via Gateway. */
export const Route = createFileRoute("/api/bots/worker/presence-tokens")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authWorker(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Central LuauX bot only — one gateway connection keeps the bot online
        const central = envStr("DISCORD_BOT_TOKEN");
        if (!central) {
          return Response.json({ bots: [] });
        }
        return Response.json({
          bots: [
            {
              guild_id: "central",
              bot_token: central,
              label: "luaux-verification",
            },
          ],
        });
      },
    },
  },
});
