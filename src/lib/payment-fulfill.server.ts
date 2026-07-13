/** Shared payment fulfillment + Discord purchase webhook (server-only). */

import { envStr } from "./luaux-server.server";
import { grantMcPlanAccess, isPluginPlanId } from "./plan-grant.server";

type Db = {
  from: (table: string) => any;
};

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

function randHex(n: number) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export async function sendPurchaseWebhook(payload: {
  discord_id: string;
  plan_id: string;
  plan_name: string;
  price_usd: number;
  pay_currency: string;
  pay_amount: number;
  pay_address: string;
  txid?: string | null;
  payment_id: string;
  products: string[];
}) {
  const url = envStr("PAYMENT_DISCORD_WEBHOOK_URL") || envStr("DISCORD_PAYMENT_WEBHOOK");
  if (!url) return;

  const cur = String(payload.pay_currency || "").toUpperCase();
  const explorer =
    cur === "LTC" && payload.txid
      ? `https://blockchair.com/litecoin/transaction/${payload.txid}`
      : cur === "SOL" && payload.txid
        ? `https://solscan.io/tx/${payload.txid}`
        : null;

  const lines = [
    `**Plan:** ${payload.plan_name} (\`${payload.plan_id}\`)`,
    `**Products:** ${payload.products.join(", ") || payload.plan_name}`,
    `**Price:** $${Number(payload.price_usd).toFixed(2)} USD`,
    `**Paid:** ${payload.pay_amount} ${cur}`,
    `**Address:** \`${payload.pay_address}\``,
    payload.txid ? `**TXID:** \`${payload.txid}\`` : "**TXID:** (admin / no chain tx)",
    explorer ? `**Explorer:** ${explorer}` : null,
    `**Buyer Discord:** <@${payload.discord_id}> (\`${payload.discord_id}\`)`,
    `**Payment ID:** \`${payload.payment_id}\``,
  ].filter(Boolean);

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: null,
        embeds: [
          {
            title: "💰 New LuauX purchase",
            description: lines.join("\n"),
            color: 0x57f287,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (e) {
    console.warn("[payment-webhook] failed", e);
  }
}

async function issuePluginKeys(
  db: Db,
  pmt: { id: string; discord_id: string },
  plan: { id: string; name: string; duration_days: number },
  grantPluginIds: string[],
): Promise<{ label: string; key: string; id: string; delivered?: boolean }[]> {
  const expires = new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();
  const issued: { label: string; key: string; id: string; delivered?: boolean }[] = [];

  for (const pluginId of grantPluginIds) {
    const meta = PLUGIN_META[pluginId];
    if (!meta) continue;

    const { data: existing } = await db
      .from("verification_keys")
      .select("id, key, delivered")
      .eq("source_payment_id", pmt.id)
      .eq("plugin_id", pluginId)
      .maybeSingle();
    if (existing) {
      issued.push({
        label: meta.label,
        key: existing.key,
        id: existing.id,
        delivered: !!existing.delivered,
      });
      continue;
    }

    const key = `${meta.prefix}-${randHex(4)}-${randHex(4)}-${randHex(4)}`;
    const { data: inserted, error: keyErr } = await db
      .from("verification_keys")
      .insert({
        discord_id: pmt.discord_id,
        key,
        expires_at: expires,
        source_payment_id: pmt.id,
        plugin_id: pluginId,
        delivered: false,
      })
      .select("id, key")
      .single();

    if (keyErr) {
      const { data: raced } = await db
        .from("verification_keys")
        .select("id, key")
        .eq("source_payment_id", pmt.id)
        .eq("plugin_id", pluginId)
        .maybeSingle();
      if (raced) {
        issued.push({ label: meta.label, key: raced.key, id: raced.id });
        continue;
      }
      throw new Error(`Key grant failed: ${keyErr.message}`);
    }
    if (inserted) issued.push({ label: meta.label, key: inserted.key, id: inserted.id });
  }

  return issued;
}

async function dmPluginKeys(
  pmt: { discord_id: string },
  plan: { id: string; name: string; duration_days: number },
  grantPluginIds: string[],
  issued: { label: string; key: string; id: string; delivered?: boolean }[],
  db: Db,
  opts?: { txid?: string },
) {
  // Only DM keys not yet marked delivered (avoids IPN retry spam)
  const undelivered = issued.filter((k) => !k.delivered);
  if (undelivered.length === 0) return;
  const botToken = envStr("DISCORD_BOT_TOKEN");
  if (!botToken) return;

  const isLifetime = plan.duration_days >= 3650;
  const expiresMs = Date.now() + plan.duration_days * 24 * 60 * 60 * 1000;

  try {
    const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient_id: pmt.discord_id }),
    });
    if (!dmRes.ok) return;
    const dm = (await dmRes.json()) as { id: string };
    const title =
      plan.id === "discord-bundle"
        ? "Discord Bundle"
        : PLUGIN_META[grantPluginIds[0]]?.label ?? plan.name;
    const keyLines = undelivered.map((k) => `**${k.label}**\n\`\`\`${k.key}\`\`\``).join("\n");
    await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content:
          `✅ **LuauX ${title} activated**\n\n` +
          `${keyLines}\n` +
          (isLifetime
            ? `These keys never expire.\n\n`
            : `Expires: <t:${Math.floor(expiresMs / 1000)}:F>\n\n`) +
          (opts?.txid ? `TX: \`${opts.txid}\`\n\n` : "") +
          `Keep keys private. You can view them anytime in your dashboard.`,
      }),
    });
    for (const k of undelivered) {
      await db.from("verification_keys").update({ delivered: true }).eq("id", k.id);
    }
  } catch (e) {
    console.warn("[fulfillPayment] DM failed", e);
  }
}

