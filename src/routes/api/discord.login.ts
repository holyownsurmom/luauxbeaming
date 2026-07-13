import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { envStr, sessionConfig, siteOrigin } from "@/lib/luaux-server.server";

type SessionData = { oauth_state?: string; user?: unknown };

export const Route = createFileRoute("/api/discord/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = siteOrigin(request);
        const clientId = envStr("DISCORD_CLIENT_ID");
        if (!origin || !clientId) {
          return new Response("Discord OAuth is not configured (SITE_URL / DISCORD_CLIENT_ID)", {
            status: 503,
          });
        }

        const state = crypto.randomUUID();
        const session = await useSession<SessionData>(sessionConfig());
        await session.update({ ...session.data, oauth_state: state });

        const redirectUri = `${origin}/api/discord/callback`;
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "identify email guilds.join",
          state,
          prompt: "consent",
        });
        return new Response(null, {
          status: 302,
          headers: { Location: `https://discord.com/api/oauth2/authorize?${params.toString()}` },
        });
      },
    },
  },
});
