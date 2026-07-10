import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { startDiscordSpam, type DiscordSpamConfig } from "@/lib/bot-runtime/discord-spam";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/bots/discord/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await useSession<{ user?: { id: string } }>({
          password: process.env.SESSION_SECRET!,
          name: "luaux_session",
          maxAge: 60 * 60 * 24 * 30,
        });
        const user = session.data.user;
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: keys } = await db
          .from("verification_keys")
          .select("id, key, expires_at")
          .eq("discord_id", user.id)
          .eq("plugin_id", "discord-spam")
          .order("created_at", { ascending: false })
          .limit(1);

        const activeKey = keys?.find((k) => new Date(k.expires_at).getTime() > Date.now());
        if (!activeKey) {
          return Response.json({ error: "No active Discord Spam license" }, { status: 403 });
        }

        const { data: profile } = await db
          .from("profiles")
          .select("active_plan_id, plan_expires_at")
          .eq("discord_id", user.id)
          .maybeSingle();

        const active =
          !!profile?.active_plan_id &&
          !!profile?.plan_expires_at &&
          new Date(profile.plan_expires_at).getTime() > Date.now();

        if (!active) return Response.json({ error: "No active plan" }, { status: 403 });

        let body: DiscordSpamConfig;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.token || !body.channelId || !body.messages?.length) {
          return Response.json({ error: "Missing required fields: token, channelId, messages" }, { status: 400 });
        }

        try {
          const botId = await startDiscordSpam(user.id, body);
          return Response.json({ botId });
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
        }
      },
    },
  },
});
