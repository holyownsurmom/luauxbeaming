import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { fulfillPayment } from "@/lib/payment-fulfill.server";

function authWorker(request: Request): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;
  const token = request.headers.get("x-worker-secret") || "";
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const Route = createFileRoute("/api/bots/worker/payments-confirm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authWorker(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: {
          payment_id?: string;
          txid?: string;
          confirmations?: number;
          raw?: Record<string, unknown>;
        };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (!body.payment_id || !body.txid) {
          return Response.json({ error: "payment_id and txid required" }, { status: 400 });
        }

        try {
          const result = await fulfillPayment(db(), body.payment_id, {
            txid: body.txid,
            confirmations: body.confirmations ?? 1,
            raw: body.raw,
          });
          return Response.json(result);
        } catch (e) {
          console.error("[payments-confirm]", e);
          return Response.json(
            { error: e instanceof Error ? e.message : "Fulfill failed" },
            { status: 400 },
          );
        }
      },
    },
  },
});
