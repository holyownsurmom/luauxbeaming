import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, isAdminSession, unauthorized, forbidden } from "@/lib/api-helpers";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import {
  MAX_CONCURRENT_DISCORD_SPAM,
  validateDiscordSpamBody,
} from "@/lib/bot-job-validate.server";

export const Route = createFileRoute("/api/bots/discord/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const rl = rateLimit(`discord-start:${user.id}`, 15, 60_000);
        if (!rl.ok) return rateLimitResponse(rl.retryAfterSec, "Too many start attempts");

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

          const { data: liveJobs } = await db
            .from("bot_jobs")
            .select("id, config")
            .eq("discord_id", user.id)
            .eq("type", "discord")
            .in("status", ["pending", "running", "stopping", "paused"]);
          const spamLive = (liveJobs || []).filter((j) => {
            const st = (j.config as { subType?: string } | null)?.subType;
            return !st || st === "spam";
          }).length;
          if (spamLive >= MAX_CONCURRENT_DISCORD_SPAM) {
            return forbidden(
              `Max ${MAX_CONCURRENT_DISCORD_SPAM} concurrent Discord Spam bots. Stop one first.`,
            );
          }
        }

        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const parsed = validateDiscordSpamBody(body);
        if (!parsed.ok) {
          return Response.json({ error: parsed.error }, { status: 400 });
        }

        const { data: job, error } = await db
          .from("bot_jobs")
          .insert({
            discord_id: user.id,
            type: "discord",
            config: { ...parsed.config, subType: "spam" },
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
