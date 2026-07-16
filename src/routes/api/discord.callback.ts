import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { envStr, sessionConfig, siteOrigin } from "@/lib/luaux-server.server";
import { getClientIp, checkVpn } from "@/lib/vpn-check";

type StoredUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

type SessionData = {
  oauth_state?: string;
  user?: StoredUser;
  vpnBlocked?: boolean;
  isAdmin?: boolean;
  sessionStartedAt?: number;
  sessionLabel?: string;
};

export const Route = createFileRoute("/api/discord/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const session = await useSession<SessionData>(sessionConfig());

        if (!code || !state) {
          return new Response("Missing OAuth code/state", { status: 400 });
        }
        if (!session.data.oauth_state) {
          return new Response(
            "Login session expired (cookie missing). Clear cookies for luaux.wtf and try again from https://luaux.wtf",
            { status: 400 },
          );
        }
        if (state !== session.data.oauth_state) {
          return new Response("Invalid OAuth state — start login again from the site", {
            status: 400,
          });
        }

        const origin = siteOrigin(request);
        // Must exactly match the redirect_uri used in /api/discord/login
        const redirect_uri = `${origin}/api/discord/callback`;

        const clientId = envStr("DISCORD_CLIENT_ID");
        const clientSecret = envStr("DISCORD_CLIENT_SECRET");
        if (!clientId || !clientSecret || !origin) {
          console.error("[discord] missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / SITE_URL");
          return new Response("Discord OAuth is not configured", { status: 503 });
        }

        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "authorization_code",
            code,
            redirect_uri,
          }),
        });
        if (!tokenRes.ok) {
          const t = await tokenRes.text();
          console.error(
            "[discord] token exchange failed",
            tokenRes.status,
            t,
            "redirect_uri=",
            redirect_uri,
          );
          return new Response(
            `Token exchange failed (${tokenRes.status}). Discord redirect must be exactly:\n${redirect_uri}\n\nDiscord said: ${t.slice(0, 300)}`,
            { status: 502 },
          );
        }
        const tokens = (await tokenRes.json()) as { access_token: string };

        const userRes = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (!userRes.ok) return new Response("User fetch failed", { status: 502 });
        const user = (await userRes.json()) as {
          id: string;
          username: string;
          global_name: string | null;
          avatar: string | null;
          email: string | null;
          verified?: boolean;
        };

        const db = createClient(
          envStr("SUPABASE_URL"),
          envStr("SUPABASE_SERVICE_ROLE_KEY"),
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const { data: blEntry } = await db
          .from("blacklisted_users")
          .select("discord_id")
          .eq("discord_id", user.id)
          .maybeSingle();

        if (blEntry) {
          await session.update({ ...session.data, oauth_state: undefined });
          return new Response(null, {
            status: 302,
            headers: { Location: "/account-banned" },
          });
        }

        const clientIp = await getClientIp(request);

        // IP-based alt detection: check if this IP was used by a blacklisted user
        if (clientIp) {
          const { data: ipBan } = await db
            .from("blacklisted_ips")
            .select("ip, source_discord_id, reason")
            .eq("ip", clientIp)
            .maybeSingle();

          if (ipBan) {
            console.warn(
              `[alt-detect] blocked IP ${clientIp} (linked to blacklisted user ${ipBan.source_discord_id}, reason: ${ipBan.reason || "none"})`,
            );
            await session.update({ ...session.data, oauth_state: undefined });
            return new Response(null, {
              status: 302,
              headers: { Location: "/account-banned" },
            });
          }
        }
        let vpnBlocked = false;
        if (clientIp) {
          const vpnResult = await checkVpn(clientIp);
          vpnBlocked = vpnResult.vpn;
        }

        const guildId = envStr("DISCORD_GUILD_ID");
        const botToken = envStr("DISCORD_BOT_TOKEN");
        if (guildId && botToken) {
          const joinRes = await fetch(
            `https://discord.com/api/guilds/${guildId}/members/${user.id}`,
            {
              method: "PUT",
              headers: {
                Authorization: `Bot ${botToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ access_token: tokens.access_token }),
            },
          );
          if (!joinRes.ok && joinRes.status !== 204 && joinRes.status !== 201) {
            console.warn("[discord] guild join non-fatal", joinRes.status, await joinRes.text());
          }
        }
        const avatarUrl = user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
          : null;

        // Never carry isAdmin across Discord accounts / re-logins
        await session.update({
          ...session.data,
          oauth_state: undefined,
          vpnBlocked,
          isAdmin: false,
          sessionStartedAt: Date.now(),
          user: {
            id: user.id,
            username: user.username,
            global_name: user.global_name,
            avatar: avatarUrl,
          },
        });

        try {
          await db.from("profiles").upsert(
            {
              discord_id: user.id,
              username: user.username,
              global_name: user.global_name,
              avatar_url: avatarUrl,
              email: user.email ?? null,
            },
            { onConflict: "discord_id" },
          );
        } catch (e) {
          console.warn("[discord] profile upsert failed", e);
        }

        // Store login IP for future alt detection
        if (clientIp) {
          try {
            await db.from("user_login_ips").insert({
              discord_id: user.id,
              ip: clientIp,
            });
          } catch (e) {
            console.warn("[discord] failed to store login IP", e);
          }
        }

        if (vpnBlocked) {
          return new Response(null, {
            status: 302,
            headers: { Location: "/vpn-blocked" },
          });
        }

        return new Response(null, {
          status: 302,
          headers: { Location: "/dashboard" },
        });
      },
    },
  },
});
