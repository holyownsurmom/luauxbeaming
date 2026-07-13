import { createFileRoute } from "@tanstack/react-router";
import { authWorker, workerDb } from "@/lib/worker-auth.server";

const db = workerDb;

export const Route = createFileRoute("/api/bots/worker/payments-pending")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authWorker(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const client = db();
        // Only invoices created in the last 45 minutes are matchable
        const since = new Date(Date.now() - 45 * 60_000).toISOString();
        // Best-effort expire older waiting rows
        await client
          .from("payments")
          .update({ status: "expired" })
          .eq("status", "waiting")
          .lt("created_at", since);

        // Chain-watch only fixed-wallet invoices (manual_*). NOWPayments uses IPN webhooks.
        const { data, error } = await client
          .from("payments")
          .select(
            "id, discord_id, plan_id, pay_currency, pay_amount, pay_address, price_amount, status, created_at, np_payment_id",
          )
          .eq("status", "waiting")
          .in("pay_currency", ["ltc", "sol"])
          .like("np_payment_id", "manual_%")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(40);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ payments: data ?? [] });
      },
    },
  },
});
