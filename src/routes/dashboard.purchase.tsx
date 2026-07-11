import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Clock, ShoppingCart, Package, Timer, Sparkles } from "lucide-react";
import { getPlans, createInvoice, getPayment, getMyProfile } from "@/lib/luaux.functions";
import { useSettings } from "@/lib/settings-context";

export const Route = createFileRoute("/dashboard/purchase")({
  component: PurchasePage,
});

type Plan = {
  id: string;
  name: string;
  price_usd: number;
  max_bots: number;
  bot_hours: number;
  duration_days: number;
  features: string[];
  kind?: string;
};

const CURRENCIES = [
  { code: "ltc", label: "Litecoin (LTC)" },
  { code: "sol", label: "Solana (SOL)" },
  { code: "usdttrc20", label: "USDT (TRC20)" },
  { code: "usdcsol", label: "USDC (Solana)" },
];

function PurchasePage() {
  const fetchPlans = useServerFn(getPlans);
  const invoice = useServerFn(createInvoice);
  const getPay = useServerFn(getPayment);
  const fetchProfile = useServerFn(getMyProfile);
  const s = useSettings();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState("ltc");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botHours, setBotHours] = useState<number>(0);
  const [selectedHours, setSelectedHours] = useState<number>(1);
  const [payment, setPayment] = useState<{
    id: string;
    pay_address: string;
    pay_amount: number;
    pay_currency: string;
    status: string;
    confirmations: number;
    required_confirmations: number;
  } | null>(null);

  useEffect(() => {
    fetchPlans().then((d) => setPlans(d as Plan[]));
    fetchProfile().then((d) => {
      const p = (d as { profile?: { bot_hours_remaining?: number } })?.profile;
      setBotHours(Number(p?.bot_hours_remaining ?? 0));
    });
  }, [fetchPlans, fetchProfile]);

  // Poll payment status
  useEffect(() => {
    if (!payment) return;
    const t = setInterval(async () => {
      try {
        const p = (await getPay({ data: { id: payment.id } })) as typeof payment;
        setPayment(p);
        if (p.status === "finished" || p.status === "confirmed") clearInterval(t);
      } catch {
        /* ignore polling errors */
      }
    }, 8000);
    return () => clearInterval(t);
  }, [payment, getPay]);

  const start = async (planId: string) => {
    setSelectedPlan(planId);
    setError(null);
    setCreating(true);
    try {
      const p = (await invoice({
        data: { plan_id: planId, pay_currency: selectedCurrency },
      })) as typeof payment;
      setPayment(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invoice");
    } finally {
      setCreating(false);
    }
  };

  if (payment) return <PaymentView payment={payment} onBack={() => setPayment(null)} />;

  const HOUR_OPTIONS = [1, 2, 5, 10, 24];
  const hourPlanId = `hours_${selectedHours}`;
  const hourTotal = selectedHours * 1.5;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-4xl font-semibold tracking-tight">{s.t("choose_plan")}</h1>
        <p className="mt-2 text-muted-foreground">{s.t("choose_plan_sub")}</p>
      </header>

      <div className="rounded-2xl brutal-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Bot hours
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-4xl font-semibold">{botHours.toFixed(1)}</span>
              <span className="text-sm text-muted-foreground">hours available</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Included with your plan</p>
          </div>
          <p className="text-sm text-muted-foreground max-w-sm">
            Buy hours below or redeem a bot-hours key from Settings.
          </p>
        </div>

        <div className="mt-6 rounded-xl brutal-border bg-background/60 p-5">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg font-semibold">Purchase bot hours</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.formatPrice(1.5)}/hr — extra runtime on top of your plan. No subscription needed.
          </p>

          <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Hours to purchase
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {HOUR_OPTIONS.map((h) => (
                  <button
                    key={h}
                    onClick={() => setSelectedHours(h)}
                    className={`rounded-full brutal-border px-4 py-2 text-xs font-semibold ${
                      selectedHours === h
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/40 hover:bg-secondary"
                    }`}
                  >
                    {h}h — {s.formatPrice(h * 1.5)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {s.formatPrice(1.5)} per hour · Max 24h · Expires at midnight UTC
              </p>
            </div>
            <div className="rounded-xl brutal-border bg-card p-4 min-w-[180px]">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Total
              </div>
              <div className="mt-1 font-display text-3xl font-semibold">
                {s.formatPrice(hourTotal)}
              </div>
            </div>
          </div>

          <button
            disabled={creating}
            onClick={() => start(hourPlanId)}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl brutal-border bg-primary text-primary-foreground hover:bg-primary/90 px-5 py-3 text-sm font-semibold disabled:opacity-50"
          >
            <ShoppingCart className="h-4 w-4" />
            {creating && selectedPlan === hourPlanId
              ? "Creating…"
              : `Buy ${selectedHours} ${selectedHours === 1 ? "hour" : "hours"} — ${s.formatPrice(hourTotal)}`}
          </button>
        </div>
      </div>

      <div className="rounded-2xl brutal-border bg-card p-5">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
          Pay with
        </div>
        <div className="flex flex-wrap gap-2">
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              onClick={() => setSelectedCurrency(c.code)}
              className={`rounded-full brutal-border px-4 py-2 text-xs font-semibold ${
                selectedCurrency === c.code
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/40 hover:bg-secondary"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        {plans
          .filter((p) => (p.kind ?? "plan") === "plan")
          .map((plan) => {
            const isPro = plan.id === "pro";
            const hoursPerDay = Math.round(plan.bot_hours / Math.max(plan.duration_days, 1));
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl brutal-border bg-card p-7 flex flex-col ${
                  isPro ? "ring-2 ring-primary/50" : ""
                }`}
              >
                {isPro && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-widest px-3 py-1 flex items-center gap-1 brutal-border">
                    <Sparkles className="h-3 w-3" /> {s.t("most_popular")}
                  </div>
                )}
                {plan.id === "enterprise" && (
                  <div className="absolute top-4 right-4 rounded-md bg-secondary/60 text-foreground/80 text-[9px] font-semibold uppercase tracking-widest px-2 py-1">
                    {s.t("best_value")}
                  </div>
                )}

                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {plan.name}
                </div>
                <p className="mt-2 text-sm text-muted-foreground min-h-[2.5rem]">
                  {plan.id === "starter" && "Ideal for small-scale operations and getting started."}
                  {plan.id === "pro" && "For power users running multiple bots simultaneously."}
                  {plan.id === "enterprise" &&
                    "Maximum throughput, dedicated resources and custom setups."}
                </p>

                <div className="mt-5 flex items-baseline gap-1">
                  <span className="font-display text-5xl font-semibold">
                    {s.formatPrice(Number(plan.price_usd))}
                  </span>
                  <span className="text-sm text-muted-foreground">{s.t("per_month")}</span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-0 rounded-xl brutal-border overflow-hidden">
                  <div className="flex flex-col items-center justify-center py-4 bg-secondary/20 border-r border-border/60">
                    <Package className="h-4 w-4 text-muted-foreground mb-1" />
                    <div className="font-display text-xl font-semibold">{plan.max_bots}</div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Bots
                    </div>
                  </div>
                  <div className="flex flex-col items-center justify-center py-4 bg-secondary/20">
                    <Timer className="h-4 w-4 text-muted-foreground mb-1" />
                    <div className="font-display text-xl font-semibold">{hoursPerDay}h / day</div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Bot-hours
                    </div>
                  </div>
                </div>

                <ul className="mt-5 space-y-2 text-sm flex-1">
                  {plan.features?.map((f) => (
                    <FeatureRow key={f}>{f}</FeatureRow>
                  ))}
                </ul>

                <button
                  disabled={creating}
                  onClick={() => start(plan.id)}
                  className={`mt-6 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50 brutal-border ${
                    isPro
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-background hover:bg-secondary/40"
                  }`}
                >
                  {creating && selectedPlan === plan.id ? "Creating…" : s.t("get_started")}
                </button>
              </div>
            );
          })}
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}

function FeatureRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
      <span>{children}</span>
    </li>
  );
}

function PaymentView({
  payment,
  onBack,
}: {
  payment: {
    id: string;
    pay_address: string;
    pay_amount: number;
    pay_currency: string;
    status: string;
    confirmations: number;
    required_confirmations: number;
  };
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const done = payment.status === "finished" || payment.status === "confirmed";
  const copy = () => {
    navigator.clipboard.writeText(payment.pay_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6 max-w-xl">
      <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground">
        ← Back to plans
      </button>
      <div className="rounded-2xl brutal-border bg-card p-8 space-y-5">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-primary">Awaiting payment</div>
          <h2 className="mt-2 font-display text-3xl font-semibold">
            Send {payment.pay_amount} <span className="uppercase">{payment.pay_currency}</span>
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            To the address below. Access unlocks automatically after{" "}
            {payment.required_confirmations} confirmations.
          </p>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Pay to address
          </div>
          <div className="flex gap-2">
            <code className="flex-1 rounded-lg bg-background brutal-border px-3 py-2 text-xs font-mono break-all">
              {payment.pay_address}
            </code>
            <button
              onClick={copy}
              className="rounded-lg brutal-border bg-secondary/40 hover:bg-secondary px-3 py-2 text-xs font-semibold"
            >
              {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-border/60">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Status
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm">
              {done ? (
                <>
                  <Check className="h-4 w-4 text-primary" />
                  <span className="text-primary font-semibold">Paid</span>
                </>
              ) : (
                <>
                  <Clock className="h-4 w-4 animate-pulse text-primary" />
                  <span className="capitalize">{payment.status}</span>
                </>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Confirmations
            </div>
            <div className="mt-1 font-mono">
              {payment.confirmations} / {payment.required_confirmations}
            </div>
          </div>
        </div>

        {done && (
          <div className="rounded-lg bg-primary/10 brutal-border px-4 py-3 text-sm text-primary">
            Plan activated. Head to{" "}
            <a href="/dashboard/bots" className="underline">
              Bots
            </a>{" "}
            to deploy.
          </div>
        )}
      </div>
    </div>
  );
}
