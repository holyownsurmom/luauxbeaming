import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@tanstack/react-start/server";
import { startMcBot, type McBotConfig } from "@/lib/bot-runtime/mc";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/bots/mc/start")({
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

        const { data: profile } = await db
          .from("profiles")
          .select("active_plan_id, plan_expires_at, bot_hours_remaining")
          .eq("discord_id", user.id)
          .maybeSingle();

        const active =
          !!profile?.active_plan_id &&
          !!profile?.plan_expires_at &&
          new Date(profile.plan_expires_at).getTime() > Date.now();

        if (!active) return Response.json({ error: "No active plan" }, { status: 403 });
        if ((profile?.bot_hours_remaining ?? 0) <= 0) {
          return Response.json({ error: "No bot hours remaining" }, { status: 403 });
        }

        let body: McBotConfig;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.serverHost || !body.serverPort || !body.messages?.length) {
          return Response.json({ error: "Missing required fields: serverHost, serverPort, messages" }, { status: 400 });
        }

        try {
          const botId = await startMcBot(user.id, {
            ...body,
            label: body.label || body.serverHost,
          });
          return Response.json({ botId });
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
        }
      },
    },
  },
});
