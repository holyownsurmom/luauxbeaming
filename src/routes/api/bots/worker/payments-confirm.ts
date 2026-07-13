import { createFileRoute } from "@tanstack/react-router";
import { fulfillPayment } from "@/lib/payment-fulfill.server";
import { authWorker, workerDb } from "@/lib/worker-auth.server";

const db = workerDb;

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
