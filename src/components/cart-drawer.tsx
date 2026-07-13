import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Check, Copy, Clock, ShoppingCart, Trash2, X } from "lucide-react";
import { createInvoice, getPayment } from "@/lib/luaux.functions";
import {
  clearCart,
  getCart,
  getCartTotalUsd,
  removeFromCart,
  subscribeCart,
  type CartItem,
} from "@/lib/cart";

const CURRENCIES = [
  { code: "ltc" as const, label: "LTC" },
  { code: "sol" as const, label: "SOL" },
];

type Payment = {
  id: string;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  status: string;
  confirmations: number;
  required_confirmations: number;
  fulfilled_at?: string | null;
};

export function CartButton({ onOpen }: { onOpen: () => void }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sync = () => setCount(getCart().length);
    sync();
    return subscribeCart(sync);
  }, []);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative h-10 w-10 rounded-xl bg-card/90 backdrop-blur-sm border border-border/60 flex items-center justify-center shadow-lg hover:bg-card transition-colors md:h-9 md:w-9 md:shadow-none"
      aria-label="Open cart"
    >
      <ShoppingCart className="h-4 w-4 text-foreground/70" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center px-1">
          {count}
        </span>
      )}
    </button>
  );
}

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const invoice = useServerFn(createInvoice);
  const getPay = useServerFn(getPayment);
  const [items, setItems] = useState<CartItem[]>([]);
  const [currency, setCurrency] = useState<"ltc" | "sol">("ltc");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [payingPlanId, setPayingPlanId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sync = () => setItems(getCart());
    sync();
    return subscribeCart(sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!payment) return;
    const t = setInterval(async () => {
      try {
        const p = (await getPay({ data: { id: payment.id } })) as Payment;
        setPayment(p);
        if (p.fulfilled_at || p.status === "finished") {
          clearInterval(t);
          if (payingPlanId) removeFromCart(payingPlanId);
          setPayingPlanId(null);
        }
      } catch {
        /* ignore */
      }
    }, 8000);
    return () => clearInterval(t);
  }, [payment, getPay, payingPlanId]);

  if (!open) return null;

  const total = getCartTotalUsd();
  const done =
    payment && (!!payment.fulfilled_at || payment.status === "finished");

  const startPay = async (item: CartItem) => {
    setError(null);
    setCreating(true);
    setPayment(null);
    try {
      const p = (await invoice({
        data: { plan_id: item.planId, pay_currency: currency },
      })) as Payment;
      if (p.pay_currency === "admin" && p.status === "finished") {
        removeFromCart(item.planId);
        setPayment(null);
        setPayingPlanId(null);
        return;
      }
      setPayingPlanId(item.planId);
      setPayment(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex justify-end">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/60">
          <div>
            <div className="font-display text-lg font-semibold">Cart</div>
            <div className="text-xs text-muted-foreground">
              {items.length === 0 ? "Empty" : `${items.length} item${items.length === 1 ? "" : "s"}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-xl border border-border/60 flex items-center justify-center hover:bg-secondary/50"
            aria-label="Close cart"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {payment ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setPayment(null);
                  setPayingPlanId(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back to cart
              </button>
              <div className="rounded-2xl border border-border/70 bg-background/40 p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-widest text-primary">
                  {done ? "Paid" : "Send payment"}
                </div>
                <div className="font-display text-2xl font-semibold">
                  {payment.pay_amount}{" "}
                  <span className="uppercase text-base">{payment.pay_currency}</span>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                    Address
                  </div>
                  <div className="flex gap-2">
                    <code className="flex-1 rounded-xl border border-border/70 bg-background px-3 py-2 text-[11px] font-mono break-all">
                      {payment.pay_address}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(payment.pay_address);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1200);
                      }}
                      className="rounded-xl border border-border/70 px-3 hover:bg-secondary/40"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {done ? (
                    <>
                      <Check className="h-4 w-4 text-primary" />
                      <span className="text-primary font-semibold">Confirmed — item removed</span>
                    </>
                  ) : (
                    <>
                      <Clock className="h-4 w-4 animate-pulse text-primary" />
                      <span className="capitalize">{payment.status}</span>
                      <span className="text-muted-foreground text-xs">
                        · {payment.confirmations}/{payment.required_confirmations}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 px-4 py-14 text-center">
              <ShoppingCart className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">Your cart is empty</p>
              <Link
                to="/dashboard/purchase"
                onClick={onClose}
                className="inline-block mt-4 text-xs font-semibold text-primary hover:underline"
              >
                Browse plans
              </Link>
            </div>
          ) : (
            <>
              {items.map((item) => (
                <div
                  key={item.planId}
                  className="rounded-2xl border border-border/70 bg-background/30 p-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{item.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      {item.planId}
                    </div>
                    <div className="mt-2 font-display text-lg font-semibold">
                      ${Number(item.priceUsd).toFixed(2)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.planId)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={creating}
                      onClick={() => void startPay(item)}
                      className="rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                    >
                      {creating ? "…" : "Pay"}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        {!payment && items.length > 0 && (
          <div className="border-t border-border/60 px-5 py-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="font-display text-xl font-semibold">${total.toFixed(2)}</span>
            </div>
            <div className="flex gap-2">
              {CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setCurrency(c.code)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold ${
                    currency === c.code
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/70 bg-background/40 hover:bg-secondary/40"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={creating || !items[0]}
              onClick={() => items[0] && void startPay(items[0])}
              className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold disabled:opacity-50"
            >
              {creating ? "Creating invoice…" : `Checkout first item · ${currency.toUpperCase()}`}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Clear cart?")) clearCart();
              }}
              className="w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Clear cart
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
