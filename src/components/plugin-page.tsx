import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, Clock, Bitcoin, KeyRound, ArrowLeft, ShoppingCart } from "lucide-react";
import { getPluginKeys, createInvoice, getPayment } from "@/lib/luaux.functions";
import { RedeemKeyForm } from "@/components/redeem-key-form";
import { addToCart, isInCart, subscribeCart } from "@/lib/cart";

type KeyRow = {
  id: string;
  key: string;
  expires_at: string;
  created_at: string;
  delivered: boolean;
  plugin_id?: string;
};

type Payment = {
  id: string;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  status: string;
  confirmations: number;
  required_confirmations: number;
};

const CURRENCIES = [
  { code: "ltc", label: "Litecoin (LTC)" },
  { code: "sol", label: "Solana (SOL)" },
];

export function PluginPage({
  pluginId,
  planId,
  title,
  tagline,
  cardTitle,
  cardDescription,
  icon: Icon,
  features,
  price = 20,
  priceNote = "One-time lifetime purchase",
  showBundleOffer,
}: {
  pluginId: string;
  /** Invoice plan id (defaults to pluginId). Use discord-bundle for bundle. */
  planId?: string;
  title: string;
  tagline: string;
  cardTitle: string;
  cardDescription: string;
  icon: React.ComponentType<{ className?: string }>;
  features: string[];
  price?: number;
  priceNote?: string;
  showBundleOffer?: boolean;
}) {
  const fetchKeys = useServerFn(getPluginKeys);
  const invoice = useServerFn(createInvoice);
  const getPay = useServerFn(getPayment);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [currency, setCurrency] = useState("ltc");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [adminActivated, setAdminActivated] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(planId || pluginId);
  const [selectedPrice, setSelectedPrice] = useState(price);
  const [cartTick, setCartTick] = useState(0);

  useEffect(() => {
    setSelectedPlan(planId || pluginId);
    setSelectedPrice(price);
  }, [planId, pluginId, price]);

  useEffect(() => subscribeCart(() => setCartTick((t) => t + 1)), []);

  useEffect(() => {
    fetchKeys({ data: { plugin_id: pluginId } })
      .then((d) => setKeys(d as KeyRow[]))
      .finally(() => setLoading(false));
  }, [fetchKeys, pluginId]);

  useEffect(() => {
    if (!payment) return;
    const t = setInterval(async () => {
      try {
        const p = (await getPay({ data: { id: payment.id } })) as Payment;
        setPayment(p);
        if (p.status === "finished" || p.status === "confirmed") {
          clearInterval(t);
          fetchKeys({ data: { plugin_id: pluginId } }).then((d) => setKeys(d as KeyRow[]));
        }
      } catch {
        /* ignore polling errors */
      }
    }, 8000);
    return () => clearInterval(t);
  }, [payment, getPay, fetchKeys, pluginId]);

  const startCheckout = async () => {
    setError(null);
    setCreating(true);
    try {
      const p = (await invoice({
        data: {
          plan_id: selectedPlan,
          pay_currency: currency as "ltc" | "sol",
        },
      })) as Payment;
      if (p.pay_currency === "admin" && p.status === "finished") {
        setAdminActivated(true);
        fetchKeys({ data: { plugin_id: pluginId } }).then((d) => setKeys(d as KeyRow[]));
        return;
      }
      setPayment(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invoice");
    } finally {
      setCreating(false);
    }
  };

  const activeKey = keys.find((k) => new Date(k.expires_at).getTime() > Date.now());
  const isLifetimeKey =
    !!activeKey &&
    new Date(activeKey.expires_at).getTime() - Date.now() > 3000 * 24 * 60 * 60 * 1000;

  const copy = async (v: string) => {
    await navigator.clipboard.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(null), 1500);
  };

  if (payment) {
    const done = payment.status === "finished" || payment.status === "confirmed";
    return (
      <div className="space-y-6 max-w-xl mx-auto">
        <button
          onClick={() => setPayment(null)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="rounded-2xl brutal-border bg-card p-8 space-y-5">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-primary">
              Awaiting payment
            </div>
            <h2 className="mt-2 font-display text-3xl font-semibold">
              Send {payment.pay_amount} <span className="uppercase">{payment.pay_currency}</span>
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Send the exact amount to the address below. Payment is detected automatically on-chain
              (usually within 1–2 minutes). Your key unlocks here and is DM&apos;d.
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
                onClick={() => copy(payment.pay_address)}
                className="rounded-lg brutal-border bg-secondary/40 hover:bg-secondary px-3 py-2 text-xs font-semibold"
              >
                {copied === payment.pay_address ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
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
                Network
              </div>
              <div className="mt-1 font-mono uppercase">{payment.pay_currency}</div>
            </div>
          </div>
          {done && (
            <div className="rounded-lg bg-primary/10 brutal-border px-4 py-3 text-sm text-primary">
              Payment confirmed. Your license key is ready.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-5xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-muted-foreground">{tagline}</p>
      </header>

      {adminActivated && (
        <div className="rounded-2xl bg-primary/10 brutal-border p-6 animate-fade-in-scale flex items-start gap-4 max-w-xl mx-auto">
          <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
            <Check className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="font-semibold text-sm text-primary">License activated instantly</div>
            <p className="text-xs text-muted-foreground mt-1">
              Admin mode — payment bypassed. Your key is active and ready to use.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-center">
        <div className="w-full max-w-xl rounded-2xl brutal-border bg-card p-7 space-y-6">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 shrink-0 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center">
              <Icon className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-2xl font-semibold">{cardTitle}</div>
              <p className="mt-1 text-sm text-muted-foreground">{cardDescription}</p>
            </div>
          </div>

          {showBundleOffer && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedPlan(pluginId);
                  setSelectedPrice(20);
                }}
                className={`rounded-xl brutal-border p-4 text-left transition-colors ${
                  selectedPlan === pluginId
                    ? "bg-primary/15 ring-1 ring-primary/40"
                    : "bg-background/60 hover:bg-secondary/30"
                }`}
              >
                <div className="font-display text-2xl font-semibold">$20</div>
                <div className="text-xs text-muted-foreground mt-0.5">This plugin only</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedPlan("discord-bundle");
                  setSelectedPrice(30);
                }}
                className={`rounded-xl brutal-border p-4 text-left transition-colors ${
                  selectedPlan === "discord-bundle"
                    ? "bg-primary/15 ring-1 ring-primary/40"
                    : "bg-background/60 hover:bg-secondary/30"
                }`}
              >
                <div className="font-display text-2xl font-semibold">$30</div>
                <div className="text-xs text-muted-foreground mt-0.5">Spam + Auto-Reply bundle</div>
              </button>
            </div>
          )}

          <div className="rounded-xl brutal-border bg-background/60 p-5 flex items-center justify-between gap-4">
            <div>
              <div className="font-display text-4xl font-semibold">${selectedPrice.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {selectedPlan === "discord-bundle"
                  ? "Lifetime — both Discord plugins"
                  : priceNote}
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full brutal-border bg-primary/15 text-primary px-3 py-1.5 text-xs font-semibold">
              <Bitcoin className="h-3.5 w-3.5" /> LTC / SOL only
            </div>
          </div>

          <ul className="space-y-2 text-sm">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-xl brutal-border bg-background/50 p-4">
            <RedeemKeyForm
              expectedPlugin={pluginId}
              onSuccess={() => window.location.reload()}
              compact
            />
          </div>

          {loading ? (
            <div className="rounded-xl brutal-border bg-background/60 px-4 py-3 text-sm text-muted-foreground">
              Checking your license…
            </div>
          ) : activeKey ? (
            <div className="rounded-xl brutal-border bg-primary/10 p-4 space-y-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-primary">
                <Check className="h-3.5 w-3.5" />{" "}
                {isLifetimeKey ? "Lifetime license active" : "License active"}
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-background/70 brutal-border px-3 py-2 font-mono text-sm break-all">
                  {activeKey.key}
                </code>
                <button
                  onClick={() => copy(activeKey.key)}
                  className="rounded-lg brutal-border bg-secondary/40 hover:bg-secondary px-3 py-2 text-xs font-semibold"
                >
                  {copied === activeKey.key ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {isLifetimeKey
                  ? "Never expires"
                  : `Expires ${new Date(activeKey.expires_at).toLocaleDateString()}`}
              </div>
            </div>
          ) : checkout ? (
            <div className="space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Pay with
                </div>
                <div className="flex flex-wrap gap-2">
                  {CURRENCIES.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => setCurrency(c.code)}
                      className={`rounded-full brutal-border px-3 py-1.5 text-xs font-semibold ${
                        currency === c.code
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary/40 hover:bg-secondary"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                disabled={creating}
                onClick={startCheckout}
                className="w-full rounded-xl brutal-border bg-primary text-primary-foreground hover:bg-primary/90 py-3 text-sm font-semibold disabled:opacity-50"
              >
                {creating ? "Creating invoice…" : `Pay $${selectedPrice.toFixed(2)} with crypto`}
              </button>
              {error && <div className="text-xs text-destructive">{error}</div>}
              <button
                onClick={() => setCheckout(false)}
                className="w-full text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  const r = addToCart({
                    planId: selectedPlan,
                    name: title,
                    priceUsd: selectedPrice,
                    kind: "plugin",
                  });
                  if (!r.ok) toast.message(r.reason || "Already in cart");
                  else toast.success("Added to cart");
                  setCartTick((t) => t + 1);
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl brutal-border bg-secondary/50 hover:bg-secondary py-4 text-sm font-semibold"
              >
                <ShoppingCart className="h-4 w-4" />
                {isInCart(selectedPlan) && cartTick >= 0 ? "In cart" : "Cart"}
              </button>
              <button
                onClick={() => setCheckout(true)}
                className="rounded-xl brutal-border bg-primary text-primary-foreground hover:bg-primary/90 text-center py-4 text-sm font-semibold"
              >
                Buy ${selectedPrice.toFixed(2)}
              </button>
            </div>
          )}

          <div className="rounded-xl brutal-border bg-background/40 px-4 py-3 flex items-center gap-2 text-[12px] text-muted-foreground">
            <KeyRound className="h-3.5 w-3.5 text-primary" />
            We only accept LTC and SOL. Keys unlock after payment is confirmed.
          </div>
        </div>
      </div>
    </div>
  );
}
