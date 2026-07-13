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

        let maxBots = 999;
        let hoursRemaining = 0;
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

          if (!active) return forbidden("No active plan — purchase a plan to run MC bots");
          hoursRemaining = Number(profile?.bot_hours_remaining ?? 0);
          if (hoursRemaining <= 0) {
            return forbidden("No bot hours remaining — top up or buy a plan");
          }

          if (profile?.active_plan_id) {
            const { data: plan } = await db
              .from("plans")
              .select("max_bots")
              .eq("id", profile.active_plan_id)
              .maybeSingle();
            maxBots = Math.max(1, Number(plan?.max_bots ?? 1));
          } else {
            maxBots = 1;
          }

          const { count: liveCount } = await db
            .from("bot_jobs")
            .select("id", { count: "exact", head: true })
            .eq("discord_id", user.id)
            .eq("type", "mc")
            .in("status", ["pending", "running", "stopping", "paused"]);

          // After we stop same-account jobs, count others; hard cap = max_bots
          if ((liveCount ?? 0) >= maxBots) {
            // Allow replace if launching same account (handled below) — check after stop
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

        const authTypeRaw = String(body.authType || "microsoft");
        const authType =
          authTypeRaw === "offline"
            ? "offline"
            : authTypeRaw === "ssid"
              ? "ssid"
              : "microsoft";

        let config: Record<string, unknown> = {
          accountId: body.accountId,
          label: body.label,
          serverHost: body.serverHost,
          serverPort: body.serverPort,
          authType,
          username: body.username,
          uuid: body.uuid,
          messages: body.messages,
          interval: body.interval,
        };

        // Always load account from DB — trust DB auth_type over client body
        {
          const { data: account } = await db
            .from("mc_accounts")
            .select("username,uuid,label,ssid,auth_type")
            .eq("id", body.accountId)
            .eq("discord_id", user.id)
            .maybeSingle();

          if (!account) {
            return Response.json({ error: "Account not found" }, { status: 404 });
          }

          const dbAuth =
            account.auth_type === "offline"
              ? "offline"
              : account.auth_type === "ssid"
                ? "ssid"
                : "microsoft";

          config.authType = dbAuth;
          config.username = account.username || body.username || body.label;
          config.uuid = account.uuid || body.uuid || "";
          config.label = account.label || body.label;

          if (dbAuth === "microsoft") {
            // Headless VPS cannot complete interactive device-code login.
            // Prefer stored SSID if present; otherwise require SSID conversion.
            const rawSsid = typeof account.ssid === "string" ? account.ssid : "";
            if (!rawSsid.trim()) {
              return Response.json(
                {
                  error:
                    "Microsoft device-code login is not available on the bot server. Add this account as SSID (access_token) or paste a token via Refresh Token.",
                },
                { status: 400 },
              );
            }
            // Fall through as SSID
            config.authType = "ssid";
          }

          if (config.authType === "ssid" || dbAuth === "ssid") {
            const { normalizeMcAccessToken, validateMinecraftSsid } = await import(
              "@/lib/mc-ssid.server"
            );
            const ssid = normalizeMcAccessToken(
              typeof account.ssid === "string" ? account.ssid : String(config.ssid || ""),
            );
            if (!ssid) {
              return Response.json(
                {
                  error:
                    "No SSID stored on this account. Use Refresh Token and paste a fresh access_token.",
                },
                { status: 400 },
              );
            }

            // Re-validate at launch so expired tokens fail before worker spin-up
            const check = await validateMinecraftSsid(ssid);
            if (!check.ok) {
              await db
                .from("mc_accounts")
                .update({ status: "token_expired" })
                .eq("id", body.accountId)
                .eq("discord_id", user.id);
              return Response.json(
                {
                  error: `${check.error} Open the account → Refresh Token.`,
                },
                { status: 400 },
              );
            }

            config.authType = "ssid";
            config.ssid = check.token;
            config.username = check.profile.name;
            config.uuid = check.uuidDashed;

            // Keep profile fields fresh
            await db
              .from("mc_accounts")
              .update({
                username: check.profile.name,
                uuid: check.uuidDashed,
                status: "idle",
                auth_type: "ssid",
              })
              .eq("id", body.accountId)
              .eq("discord_id", user.id);
          }
        }

        // Only stop other jobs for THIS account (same accountId) — prevents multi-socket Invalid sequence.
        // Different accounts can run in parallel up to plan max_bots.
        const { data: existingJobs } = await db
          .from("bot_jobs")
          .select("id, config, status")
          .eq("discord_id", user.id)
          .eq("type", "mc")
          .in("status", ["pending", "running", "stopping", "paused"]);

        const sameAccount = (existingJobs || []).filter((j) => {
          const cfg = (j.config || {}) as { accountId?: string };
          return cfg.accountId === body.accountId;
        });

        if (sameAccount.length > 0) {
          await db
            .from("bot_jobs")
            .update({ status: "stopped", error: "Replaced by new launch (same account)" })
            .in(
              "id",
              sameAccount.map((j) => j.id),
            );
        }

        if (!adminUser) {
          const otherLive = (existingJobs || []).filter((j) => {
            const cfg = (j.config || {}) as { accountId?: string };
            return cfg.accountId !== body.accountId;
          }).length;
          if (otherLive >= maxBots) {
            return forbidden(
              `Plan limit: max ${maxBots} concurrent MC bot(s). Upgrade your plan or stop another bot.`,
            );
          }
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

        // Consume 1 bot-hour atomically (admins unlimited)
        if (!adminUser) {
          const { data: spent, error: spendErr } = await db.rpc("spend_bot_hour", {
            p_discord_id: user.id,
          });
          if (spendErr) {
            // Fallback if RPC missing: conditional update
            const { data: updated, error: updErr } = await db
              .from("profiles")
              .update({ bot_hours_remaining: hoursRemaining - 1 })
              .eq("discord_id", user.id)
              .gte("bot_hours_remaining", 1)
              .select("bot_hours_remaining")
              .maybeSingle();
            if (updErr || !updated) {
              await db.from("bot_jobs").update({ status: "error", error: "No bot hours remaining" }).eq("id", job.id);
              return forbidden("No bot hours remaining — top up or buy a plan");
            }
          } else if (spent === false || spent === null) {
            await db.from("bot_jobs").update({ status: "error", error: "No bot hours remaining" }).eq("id", job.id);
            return forbidden("No bot hours remaining — top up or buy a plan");
          }
        }

        return Response.json({ botId: job.id });
      },
    },
  },
});
