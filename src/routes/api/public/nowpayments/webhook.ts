import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Sorted-key JSON serialization required by NOWPayments HMAC verification.
function sortedStringify(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(sortedStringify).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return (
      "{" +
      keys
        .map(
          (k) => JSON.stringify(k) + ":" + sortedStringify((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

export const Route = createFileRoute("/api/public/nowpayments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signature = request.headers.get("x-nowpayments-sig") ?? "";
        const rawBody = await request.text();

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const expected = createHmac("sha512", process.env.NOWPAYMENTS_IPN_SECRET!)
          .update(sortedStringify(payload))
          .digest("hex");
        const sigBuf = Buffer.from(signature, "hex");
        const expBuf = Buffer.from(expected, "hex");
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
          console.warn("[nowpayments] signature mismatch");
          return new Response("Invalid signature", { status: 401 });
        }

        const order_id = String(payload.order_id ?? "");
        const status = String(payload.payment_status ?? "");
        const confirmations = Number(payload.confirmations ?? 0);
        if (!order_id) return new Response("Missing order_id", { status: 400 });

        const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: pmt } = await db
          .from("payments")
          .update({
            status,
            confirmations,
            raw_payload: payload,
          })
          .eq("np_order_id", order_id)
          .select("*")
          .maybeSingle();

        if (!pmt) {
          console.warn("[nowpayments] unknown order_id", order_id);
          return new Response("Unknown order", { status: 404 });
        }

        const paid =
          (status === "confirmed" && confirmations >= (pmt.required_confirmations ?? 2)) ||
          status === "finished";

        if (paid) {
          const { data: plan } = await db
            .from("plans")
            .select("*")
            .eq("id", pmt.plan_id)
            .maybeSingle();
          if (plan) {
            const PLUGIN_META: Record<string, { prefix: string; label: string }> = {
              verification: { prefix: "LX-VB", label: "Verification Bot" },
              "discord-spam": { prefix: "LX-DS", label: "Discord Spam" },
              "discord-autoreply": { prefix: "LX-AR", label: "Discord Auto-Reply" },
            };
            const meta = PLUGIN_META[plan.id];
            if (plan.kind === "plugin" && meta) {
              // Idempotency: check if a key already exists for this payment
              const { data: existingKey } = await db
                .from("verification_keys")
                .select("id, key, expires_at, delivered")
                .eq("source_payment_id", pmt.id)
                .maybeSingle();

              let keyRow = existingKey;
              let key = existingKey?.key;
              let expires = existingKey?.expires_at;

              if (!existingKey) {
                const rand = (n: number) => {
                  const bytes = new Uint8Array(n);
                  crypto.getRandomValues(bytes);
                  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
                    .join("")
                    .toUpperCase();
                };
                key = `${meta.prefix}-${rand(4)}-${rand(4)}-${rand(4)}`;
                expires = new Date(
                  Date.now() + plan.duration_days * 24 * 60 * 60 * 1000,
                ).toISOString();
                const { data: inserted } = await db
                  .from("verification_keys")
                  .insert({
                    discord_id: pmt.discord_id,
                    key,
                    expires_at: expires,
                    source_payment_id: pmt.id,
                    plugin_id: plan.id,
                  })
                  .select("id, key, expires_at, delivered")
                  .single();
                keyRow = inserted;
              }

              // Attempt DM delivery (also retries if previous DM failed)
              if (key && !keyRow?.delivered) {
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
                    const isLifetime = plan.duration_days >= 3650;
                    await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
                      method: "POST",
                      headers: {
                        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        content:
                          `✅ **LuauX ${meta.label} activated**\n\n` +
                          `Your ${isLifetime ? "lifetime" : "monthly"} license key:\n\`\`\`${key}\`\`\`\n` +
                          (isLifetime
                            ? `This key never expires.\n\n`
                            : `Expires: <t:${Math.floor(new Date(expires).getTime() / 1000)}:F>\n\n`) +
                          `Keep this key private. You can view it anytime in your dashboard.`,
                      }),
                    });
                    if (keyRow)
                      await db
                        .from("verification_keys")
                        .update({ delivered: true })
                        .eq("id", keyRow.id);
                  } else {
                    console.warn(`[${plan.id}] DM channel failed for ${pmt.discord_id}`, await dmRes.text());
                  }
                } catch (e) {
                  console.warn(`[${plan.id}] DM failed for ${pmt.discord_id}`, e);
                }
              }
            } else {
              const { data: profile } = await db
                .from("profiles")
                .select("plan_expires_at, bot_hours_remaining")
                .eq("discord_id", pmt.discord_id)
                .maybeSingle();

              const now = Date.now();
              const existingExpiry = profile?.plan_expires_at
                ? new Date(profile.plan_expires_at).getTime()
                : 0;

              const newHours = Number(profile?.bot_hours_remaining ?? 0) + Number(plan.bot_hours);
              const update: Record<string, unknown> = { bot_hours_remaining: newHours };

              const base = Math.max(existingExpiry, now);
              const expiryDays = plan.duration_days || 90;
              update.active_plan_id = plan.id;
              update.plan_expires_at = new Date(
                base + expiryDays * 24 * 60 * 60 * 1000,
              ).toISOString();

              await db.from("profiles").update(update).eq("discord_id", pmt.discord_id);
            }
          }
        }

        return new Response("ok");
      },
    },
  },
});
