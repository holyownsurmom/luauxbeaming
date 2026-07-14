import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";

/**
 * Worker fetches a fresh SSID session for an MC job.
 * Optional: if refresh_token is stored, auto-refreshes expired access tokens.
 * Without refresh_token, behavior matches the original SSID-only flow.
 */
export const Route = createFileRoute("/api/bots/worker/mc-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let body: {
          job_id?: string;
          account_id?: string;
          discord_id?: string;
          mark_expired?: boolean;
        };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const db = workerDb();

        if (body.mark_expired && body.account_id) {
          let q = db
            .from("mc_accounts")
            .update({ status: "token_expired" })
            .eq("id", body.account_id);
          if (body.discord_id) q = q.eq("discord_id", body.discord_id);
          const { error } = await q;
          if (error) return Response.json({ error: error.message }, { status: 500 });
          return Response.json({ ok: true, status: "token_expired" });
        }

        let accountId = body.account_id?.trim() || "";
        let discordId = body.discord_id?.trim() || "";

        if (body.job_id) {
          const { data: job, error: jobErr } = await db
            .from("bot_jobs")
            .select("id, discord_id, type, config, status")
            .eq("id", body.job_id)
            .maybeSingle();
          if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 });
          if (!job || job.type !== "mc") {
            return Response.json({ error: "MC job not found" }, { status: 404 });
          }
          discordId = job.discord_id;
          const cfg = (job.config || {}) as { accountId?: string; ssid?: string };
          if (!accountId && cfg.accountId) accountId = String(cfg.accountId);
        }

        if (!accountId) {
          return Response.json({ error: "account_id or job_id required" }, { status: 400 });
        }

        const { data: account, error: accErr } = await db
          .from("mc_accounts")
          .select(
            "id, discord_id, username, uuid, ssid, refresh_token, auth_type, status, label, token_expires_at",
          )
          .eq("id", accountId)
          .maybeSingle();

        if (accErr) {
          // Older DBs without refresh_token column — fall back
          if (/refresh_token|column/i.test(accErr.message)) {
            const { data: legacy, error: legErr } = await db
              .from("mc_accounts")
              .select("id, discord_id, username, uuid, ssid, auth_type, status, label")
              .eq("id", accountId)
              .maybeSingle();
            if (legErr) return Response.json({ error: legErr.message }, { status: 500 });
            if (!legacy) return Response.json({ error: "Account not found" }, { status: 404 });
            return await resolveAndRespond(db, legacy as Record<string, unknown>, discordId);
          }
          return Response.json({ error: accErr.message }, { status: 500 });
        }
        if (!account) return Response.json({ error: "Account not found" }, { status: 404 });
        if (discordId && account.discord_id !== discordId) {
          return Response.json({ error: "Account ownership mismatch" }, { status: 403 });
        }

        return await resolveAndRespond(db, account as Record<string, unknown>, discordId);
      },
    },
  },
});

async function resolveAndRespond(
  db: ReturnType<typeof workerDb>,
  account: Record<string, unknown>,
  discordId: string,
) {
  const { ensureFreshMcAccessToken } = await import("@/lib/mc-refresh.server");
  const ensured = await ensureFreshMcAccessToken({
    accountId: String(account.id),
    ssid: typeof account.ssid === "string" ? account.ssid : null,
    refreshToken: typeof account.refresh_token === "string" ? account.refresh_token : null,
  });

  if (!ensured.ok) {
    if (ensured.needsManual || ensured.code === "token_expired" || ensured.code === "msa") {
      await db
        .from("mc_accounts")
        .update({ status: "token_expired" })
        .eq("id", account.id);
    }
    return Response.json(
      {
        error: ensured.error,
        code: ensured.code,
        needsManual: ensured.needsManual,
      },
      {
        status:
          ensured.code === "token_expired" || ensured.code === "msa" || ensured.code === "no_ssid"
            ? 401
            : 502,
      },
    );
  }

  const patch: Record<string, unknown> = {
    username: ensured.profile.name,
    uuid: ensured.uuidDashed,
    auth_type: "ssid",
    status: "idle",
    ssid: ensured.token,
  };
  if (ensured.refreshed) {
    patch.last_refreshed_at = new Date().toISOString();
    if (ensured.refreshToken) patch.refresh_token = ensured.refreshToken;
    if (ensured.expiresInSec) {
      patch.token_expires_at = new Date(Date.now() + ensured.expiresInSec * 1000).toISOString();
    }
  }

  const { error: updErr } = await db.from("mc_accounts").update(patch).eq("id", account.id);
  if (updErr && /refresh_token|last_refreshed|token_expires/i.test(updErr.message)) {
    // Column missing — still update core fields
    await db
      .from("mc_accounts")
      .update({
        username: ensured.profile.name,
        uuid: ensured.uuidDashed,
        auth_type: "ssid",
        status: "idle",
        ssid: ensured.token,
      })
      .eq("id", account.id);
  }

  return Response.json({
    ok: true,
    accountId: account.id,
    token: ensured.token,
    username: ensured.profile.name,
    uuid: ensured.uuidDashed,
    rawUuid: ensured.profile.id,
    label: account.label,
    refreshed: ensured.refreshed,
  });
}
