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

        const { data, error } = await db()
          .from("verification_settings")
          .select("guild_id, bot_token, discord_id")
          .not("bot_token", "is", null);

        if (error) {
          return Response.json({ error: error.message }, { status: 500 });
        }

        const bots = (data || [])
          .filter((r) => r.bot_token && String(r.bot_token).trim().length > 20)
          .map((r) => ({
            guild_id: r.guild_id as string,
            bot_token: String(r.bot_token).trim(),
            label: `guild-${r.guild_id}`,
          }));

        // Deduplicate by token
        const seen = new Set<string>();
        const unique = bots.filter((b) => {
          if (seen.has(b.bot_token)) return false;
          seen.add(b.bot_token);
          return true;
        });

        return Response.json({ bots: unique });
      },
    },
  },
});
