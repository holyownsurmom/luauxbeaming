import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, isAdminSession, unauthorized, forbidden } from "@/lib/api-helpers";

export const Route = createFileRoute("/api/bots/mc/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const db = admin();
        const adminUser = await isAdminSession();

        if (!adminUser) {
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
          return Response.json(
            { error: "Missing required fields: serverHost, serverPort, messages" },
            { status: 400 },
          );
        }

        if (!body.accountId) {
          return Response.json({ error: "accountId required" }, { status: 400 });
        }

        let config: Record<string, unknown> = {
          accountId: body.accountId,
          label: body.label,
          serverHost: body.serverHost,
          serverPort: body.serverPort,
          authType: body.authType,
          username: body.username,
          uuid: body.uuid,
          messages: body.messages,
          interval: body.interval,
        };

        if (body.authType === "ssid") {
          const { data: account } = await db
            .from("mc_accounts")
            .select("ssid,username,uuid")
            .eq("id", body.accountId)
            .eq("discord_id", user.id)
            .maybeSingle();

          if (!account?.ssid) {
            return Response.json(
              { error: "SSID not found for this account. Re-add the account with a valid SSID." },
              { status: 400 },
            );
          }

          config.ssid = account.ssid;
          config.username = account.username || body.username || body.label;
          config.uuid = account.uuid || body.uuid || "";
        }

        // Stop any other active MC jobs for this account so the server doesn't
        // kick for "logged in from another location" / duplicate sessions.
        const { data: existingJobs } = await db
          .from("bot_jobs")
          .select("id, config, status")
          .eq("discord_id", user.id)
          .eq("type", "mc")
          .in("status", ["pending", "running"]);

        const toStop = (existingJobs || []).filter((j) => {
          const cfg = (j.config || {}) as { accountId?: string };
          return cfg.accountId === body.accountId;
        });

        if (toStop.length > 0) {
          await db
            .from("bot_jobs")
            .update({ status: "stopping" })
            .in(
              "id",
              toStop.map((j) => j.id),
            );
        }

        const { data: job, error } = await db
          .from("bot_jobs")
          .insert({
            discord_id: user.id,
            type: "mc",
            config,
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
