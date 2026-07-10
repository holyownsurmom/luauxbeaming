import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { sessionConfig, type SessionData } from "@/lib/session";

export const Route = createFileRoute("/api/discord/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const state = crypto.randomUUID();
        const session = await useSession<SessionData>(sessionConfig());
        await session.update({ ...session.data, oauth_state: state });

        const params = new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID!,
          redirect_uri: `${origin}/api/discord/callback`,
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