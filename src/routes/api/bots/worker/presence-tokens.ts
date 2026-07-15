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

        // Per-user verification bots only (gateway handles Verify clicks)
        // Never use central DISCORD_BOT_TOKEN — invalid tokens cause 4004 spam
        const { data: rows } = await db()
          .from("verification_settings")
          .select("guild_id, bot_token, discord_id")
          .not("bot_token", "is", null);

        const bots = (rows || [])
          .filter((r) => typeof r.bot_token === "string" && r.bot_token.trim().length > 20)
          .map((r) => ({
            guild_id: r.guild_id,
            bot_token: (r.bot_token as string).trim(),
            label: `user-${String(r.discord_id || "").slice(0, 8)}`,
          }));

        return Response.json({ bots });
      },
    },
  },
});
