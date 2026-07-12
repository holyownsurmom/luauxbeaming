import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

function authWorker(request: Request): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;
  const token = request.headers.get("x-worker-secret") || "";
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Worker polls this to keep verification bots online via Gateway. */
export const Route = createFileRoute("/api/bots/worker/presence-tokens")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authWorker(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Central LuauX bot only — one gateway connection keeps the bot online
        const central = process.env.DISCORD_BOT_TOKEN?.trim();
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
