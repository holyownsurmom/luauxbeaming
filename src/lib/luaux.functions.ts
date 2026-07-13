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
  const active =
    !!profile?.active_plan_id &&
    !!profile?.plan_expires_at &&
    new Date(profile.plan_expires_at).getTime() > Date.now();
  const { isAdminSession } = await import("./luaux-server.server");
  const isAdmin = await isAdminSession();
  // Admin UI bypass only — never invent a paid plan for display
  return { profile, plan, active: active || isAdmin, isAdmin };
});

export const getPlans = createServerFn({ method: "GET" }).handler(async () => {
  const { admin } = await import("./luaux-server.server");
  const { data } = await admin().from("plans").select("*").order("sort_order");
  return data ?? [];
});

export const getMcAccounts = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUser, admin } = await import("./luaux-server.server");
  const user = await requireUser();
  const { data } = await admin()
    .from("mc_accounts")
    .select("id,label,auth_type,username,uuid,status,created_at,ssid")
    .eq("discord_id", user.id)
    .order("created_at", { ascending: false });
  // Never send raw ssid to the browser — only a boolean flag
  return (data ?? []).map((row) => {
    const { ssid, ...rest } = row as typeof row & { ssid?: string | null };
    return {
      ...rest,
      has_ssid: !!(ssid && String(ssid).trim().length > 0),
    };
  });
});

/** Preview SSID without saving — returns IGN + UUID for UI confirmation */
export const previewMcSsid = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ ssid: z.string().min(1).max(4000) }).parse(input))
  .handler(async ({ data }) => {
    await (await import("./luaux-server.server")).requireUser();
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
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();

    let username = data.username?.trim() || null;
    let uuid = data.uuid?.trim() || null;
    let ssid: string | null = null;

    if (data.auth_type === "ssid") {
      const { validateMinecraftSsid } = await import("./mc-ssid.server");
      const result = await validateMinecraftSsid(data.ssid || "");
      if (!result.ok) throw new Error(result.error);
      ssid = result.token;
      username = result.profile.name;
      uuid = result.uuidDashed;
    }

    if (data.auth_type === "microsoft" && !username) {
      throw new Error("Username/email required for Microsoft accounts");
    }
    if (data.auth_type === "offline" && !username) {
      throw new Error("Username required for offline accounts");
    }

    // Prefer label from IGN for SSID if user left generic label
    const label =
      data.auth_type === "ssid" && (!data.label || data.label === "alt-1")
        ? username || data.label
        : data.label;

    const { data: row, error } = await admin()
      .from("mc_accounts")
      .insert({
        discord_id: user.id,
        label,
        auth_type: data.auth_type,
        username,
        uuid,
        ssid,
        status: "idle",
      })
      .select("id,label,auth_type,username,uuid,status,created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Replace SSID on an existing account (token refresh without re-create) */
export const refreshMcSsid = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        ssid: z.string().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const { validateMinecraftSsid } = await import("./mc-ssid.server");
    const result = await validateMinecraftSsid(data.ssid);
    if (!result.ok) throw new Error(result.error);

    const { data: row, error } = await admin()
      .from("mc_accounts")
      .update({
        auth_type: "ssid",
        ssid: result.token,
        username: result.profile.name,
        uuid: result.uuidDashed,
        status: "idle",
      })
      .eq("id", data.id)
      .eq("discord_id", user.id)
      .select("id,label,auth_type,username,uuid,status")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) throw new Error("Account not found");
    return row;
  });

