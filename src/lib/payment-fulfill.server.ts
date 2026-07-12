/** Shared payment fulfillment + Discord purchase webhook (server-only). */

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
  const url = process.env.PAYMENT_DISCORD_WEBHOOK_URL || process.env.DISCORD_PAYMENT_WEBHOOK;
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

export async function fulfillPayment(
  db: Db,
  paymentId: string,
  opts?: { txid?: string; confirmations?: number; raw?: Record<string, unknown> },
): Promise<{ ok: true; already?: boolean }> {
  const { data: pmt } = await db.from("payments").select("*").eq("id", paymentId).maybeSingle();
  if (!pmt) throw new Error("Payment not found");
  if (pmt.fulfilled_at) return { ok: true, already: true };

  // Reject txid already used on another payment
  if (opts?.txid) {
    const { data: used } = await db
      .from("payments")
      .select("id")
      .eq("np_payment_id", `tx_${opts.txid}`)
      .maybeSingle();
    if (used && used.id !== pmt.id) throw new Error("TXID already used");
  }

  const update: Record<string, unknown> = {
    status: "finished",
    confirmations: opts?.confirmations ?? 1,
    fulfilled_at: new Date().toISOString(),
  };
  if (opts?.txid) {
    update.np_payment_id = `tx_${opts.txid}`;
    update.raw_payload = {
      ...(typeof pmt.raw_payload === "object" && pmt.raw_payload ? pmt.raw_payload : {}),
      ...(opts.raw || {}),
      txid: opts.txid,
      confirmed_at: new Date().toISOString(),
    };
  }

  // Load plan BEFORE claiming so we never mark paid without a grant target
  const { data: plan } = await db.from("plans").select("*").eq("id", pmt.plan_id).maybeSingle();
  if (!plan) throw new Error("Plan missing");

  const { data: claimed, error: claimErr } = await db
    .from("payments")
    .update(update)
    .eq("id", pmt.id)
    .is("fulfilled_at", null)
    .in("status", ["waiting", "confirming", "confirmed", "sending", "partially_paid"])
    .select("id")
    .maybeSingle();
  if (claimErr) {
    // Unique violation on txid / np_payment_id
    if (String(claimErr.message || "").toLowerCase().includes("unique") || claimErr.code === "23505") {
      throw new Error("TXID already used");
    }
    throw new Error(claimErr.message);
  }
  if (!claimed) return { ok: true, already: true };

  const grantPluginIds = PLUGIN_GRANTS[plan.id] ?? [];
  const productLabels: string[] = [];

  if (plan.kind === "plugin" && grantPluginIds.length > 0) {
    const expires = new Date(
      Date.now() + plan.duration_days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const isLifetime = plan.duration_days >= 3650;
    const issued: { label: string; key: string; id: string }[] = [];

    for (const pluginId of grantPluginIds) {
      const meta = PLUGIN_META[pluginId];
      if (!meta) continue;
      productLabels.push(meta.label);
      const { data: existing } = await db
        .from("verification_keys")
        .select("id, key, delivered")
        .eq("source_payment_id", pmt.id)
        .eq("plugin_id", pluginId)
        .maybeSingle();
      if (existing) {
        issued.push({ label: meta.label, key: existing.key, id: existing.id });
        continue;
      }
      const key = `${meta.prefix}-${randHex(4)}-${randHex(4)}-${randHex(4)}`;
      const { data: inserted } = await db
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
      if (inserted) issued.push({ label: meta.label, key: inserted.key, id: inserted.id });
    }

    if (issued.length > 0) {
      try {
        const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
          method: "POST",
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ recipient_id: pmt.discord_id }),
        });
        if (dmRes.ok) {
          const dm = (await dmRes.json()) as { id: string };
          const title =
            plan.id === "discord-bundle"
              ? "Discord Bundle"
              : PLUGIN_META[grantPluginIds[0]]?.label ?? plan.name;
          const keyLines = issued.map((k) => `**${k.label}**\n\`\`\`${k.key}\`\`\``).join("\n");
          await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content:
                `✅ **LuauX ${title} activated**\n\n` +
                `${keyLines}\n` +
                (isLifetime
                  ? `These keys never expire.\n\n`
                  : `Expires: <t:${Math.floor(new Date(expires).getTime() / 1000)}:F>\n\n`) +
                (opts?.txid ? `TX: \`${opts.txid}\`\n\n` : "") +
                `Keep keys private. You can view them anytime in your dashboard.`,
            }),
          });
          for (const k of issued) {
            await db.from("verification_keys").update({ delivered: true }).eq("id", k.id);
          }
        }
      } catch (e) {
        console.warn("[fulfillPayment] DM failed", e);
      }
    }
  } else {
    productLabels.push(plan.name);
    const { data: profile } = await db
      .from("profiles")
      .select("plan_expires_at, bot_hours_remaining")
      .eq("discord_id", pmt.discord_id)
      .maybeSingle();
    const now = Date.now();
    const existingExpiry = profile?.plan_expires_at
      ? new Date(profile.plan_expires_at).getTime()
      : 0;
    const base = Math.max(existingExpiry, now);
    const expiryDays = plan.duration_days || 90;
    const { error: profileErr } = await db
      .from("profiles")
      .update({
        bot_hours_remaining: Number(profile?.bot_hours_remaining ?? 0) + Number(plan.bot_hours),
        active_plan_id: plan.id,
        plan_expires_at: new Date(base + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("discord_id", pmt.discord_id);
    if (profileErr) {
      console.error("[fulfillPayment] profile grant failed", profileErr.message);
      // Keep payment finished (money received) but surface for ops
      throw new Error(`Profile grant failed: ${profileErr.message}`);
    }
  }

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
    products: productLabels,
  });

  return { ok: true, already: false };
}
