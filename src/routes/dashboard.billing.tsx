import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Receipt } from "lucide-react";
import { listPayments } from "@/lib/luaux.functions";

export const Route = createFileRoute("/dashboard/billing")({
  component: BillingPage,
});

type Payment = {
  id: string;
  plan_id: string;
  pay_currency: string;
  price_amount: number;
  pay_amount: number | null;
  status: string;
  confirmations: number;
  required_confirmations: number;
  created_at: string;
};

function BillingPage() {
  const fetch = useServerFn(listPayments);
  const [items, setItems] = useState<Payment[] | null>(null);

  useEffect(() => {
    fetch().then((d) => setItems(d as Payment[]));
  }, [fetch]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-2 text-muted-foreground">Every crypto payment on your account.</p>
      </header>

      <div className="rounded-2xl brutal-border bg-card overflow-hidden">
        {!items ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center">
            <Receipt className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No payments yet.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/30">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3">Amount</th>
                <th className="text-left px-4 py-3">Currency</th>
                <th className="text-left px-4 py-3">Confirms</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {items.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-mono text-xs">
                    {new Date(p.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 capitalize">{p.plan_id}</td>
                  <td className="px-4 py-3 font-mono">${Number(p.price_amount).toFixed(2)}</td>
                  <td className="px-4 py-3 uppercase font-mono text-xs">{p.pay_currency}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {p.confirmations}/{p.required_confirmations}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const finished = status === "finished" || status === "confirmed";
  const failed = status === "failed" || status === "expired" || status === "refunded";
  const cls = finished
    ? "bg-primary/15 text-primary"
    : failed
      ? "bg-destructive/15 text-destructive"
      : "bg-secondary/60 text-muted-foreground";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}
    >
      {status}
    </span>
  );
}