async function claimPayment(
  db: Db,
  pmt: { id: string; raw_payload?: unknown; np_payment_id?: string | null },
  opts?: { txid?: string; confirmations?: number; raw?: Record<string, unknown> },
): Promise<boolean> {
  const update: Record<string, unknown> = {
    status: "finished",
    confirmations: opts?.confirmations ?? 1,
    fulfilled_at: new Date().toISOString(),
  };
  // Never overwrite an existing NP payment id with tx_ ledger after fulfill
  if (opts?.txid && !String(pmt.np_payment_id || "").startsWith("tx_")) {
    // Store chain tx in raw_payload only; keep np_payment_id as NP id when present
    update.raw_payload = {
      ...(typeof pmt.raw_payload === "object" && pmt.raw_payload ? pmt.raw_payload : {}),
      ...(opts.raw || {}),
      txid: opts.txid,
      confirmed_at: new Date().toISOString(),
    };
    if (!pmt.np_payment_id || String(pmt.np_payment_id).startsWith("manual_")) {
      update.np_payment_id = `tx_${opts.txid}`;
    }
  } else if (opts?.raw) {
    update.raw_payload = {
      ...(typeof pmt.raw_payload === "object" && pmt.raw_payload ? pmt.raw_payload : {}),
      ...opts.raw,
    };
  }

  const { data: claimed, error: claimErr } = await db
    .from("payments")
    .update(update)
    .eq("id", pmt.id)
    .is("fulfilled_at", null)
    .in("status", [
      "waiting",
      "confirming",
      "confirmed",
      "sending",
      "partially_paid",
      "finished",
    ])
    .select("id")
    .maybeSingle();

  if (claimErr) {
    if (
      String(claimErr.message || "")
        .toLowerCase()
        .includes("unique") ||
      claimErr.code === "23505"
    ) {
      throw new Error("TXID already used");
    }
    throw new Error(claimErr.message);
  }
  return !!claimed;
}

/**
 * Record that this payment already applied profile/key grants.
 * Returns true if THIS caller won the grant (should apply grant).
 * Returns false if another caller already granted (skip re-grant).
 */
async function tryBeginGrant(
  db: Db,
  pmt: { id: string; discord_id: string; plan_id: string; granted_at?: string | null },
  hoursAdded: number,
): Promise<boolean> {
  // 1) Preferred: payment_grants ledger (unique payment_id)
  const { error: ledgerErr } = await db.from("payment_grants").insert({
    payment_id: pmt.id,
    discord_id: pmt.discord_id,
    plan_id: pmt.plan_id,
    hours_added: hoursAdded,
  });
  if (!ledgerErr) {
    // Best-effort stamp granted_at
    await db
      .from("payments")
      .update({ granted_at: new Date().toISOString() })
      .eq("id", pmt.id)
      .is("granted_at", null);
    return true;
  }
  if (ledgerErr.code === "23505") return false; // already granted

  // 2) Fallback when ledger table missing: use granted_at column
  if (pmt.granted_at) return false;
  const { data: stamped, error: stampErr } = await db
    .from("payments")
    .update({ granted_at: new Date().toISOString() })
    .eq("id", pmt.id)
    .is("granted_at", null)
    .select("id")
    .maybeSingle();
  if (!stampErr && stamped) return true;
  if (stampErr && String(stampErr.message || "").toLowerCase().includes("granted_at")) {
    // Column missing — last resort: allow grant once if not fulfilled yet (caller still claims)
    return true;
  }
  return false;
}

