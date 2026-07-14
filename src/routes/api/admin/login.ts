import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import {
  sessionConfig,
  timingSafeEqualStrings,
  admin as adminDb,
  envStr,
} from "@/lib/luaux-server.server";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit.server";

type SessionData = {
  user?: { id: string; username: string; global_name: string | null; avatar: string | null };
  isAdmin?: boolean;
};

/** Comma-separated Discord user IDs allowed to unlock admin with ADMIN_PASSWORD */
function adminAllowlist(): string[] {
  return envStr("ADMIN_DISCORD_IDS")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const Route = createFileRoute("/api/admin/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await useSession<SessionData>(sessionConfig());
        if (!session.data.user) {
          return Response.json({ error: "Not logged in" }, { status: 401 });
        }

        const ip = clientIp(request);
        const uid = session.data.user.id;
        const rl = rateLimit(`admin-login:${ip}:${uid}`, 5, 15 * 60_000);
        if (!rl.ok) {
          return rateLimitResponse(rl.retryAfterSec, "Too many admin login attempts");
        }

        let body: { password?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const password = envStr("ADMIN_PASSWORD");
        if (!password || password.length < 8) {
          return Response.json({ error: "Admin login is not configured" }, { status: 503 });
        }
        if (!body.password || !timingSafeEqualStrings(String(body.password), password)) {
          return Response.json({ error: "Wrong password" }, { status: 403 });
        }

        const db = adminDb();
        const discordId = session.data.user.id;
        const allow = adminAllowlist();

        const { data: existing } = await db
          .from("admins")
          .select("discord_id")
          .eq("discord_id", discordId)
          .maybeSingle();

        // Password alone must NOT promote random Discord accounts.
        // Allow if already in admins table OR listed in ADMIN_DISCORD_IDS.
        if (!existing && (allow.length === 0 || !allow.includes(discordId))) {
          return Response.json(
            {
              error:
                "This Discord account is not an authorized admin. Set ADMIN_DISCORD_IDS or seed public.admins.",
            },
            { status: 403 },
          );
        }

        if (!existing && allow.includes(discordId)) {
          const { error: upsertErr } = await db.from("admins").upsert(
            { discord_id: discordId, note: "allowlist" },
            { onConflict: "discord_id" },
          );
          if (upsertErr) {
            return Response.json(
              { error: `Failed to register admin: ${upsertErr.message}` },
              { status: 500 },
            );
          }
        }

        await session.update({ ...session.data, isAdmin: true });
        return Response.json({ ok: true });
      },
    },
  },
});
