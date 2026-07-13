import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, isAdminSession, unauthorized, forbidden } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/discord/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const db = admin();
        const adminUser = await isAdminSession();

        // Plugin license only — Discord Spam does not require an MC plan
        if (!adminUser) {
          const { data: keys } = await db
            .from("verification_keys")
            .select("id, key, expires_at")
            .eq("discord_id", user.id)
            .eq("plugin_id", "discord-spam")
            .order("created_at", { ascending: false })
            .limit(5);

          const activeKey = keys?.find((k) => new Date(k.expires_at).getTime() > Date.now());
          if (!activeKey) {
            return forbidden("No active Discord Spam license");
          }
        }

        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.token || !body.channelId || !body.messages?.length) {
          return Response.json(
            { error: "Missing required fields: token, channelId, messages" },
            { status: 400 },
          );
        }

        const { data: job, error } = await db
          .from("bot_jobs")
          .insert({
            discord_id: user.id,
            type: "discord",
            config: { ...body, subType: "spam" },
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
