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

        // Per-user verification bots (online via Gateway)
        const { data: rows } = await db()
          .from("verification_settings")
          .select("guild_id, bot_token, discord_id")
          .not("bot_token", "is", null);

        const bots = (rows || [])
          .filter((r) => r.bot_token)
          .map((r) => ({
            guild_id: r.guild_id,
            bot_token: r.bot_token as string,
            label: `user-${String(r.discord_id || "").slice(0, 8)}`,
          }));

        // Optional central fallback if configured
        const central = envStr("DISCORD_BOT_TOKEN");
        if (central && bots.length === 0) {
          bots.push({
            guild_id: "central",
            bot_token: central,
            label: "luaux-verification",
          });
        }

        return Response.json({ bots });
      },
    },
  },
});