export const deleteMcAccount = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const { error } = await admin()
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
  const apiKey = process.env.NOWPAYMENTS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "NOWPAYMENTS_API_KEY is not set. Add it in Vercel env / .env to create invoices.",
    );
  }

  // Prefer explicit IPN URL, then SITE_URL / VERCEL_URL (custom domain / Vercel)
  const siteBase =
    process.env.SITE_URL?.replace(/\/$/, "") ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//, "")}`
      : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://luaux.wtf";
  const ipn =
    process.env.IPN_CALLBACK_URL?.trim() ||
    `${siteBase}/api/public/nowpayments/webhook`;

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
    await ensureProfile(user);
    const db = admin();
    const isAdm = await isAdminSession();
    const { data: plan } = await db.from("plans").select("*").eq("id", data.plan_id).maybeSingle();
    if (!plan) throw new Error("Unknown plan");

    const order_id = `luaux_${user.id}_${Date.now()}`;

    // Admin bypass: instantly activate without external payment
    if (isAdm) {
      const { data: row } = await db
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

      // Activate plan + add hours
      const { data: profile } = await db
        .from("profiles")
        .select("plan_expires_at, bot_hours_remaining")
        .eq("discord_id", user.id)
        .maybeSingle();

      const now = Date.now();
      const existingExpiry = profile?.plan_expires_at
        ? new Date(profile.plan_expires_at).getTime()
        : 0;
      const base = Math.max(existingExpiry, now);
      const expiryDays = plan.duration_days || 90;

      // MC plans only — plugins grant keys, not profile plan slots
      if (plan.kind !== "plugin") {
        const planUpdate: Record<string, unknown> = {
          active_plan_id: plan.id,
          plan_expires_at: new Date(base + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
          bot_hours_remaining: Number(profile?.bot_hours_remaining ?? 0) + Number(plan.bot_hours),
        };
        await db.from("profiles").update(planUpdate).eq("discord_id", user.id);
      }

      // For plugin plans, generate key(s) instantly (bundle grants both spam + autoreply)
      const PLUGIN_META: Record<string, { prefix: string; label: string }> = {
        verification: { prefix: "LX-VB", label: "Verification Bot" },
        "discord-spam": { prefix: "LX-DS", label: "Discord Spam" },
        "discord-autoreply": { prefix: "LX-AR", label: "Discord Auto-Reply" },
      };
      const PLUGIN_GRANTS: Record<string, string[]> = {
        verification: ["verification"],
        "discord-spam": ["discord-spam"],
        "discord-autoreply": ["discord-autoreply"],
        "discord-bundle": ["discord-spam", "discord-autoreply"],
      };
      const grantPluginIds = PLUGIN_GRANTS[plan.id] ?? [];
      if (plan.kind === "plugin" && grantPluginIds.length > 0 && row) {
        const rand = (n: number) => {
          const bytes = new Uint8Array(n);
          crypto.getRandomValues(bytes);
          return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase();
        };
        const expires = new Date(now + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();
        for (const pluginId of grantPluginIds) {
          const meta = PLUGIN_META[pluginId];
          if (!meta) continue;
          const key = `${meta.prefix}-${rand(4)}-${rand(4)}-${rand(4)}`;
          await db.from("verification_keys").insert({
            discord_id: user.id,
            key,
            expires_at: expires,
            source_payment_id: row.id,
            plugin_id: pluginId,
            delivered: true,
          });
        }
      }

      return {
        id: row!.id,
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
      .select("*")
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
    .select("*")
    .eq("discord_id", user.id)
    .maybeSingle();
  return data;
});

export const getSecuredAccounts = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUser, admin } = await import("./luaux-server.server");
  const user = await requireUser();
  const { data } = await admin()
    .from("secured_accounts")
    .select("*")
    .eq("discord_id", user.id)
    .order("secured_at", { ascending: false })
    .limit(20);
  return data ?? [];
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

    // Central LuauX bot only — no user token/public key required
    const botTokenToUse = process.env.DISCORD_BOT_TOKEN;
    if (!botTokenToUse) {
      throw new Error("Server missing DISCORD_BOT_TOKEN — contact support");
    }

    const guildId = data.guild_id.trim();
    const channelId = data.channel_id.trim();
    const roleId = data.verified_role_id.trim();

    // Verify bot is in the guild
    const guildRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${botTokenToUse}` },
    });
    if (!guildRes.ok) {
      throw new Error(
        "LuauX bot is not in that server. Use the Invite Bot button first, then try again.",
      );
    }

    // Verify channel is reachable
    const chRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: { Authorization: `Bot ${botTokenToUse}` },
    });
    if (!chRes.ok) {
      throw new Error(
        "Cannot access that channel. Check Channel ID and give the bot View Channel + Send Messages.",
      );
    }

    const { error } = await db.from("verification_settings").upsert(
      {
        discord_id: user.id,
        guild_id: guildId,
        verified_role_id: roleId,
        channel_id: channelId,
        message_title: data.message_title,
        message_description: data.message_description,
        button_text: data.button_text,
        // Clear per-user bot creds — always use central LuauX bot
        bot_token: null,
        bot_public_key: null,
      },
      { onConflict: "discord_id" },
    );

    if (error) throw new Error(error.message);

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
        `Saved, but could not post the Verify button (${channelRes.status}). Give the bot Send Messages + Embed Links in that channel.`,
      );
    }

    return { ok: true };
  });

/** Public invite URL for the central LuauX verification bot */
export const getVerificationBotInvite = createServerFn({ method: "GET" }).handler(async () => {
  const clientId = process.env.DISCORD_CLIENT_ID || "";
  // Manage Roles, View Channels, Send Messages, Embed Links, Use App Commands, Read Message History
  const permissions = "268561408";
  const invite = clientId
    ? `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot%20applications.commands`
    : "";
  return {
    invite,
    clientId,
    hasCentralBot: !!(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_PUBLIC_KEY),
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

    const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
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
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
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

    // Load recent keys and match case-insensitively (avoids filter injection / case issues)
    const { data: all, error: listErr } = await db
      .from("verification_keys")
      .select("id, key, discord_id, plugin_id, expires_at")
      .order("created_at", { ascending: false })
      .limit(2000);

    if (listErr) throw new Error(listErr.message);

    const keyRow = (all || []).find(
      (k) => String(k.key).toUpperCase().replace(/\s+/g, "") === normalized,
    );

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

    const { data: claimed, error: claimErr } = await db
      .from("verification_keys")
      .update({ discord_id: user.id, delivered: true })
      .eq("id", keyRow.id)
      .select("id, key, plugin_id, expires_at, discord_id")
      .single();

    if (claimErr || !claimed) {
      throw new Error(claimErr?.message || "Failed to redeem key");
    }

    // Ensure we won the claim (no concurrent redeem to another user)
    if (claimed.discord_id !== user.id) {
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
        const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
          method: "POST",
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
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
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
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

    const { data: profile } = await db
      .from("profiles")
      .select("plan_expires_at, bot_hours_remaining")
      .eq("discord_id", data.discord_id.trim())
      .maybeSingle();

    const now = Date.now();
    const existingExpiry = profile?.plan_expires_at
      ? new Date(profile.plan_expires_at).getTime()
      : 0;
    const base = Math.max(existingExpiry, now);
    const expiryDays = plan.duration_days || 90;
    const hours =
      Number(profile?.bot_hours_remaining ?? 0) +
      Number(plan.bot_hours ?? 0) +
      Number(data.extra_hours ?? 0);

    const { error } = await db
      .from("profiles")
      .update({
        active_plan_id: plan.id,
        plan_expires_at: new Date(base + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
        bot_hours_remaining: hours,
      })
      .eq("discord_id", data.discord_id.trim());

    if (error) throw new Error(error.message);
    return { ok: true, bot_hours_remaining: hours, plan_id: plan.id };
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
