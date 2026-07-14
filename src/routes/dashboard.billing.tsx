import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Receipt, ShoppingCart } from "lucide-react";
import { listPayments } from "@/lib/luaux.functions";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DashButton,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  StatusBadge,
  Surface,
} from "@/components/dashboard-ui";

export const Route = createFileRoute("/dashboard/billing")({
  head: () => ({ meta: [{ title: "Billing — LuauX" }] }),
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
  const fetchPayments = useServerFn(listPayments);
  const [items, setItems] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchPayments()
      .then((d) => setItems(d as Payment[]))
      .catch((e) => {
        setItems(null);
        setError(e instanceof Error ? e.message : "Failed to load payments");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPayments]);

  return (
    <PageShell>
      <PageHeader
        title="Billing"
        description="Every crypto payment on your account — invoices, confirms, and status."
        actions={
          <DashButton href="/dashboard/purchase" variant="secondary" size="sm">
            <ShoppingCart className="h-3.5 w-3.5" />
            Buy plan
          </DashButton>
        }
      />

      <Surface className="overflow-hidden">
        {error ? (
          <ErrorState title="Could not load billing" message={error} onRetry={load} />
        ) : loading || !items ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No payments yet"
            description="Purchase a plan or hours pack and your invoices will show up here with live confirmation status."
            action={
              <DashButton href="/dashboard/purchase" size="sm">
                <ShoppingCart className="h-3.5 w-3.5" />
                Browse plans
              </DashButton>
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm hidden md:table">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/40 sticky top-0">
                  <tr>
                    <th className="text-left px-5 py-3.5 font-semibold">Date</th>
                    <th className="text-left px-5 py-3.5 font-semibold">Plan</th>
                    <th className="text-left px-5 py-3.5 font-semibold">Amount</th>
                    <th className="text-left px-5 py-3.5 font-semibold">Currency</th>
                    <th className="text-left px-5 py-3.5 font-semibold">Confirms</th>
                    <th className="text-left px-5 py-3.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {items.map((p) => (
                    <tr
                      key={p.id}
                      className="transition-colors hover:bg-primary/[0.03]"
                    >
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">
                        {new Date(p.created_at).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 capitalize font-medium">{p.plan_id}</td>
                      <td className="px-5 py-3.5 font-mono">${Number(p.price_amount).toFixed(2)}</td>
                      <td className="px-5 py-3.5 uppercase font-mono text-xs text-muted-foreground">
                        {p.pay_currency}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs">
                        {p.confirmations}/{p.required_confirmations}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-border/50">
              {items.map((p) => (
                <div key={p.id} className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString()}
                    </span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="capitalize text-sm font-medium">{p.plan_id}</span>
                    <span className="font-mono text-sm">${Number(p.price_amount).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="uppercase font-mono">{p.pay_currency}</span>
                    <span className="font-mono">
                      {p.confirmations}/{p.required_confirmations} confirms
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Surface>
    </PageShell>
  );
}
