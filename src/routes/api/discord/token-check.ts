import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/luaux-server.server";

/**
 * Lightweight Discord user-token health check (no messages sent).
 * Returns ok / invalid / captcha / rate_limited / network.
 */
export const Route = createFileRoute("/api/discord/token-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        let body: { token?: string };
        try {
          body = (await request.json()) as { token?: string };
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }

        const token = String(body.token ?? "").trim();
        if (!token || token.length < 20 || token.length > 512) {
          return Response.json({ ok: false, status: "invalid", error: "Token required" }, { status: 400 });
        }

        try {
          const res = await fetch("https://discord.com/api/v9/users/@me", {
            headers: {
              Authorization: token,
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
              "Content-Type": "application/json",
            },
          });

          const text = await res.text();
          if (res.ok) {
            let username = "";
            let id = "";
            try {
              const j = JSON.parse(text) as { username?: string; id?: string; global_name?: string };
              username = j.global_name || j.username || "";
              id = j.id || "";
            } catch {
              /* ignore */
            }
            return Response.json({
              ok: true,
              status: "ok",
              username,
              id,
              message: username ? `Valid · @${username}` : "Token is valid",
            });
          }

          if (res.status === 401 || res.status === 403) {
            return Response.json({
              ok: false,
              status: "invalid",
              message: "Token invalid, revoked, or banned",
            });
          }
          if (res.status === 429) {
            return Response.json({
              ok: false,
              status: "rate_limited",
              message: "Discord rate-limited this check — try again in a minute",
            });
          }
          if (res.status === 400 && /captcha/i.test(text)) {
            return Response.json({
              ok: false,
              status: "captcha",
              message: "Account flagged (captcha) — use a different alt",
            });
          }
          return Response.json({
            ok: false,
            status: "error",
            message: `Discord returned ${res.status}`,
          });
        } catch (e) {
          return Response.json({
            ok: false,
            status: "network",
            message: e instanceof Error ? e.message : "Network error",
          });
        }
      },
    },
  },
});
