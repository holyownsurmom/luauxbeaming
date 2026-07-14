import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser, admin, isAdminSession, unauthorized, forbidden } from "@/lib/api-helpers";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { validateMcLaunchFields } from "@/lib/bot-job-validate.server";

export const Route = createFileRoute("/api/bots/mc/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return unauthorized();

        const rl = rateLimit(`mc-start:${user.id}`, 20, 60_000);
        if (!rl.ok) return rateLimitResponse(rl.retryAfterSec, "Too many launch attempts");

        const db = admin();
        const adminUser = await isAdminSession();

        let maxBots = 999;
        if (!adminUser) {
          const { data: profile } = await db
            .from("profiles")
            .select("active_plan_id, plan_expires_at, bot_hours_remaining")
            .eq("discord_id", user.id)
            .maybeSingle();

          const { profileHasMcAccess } = await import("@/lib/plan-grant.server");
          const hoursRemaining = Number(profile?.bot_hours_remaining ?? 0);
          const planActive =
            !!profile?.active_plan_id &&
            !!profile?.plan_expires_at &&
            new Date(profile.plan_expires_at).getTime() > Date.now();

          if (!profileHasMcAccess(profile)) {
            return forbidden("No active plan or bot hours — purchase a plan or hours pack");
          }
          if (hoursRemaining <= 0) {
            return forbidden("No bot hours remaining — top up or buy a plan");
          }

          if (planActive && profile?.active_plan_id) {
            const { data: plan } = await db
              .from("plans")
              .select("max_bots")
              .eq("id", profile.active_plan_id)
              .maybeSingle();
            maxBots = Math.max(1, Number(plan?.max_bots ?? 1));
          } else {
            // Hours-only access: 1 concurrent bot
            maxBots = 1;
          }
        }

        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const fields = validateMcLaunchFields(body);
        if (!fields.ok) {
          return Response.json({ error: fields.error }, { status: 400 });
        }

        const accountId = String(body.accountId ?? "").trim();
        if (!accountId) {
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
          accountId,
          label: body.label,
          serverHost: fields.serverHost,
          serverPort: fields.serverPort,
          authType,
          username: body.username,
          uuid: body.uuid,
          messages: fields.messages,
          interval: fields.interval,
        };

        // Always load account from DB — trust DB auth_type over client body
        {
          let account: Record<string, unknown> | null = null;
          {
            const { data: full, error: fullErr } = await db
              .from("mc_accounts")
              .select("username,uuid,label,ssid,refresh_token,auth_type")
              .eq("id", accountId)
              .eq("discord_id", user.id)
              .maybeSingle();
            if (fullErr && /refresh_token|column/i.test(fullErr.message)) {
              const { data: legacy } = await db
                .from("mc_accounts")
                .select("username,uuid,label,ssid,auth_type")
                .eq("id", accountId)
                .eq("discord_id", user.id)
                .maybeSingle();
              account = legacy as Record<string, unknown> | null;
            } else {
              account = full as Record<string, unknown> | null;
            }
          }

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
            const rawSsid = typeof account.ssid === "string" ? account.ssid : "";
            const rawRt = typeof account.refresh_token === "string" ? account.refresh_token : "";
            // Prefer stored SSID/refresh when present; otherwise pure device-code on worker
            if (rawSsid.trim() || rawRt.trim()) {
              config.authType = "ssid";
            } else {
              config.authType = "microsoft";
              config.username =
                (typeof account.username === "string" && account.username) ||
                (typeof account.label === "string" && account.label) ||
                config.username;
              config.accountId = accountId;
              // no SSID validation — worker will run prismarine-auth device code
            }
          }

          if (config.authType === "ssid" || dbAuth === "ssid") {
            const { ensureFreshMcAccessToken } = await import("@/lib/mc-refresh.server");
            const ensured = await ensureFreshMcAccessToken({
              accountId,
              ssid: typeof account.ssid === "string" ? account.ssid : null,
              refreshToken:
                typeof account.refresh_token === "string" ? account.refresh_token : null,
            });
            if (!ensured.ok) {
              if (ensured.needsManual) {
                await db
                  .from("mc_accounts")
                  .update({ status: "token_expired" })
                  .eq("id", accountId)
                  .eq("discord_id", user.id);
              }
              return Response.json(
                {
                  error: ensured.needsManual
                    ? `${ensured.error} Open the account → paste a fresh access_token (and optional refresh_token).`
                    : ensured.error,
                },
                { status: ensured.needsManual ? 400 : 502 },
              );
            }

            config.authType = "ssid";
            config.ssid = ensured.token;
            config.username = ensured.profile.name;
            config.uuid = ensured.uuidDashed;
            config.accountId = accountId;

            const patch: Record<string, unknown> = {
              username: ensured.profile.name,
              uuid: ensured.uuidDashed,
              status: "idle",
              auth_type: "ssid",
              ssid: ensured.token,
            };
            if (ensured.refreshed) {
              patch.last_refreshed_at = new Date().toISOString();
              if (ensured.refreshToken) patch.refresh_token = ensured.refreshToken;
              if (ensured.expiresInSec) {
                patch.token_expires_at = new Date(
                  Date.now() + ensured.expiresInSec * 1000,
                ).toISOString();
              }
            }
            const { error: patchErr } = await db
              .from("mc_accounts")
              .update(patch)
              .eq("id", accountId)
              .eq("discord_id", user.id);
            if (patchErr && /refresh_token|last_refreshed|token_expires/i.test(patchErr.message)) {
              await db
                .from("mc_accounts")
                .update({
                  username: ensured.profile.name,
                  uuid: ensured.uuidDashed,
                  status: "idle",
                  auth_type: "ssid",
                  ssid: ensured.token,
                })
                .eq("id", accountId)
                .eq("discord_id", user.id);
            }
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
          return cfg.accountId === accountId;
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
            return cfg.accountId !== accountId;
          }).length;
          if (otherLive >= maxBots) {
            return forbidden(
              `Plan limit: max ${maxBots} concurrent MC bot(s). Upgrade your plan or stop another bot.`,
            );
          }
        }

        // Spend hour BEFORE enqueue so concurrent launches can't race free jobs
        let hourSpent = false;
        if (!adminUser) {
          const { data: spent, error: spendErr } = await db.rpc("spend_bot_hour", {
            p_discord_id: user.id,
          });
          if (spendErr) {
            // Atomic fallback: decrement only when still >= 1 (no client-side arithmetic)
            const { data: profileRow } = await db
              .from("profiles")
              .select("bot_hours_remaining")
              .eq("discord_id", user.id)
              .maybeSingle();
            const current = Number(profileRow?.bot_hours_remaining ?? 0);
            if (current < 1) {
              return forbidden("No bot hours remaining — top up or buy a plan");
            }
            const { data: updated, error: updErr } = await db
              .from("profiles")
              .update({ bot_hours_remaining: current - 1 })
              .eq("discord_id", user.id)
              .eq("bot_hours_remaining", current)
              .gte("bot_hours_remaining", 1)
              .select("bot_hours_remaining")
              .maybeSingle();
            if (updErr || !updated) {
              return forbidden("No bot hours remaining — top up or buy a plan");
            }
            hourSpent = true;
          } else if (spent === false || spent === null) {
            return forbidden("No bot hours remaining — top up or buy a plan");
          } else {
            hourSpent = true;
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

        if (error) {
          // Refund hour if enqueue failed after spend
          if (hourSpent) {
            const { error: refundErr } = await db.rpc("refund_bot_hour", {
              p_discord_id: user.id,
            });
            if (refundErr) {
              // Fallback: re-read + increment (best-effort)
              const { data: prof } = await db
                .from("profiles")
                .select("bot_hours_remaining")
                .eq("discord_id", user.id)
                .maybeSingle();
              const cur = Number(prof?.bot_hours_remaining ?? 0);
              await db
                .from("profiles")
                .update({ bot_hours_remaining: cur + 1 })
                .eq("discord_id", user.id);
            }
          }
          return Response.json({ error: error.message }, { status: 500 });
        }

        return Response.json({ botId: job.id });
      },
    },
  },
});
