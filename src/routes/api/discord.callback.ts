import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { sessionConfig } from "@/lib/luaux-server.server";

type StoredUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

type SessionData = { oauth_state?: string; user?: StoredUser };

export const Route = createFileRoute("/api/discord/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const session = await useSession<SessionData>(sessionConfig());

        if (!code || !state || state !== session.data.oauth_state) {
          return new Response("Invalid OAuth state", { status: 400 });
        }

        const redirect_uri = `${url.origin}/api/discord/callback`;
        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID!,
            client_secret: process.env.DISCORD_CLIENT_SECRET!,
            grant_type: "authorization_code",
            code,
            redirect_uri,
          }),
        });
        if (!tokenRes.ok) {
          const t = await tokenRes.text();
          console.error("[discord] token exchange failed", tokenRes.status, t);
          return new Response("Token exchange failed", { status: 502 });
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

        // Auto-join user to the Discord server
        const joinRes = await fetch(
          `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ access_token: tokens.access_token }),
          },
        );
        if (!joinRes.ok && joinRes.status !== 204 && joinRes.status !== 201) {
          console.warn("[discord] guild join non-fatal", joinRes.status, await joinRes.text());
        }

        const avatarUrl = user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
          : null;

        await session.update({
          ...session.data,
          oauth_state: undefined,
          user: {
            id: user.id,
            username: user.username,
            global_name: user.global_name,
            avatar: avatarUrl,
          },
        });

        // Upsert profile in database
        try {
          const db = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
              auth: { persistSession: false, autoRefreshToken: false },
            },
          );
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

        return new Response(null, {
          status: 302,
          headers: { Location: "/dashboard" },
        });
      },
    },
  },
});
