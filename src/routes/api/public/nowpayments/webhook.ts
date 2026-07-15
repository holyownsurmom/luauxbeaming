import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { fulfillPayment } from "@/lib/payment-fulfill.server";
import { envStr } from "@/lib/luaux-server.server";

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

        const secret = envStr("NOWPAYMENTS_IPN_SECRET");
        if (!secret) {
          console.error("[nowpayments] NOWPAYMENTS_IPN_SECRET missing");
          return new Response("Server misconfigured", { status: 500 });
        }

        const expected = createHmac("sha512", secret)
          .update(sortedStringify(payload))
          .digest("hex");
        const sigBuf = Buffer.from(signature, "hex");
        const expBuf = Buffer.from(expected, "hex");
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
          console.warn("[nowpayments] signature mismatch");
          return new Response("Invalid signature", { status: 401 });
        }

        const order_id = String(payload.order_id ?? "");
        const status = String(payload.payment_status ?? payload.status ?? "").toLowerCase();
        // NP sometimes nests network confirmations under different keys
        const confirmations = Number(
          payload.confirmations ??
            payload.network_confirmations ??
            (payload.payment as Record<string, unknown> | undefined)?.confirmations ??
            0,
        );
        const paymentIdNp = payload.payment_id != null ? String(payload.payment_id) : null;
        if (!order_id) return new Response("Missing order_id", { status: 400 });

        const db = createClient(envStr("SUPABASE_URL"), envStr("SUPABASE_SERVICE_ROLE_KEY"), {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        // Prefer match by our order_id; fall back to NP payment_id for older rows
        let pmtQuery = db
          .from("payments")
          .update({
            status: status || "waiting",
            confirmations: Number.isFinite(confirmations) ? confirmations : 0,
            raw_payload: payload,
            ...(paymentIdNp ? { np_payment_id: paymentIdNp } : {}),
          })
          .eq("np_order_id", order_id)
          .select("*")
          .maybeSingle();

        let { data: pmt, error: updErr } = await pmtQuery;

        if (!updErr && !pmt && paymentIdNp) {
          const fallback = await db
            .from("payments")
            .update({
              status: status || "waiting",
              confirmations: Number.isFinite(confirmations) ? confirmations : 0,
              raw_payload: payload,
              np_payment_id: paymentIdNp,
            })
            .eq("np_payment_id", paymentIdNp)
            .select("*")
            .maybeSingle();
          pmt = fallback.data;
          updErr = fallback.error;
        }

        if (updErr) {
          console.error("[nowpayments] update error:", updErr.message);
          return new Response("DB error", { status: 500 });
        }
        if (!pmt) {
          console.warn(
            "[nowpayments] unknown order_id",
            order_id,
            "payment_id",
            paymentIdNp,
            "status",
            status,
          );
          // 200 so NP does not retry forever for dashboard payment-links we never created
          return new Response("Unknown order", { status: 200 });
        }

        console.log(
          `[nowpayments] ipn ok order=${order_id} status=${status} conf=${confirmations} payment=${pmt.id}`,
        );

        const required = Number(pmt.required_confirmations ?? 1);
        // NP statuses: waiting | confirming | confirmed | sending | partially_paid | finished | failed | expired | refunded
        const isPaid =
          status === "finished" ||
          status === "confirmed" ||
          status === "sending" ||
          (status === "confirming" && confirmations >= required);

        if (!isPaid) {
          return new Response("ok");
        }

        // Always call fulfillPayment (idempotent) so missed grants can repair via ledger
        try {
          await fulfillPayment(db, pmt.id, {
            confirmations:
              (Number.isFinite(confirmations) && confirmations > 0
                ? confirmations
                : Number(pmt.confirmations)) || required || 1,
            raw: payload,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[nowpayments] fulfill failed:", msg, "payment", pmt.id);
          // 500 so NOWPayments retries IPN
          return new Response(`Fulfill failed: ${msg}`, { status: 500 });
        }

        return new Response("ok");
      },
    },
  },
});