async function hasGrantRecord(db: Db, paymentId: string): Promise<boolean> {
  const { data: ledger } = await db
    .from("payment_grants")
    .select("payment_id")
    .eq("payment_id", paymentId)
    .maybeSingle();
  if (ledger) return true;
  const { data: pmt } = await db
    .from("payments")
    .select("granted_at")
    .eq("id", paymentId)
    .maybeSingle();
  return !!pmt?.granted_at;
}

export async function fulfillPayment(
  db: Db,
  paymentId: string,
  opts?: { txid?: string; confirmations?: number; raw?: Record<string, unknown> },
): Promise<{ ok: true; already?: boolean }> {
  const { data: pmt } = await db.from("payments").select("*").eq("id", paymentId).maybeSingle();
  if (!pmt) throw new Error("Payment not found");

  if (opts?.txid) {
    const { data: used } = await db
      .from("payments")
      .select("id")
      .eq("np_payment_id", `tx_${opts.txid}`)
      .maybeSingle();
    if (used && used.id !== pmt.id) throw new Error("TXID already used");
  }

  const { data: plan } = await db.from("plans").select("*").eq("id", pmt.plan_id).maybeSingle();
  if (!plan) throw new Error("Plan missing");

  // Detect plugins by kind OR known plan ids (mis-tagged kind still grants keys)
  let grantPluginIds = PLUGIN_GRANTS[plan.id] ?? [];
  if (grantPluginIds.length === 0 && (plan.kind === "plugin" || isPluginPlanId(plan.id))) {
    // single-plugin fallback by id
    if (PLUGIN_META[plan.id]) grantPluginIds = [plan.id];
  }
  const isPlugin =
    grantPluginIds.length > 0 && (plan.kind === "plugin" || isPluginPlanId(plan.id));

  // Plugins: keys are idempotent via (source_payment_id, plugin_id) unique.
  // Issue keys first so IPN retries always deliver even if claim already happened.
  if (isPlugin) {
    const issued = await issuePluginKeys(db, pmt, plan, grantPluginIds);
    const productLabels = issued.map((i) => i.label);

    if (!pmt.fulfilled_at) {
      const won = await claimPayment(db, pmt, opts);
      if (won) {
        await dmPluginKeys(pmt, plan, grantPluginIds, issued, db, opts);
        await sendPurchaseWebhook({
          discord_id: pmt.discord_id,
          plan_id: plan.id,
          plan_name: plan.name,
          price_usd: Number(pmt.price_amount),
          pay_currency: pmt.pay_currency,
          pay_amount: Number(pmt.pay_amount),
          pay_address: pmt.pay_address || "",
          txid: opts?.txid || null,
          payment_id: pmt.id,
          products: productLabels.length ? productLabels : [plan.name],
        });
        return { ok: true, already: false };
      }
    }

    // Already fulfilled or lost race — still ensure DM of existing keys
    await dmPluginKeys(pmt, plan, grantPluginIds, issued, db, opts);
    return { ok: true, already: true };
  }

  // MC / hour plans: ledger-first grant (never double hours), then claim payment.
  const hoursToAdd = Number(plan.bot_hours ?? 0);

  if (pmt.fulfilled_at) {
    // Repair ONLY if we never recorded a grant for this payment (not if user spent hours)
    const granted = await hasGrantRecord(db, pmt.id);
    if (!granted) {
      const wonGrant = await tryBeginGrant(db, pmt, hoursToAdd);
      if (wonGrant) {
        console.warn(
          "[fulfillPayment] repairing missed MC grant for payment",
          pmt.id,
          "user",
          pmt.discord_id,
        );
        await grantMcPlanAccess(db, pmt.discord_id, plan);
        return { ok: true, already: false };
      }
    }
    return { ok: true, already: true };
  }

  // Fresh payment: claim grant slot first (unique payment_id), then apply hours
  const wonGrant = await tryBeginGrant(db, pmt, hoursToAdd);
  if (wonGrant) {
    await grantMcPlanAccess(db, pmt.discord_id, plan);
  }

  const won = await claimPayment(db, pmt, opts);
  if (!won) {
    return { ok: true, already: true };
  }

  if (wonGrant) {
    await sendPurchaseWebhook({
      discord_id: pmt.discord_id,
      plan_id: plan.id,
      plan_name: plan.name,
      price_usd: Number(pmt.price_amount),
      pay_currency: pmt.pay_currency,
      pay_amount: Number(pmt.pay_amount),
      pay_address: pmt.pay_address || "",
      txid: opts?.txid || null,
      payment_id: pmt.id,
      products: [plan.name],
    });
  }

  return { ok: true, already: !wonGrant };
}
