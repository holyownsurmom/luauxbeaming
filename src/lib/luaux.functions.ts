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
  const sessionData = await getSessionData();
  const isAdmin = sessionData.isAdmin === true;
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
    .select("id,label,auth_type,username,uuid,status,created_at")
    .eq("discord_id", user.id)
    .order("created_at", { ascending: false });
  return data ?? [];
});

export const getMcAccountSsid = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ accountId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const { data: row } = await admin()
      .from("mc_accounts")
      .select("ssid,username,uuid")
      .eq("id", data.accountId)
      .eq("discord_id", user.id)
      .maybeSingle();
    return row;
  });

export const addMcAccount = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        label: z.string().min(1).max(60),
        auth_type: z.enum(["microsoft", "ssid", "offline"]),
        username: z.string().max(60).optional().nullable(),
        uuid: z.string().max(60).optional().nullable(),
        ssid: z.string().max(2000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireUser, admin } = await import("./luaux-server.server");
    const user = await requireUser();
    const { data: row, error } = await admin()
      .from("mc_accounts")
      .insert({
        discord_id: user.id,
        label: data.label,
        auth_type: data.auth_type,
        username: data.username ?? null,
        uuid: data.uuid ?? null,
        ssid: data.ssid ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
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

const SUPPORTED_CURRENCIES = ["ltc", "sol", "usdttrc20", "usdcsol"] as const;

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

    // Admin bypass: instantly activate without NOWPayments
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

      const planUpdate: Record<string, unknown> = {
        active_plan_id: plan.id,
        plan_expires_at: new Date(base + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
        bot_hours_remaining: Number(profile?.bot_hours_remaining ?? 0) + Number(plan.bot_hours),
      };
      await db.from("profiles").update(planUpdate).eq("discord_id", user.id);

      // For plugin plans, generate a key instantly
      const PLUGIN_META: Record<string, { prefix: string; label: string }> = {
        verification: { prefix: "LX-VB", label: "Verification Bot" },
        "discord-spam": { prefix: "LX-DS", label: "Discord Spam" },
        "discord-autoreply": { prefix: "LX-AR", label: "Discord Auto-Reply" },
      };
      const meta = PLUGIN_META[plan.id];
      if (plan.kind === "plugin" && meta && row) {
        const rand = (n: number) => {
          const bytes = new Uint8Array(n);
          crypto.getRandomValues(bytes);
          return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase();
        };
        const key = `${meta.prefix}-${rand(4)}-${rand(4)}-${rand(4)}`;
        const expires = new Date(now + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();
        await db.from("verification_keys").insert({
          discord_id: user.id,
          key,
          expires_at: expires,
          source_payment_id: row.id,
          plugin_id: plan.id,
          delivered: true, // Admin gets it in dashboard, no DM needed
        });
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

    const npRes = await fetch("https://api.nowpayments.io/v1/payment", {
      method: "POST",
      headers: {
        "x-api-key": process.env.NOWPAYMENTS_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        price_amount: Number(plan.price_usd),
        price_currency: "usd",
        pay_currency: data.pay_currency,
        order_id,
        order_description: `LuauX ${plan.name} plan`,
        ipn_callback_url:
          process.env.IPN_CALLBACK_URL ||
          "https://luauxbeaming.lovable.app/api/public/nowpayments/webhook",
      }),
    });
    if (!npRes.ok) {
      const t = await npRes.text();
      console.error("[nowpayments] create failed", npRes.status, t);
      throw new Error("Payment provider error");
    }
    const np = (await npRes.json()) as {
      payment_id: string | number;
      pay_address: string;
      pay_amount: number;
      pay_currency: string;
      price_amount: number;
    };

    const { data: row, error } = await db
      .from("payments")
      .insert({
        discord_id: user.id,
        plan_id: plan.id,
        np_payment_id: String(np.payment_id),
        np_order_id: order_id,
        pay_currency: np.pay_currency,
        pay_amount: np.pay_amount,
        pay_address: np.pay_address,
        price_amount: np.price_amount,
        required_confirmations: 2,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return {
      id: row.id,
      pay_address: np.pay_address,
      pay_amount: np.pay_amount,
      pay_currency: np.pay_currency,
      price_amount: np.price_amount,
      status: "waiting" as string,
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
    const { requireUser, admin } = await import("./luaux-server.server");
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

    const { getSessionData } = await import("./luaux-server.server");
    const sessionData = await getSessionData();
    const isAdmin = sessionData.isAdmin === true;

    if (!activeKey && !isAdmin) {
      throw new Error("No active Verification Bot license");
    }

    const { error } = await db.from("verification_settings").upsert({
      discord_id: user.id,
      guild_id: data.guild_id,
      verified_role_id: data.verified_role_id,
      channel_id: data.channel_id,
      message_title: data.message_title,
      message_description: data.message_description,
      button_text: data.button_text,
    });

    if (error) throw new Error(error.message);

    try {
      const channelRes = await fetch(
        `https://discord.com/api/v10/channels/${data.channel_id}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
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
        console.error("[discord bot] failed to send verification msg:", channelRes.status, text);
        throw new Error(`Settings saved, but failed to post message: ${text}`);
      }
    } catch (e) {
      console.error("[verification] failed to send message:", e);
      throw new Error(
        `Settings saved, but failed to post verification message. Make sure the bot is in your server and has permission to send messages in that channel.`,
      );
    }

    return { ok: true };
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
    const { admin } = await import("./luaux-server.server");
    const db = admin();

    const { error } = await db
      .from("verification_keys")
      .update({ expires_at: new Date().toISOString() })
      .eq("id", data.key_id);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
