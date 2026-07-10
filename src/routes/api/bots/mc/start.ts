import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, isAdmin, unauthorized, forbidden } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/mc/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const db = admin();
        const admin_ = await isAdmin(user.id);

        if (!admin_) {
          const { data: profile } = await db
            .from("profiles")
            .select("active_plan_id, plan_expires_at, bot_hours_remaining")
            .eq("discord_id", user.id)
            .maybeSingle();

          const active =
            !!profile?.active_plan_id &&
            !!profile?.plan_expires_at &&
            new Date(profile.plan_expires_at).getTime() > Date.now();

          if (!active) return forbidden("No active plan");
          if ((profile?.bot_hours_remaining ?? 0) <= 0) {
            return forbidden("No bot hours remaining");
          }
        }

        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.serverHost || !body.serverPort || !body.messages?.length) {
          return Response.json({ error: "Missing required fields: serverHost, serverPort, messages" }, { status: 400 });
        }

        const { data: job, error } = await db
          .from("bot_jobs")
          .insert({
            discord_id: user.id,
            type: "mc",
            config: body,
            status: "pending",
          })
          .select("id")
          .single();

        if (error) return Response.json({ error: error.message }, { status: 500 });

        return Response.json({ botId: job.id });
      },
    },
  },
});
