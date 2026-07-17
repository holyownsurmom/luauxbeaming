import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ShoppingCart, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { createInvoice, getPayment } from "@/lib/luaux.functions";
import {
  clearCart,
  getCart,
  getCartTotalUsd,
  removeFromCart,
  subscribeCart,
  type CartItem,
} from "@/lib/cart";
import { CompletePurchaseModal } from "@/components/complete-purchase-modal";

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
  const [paymentLabel, setPaymentLabel] = useState("");
  const [checkingPay, setCheckingPay] = useState(false);

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

  const paymentId = payment?.id;
  useEffect(() => {
    if (!paymentId) return;
    const t = setInterval(async () => {
      try {
        const p = (await getPay({ data: { id: paymentId } })) as Payment;
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
  }, [paymentId, getPay, payingPlanId]);

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
      setPaymentLabel(`${item.name} — $${Number(item.priceUsd).toFixed(2)}`);
      setPayment(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setCreating(false);
    }
  };

  const refreshPayment = async () => {
    if (!payment?.id) return;
    setCheckingPay(true);
    try {
      const p = (await getPay({ data: { id: payment.id } })) as Payment;
      setPayment(p);
      if (p.fulfilled_at || p.status === "finished") {
        toast.success("Payment confirmed");
        if (payingPlanId) removeFromCart(payingPlanId);
        setPayingPlanId(null);
      } else {
        toast.message("Not confirmed yet — keep this open");
      }
    } catch {
      toast.error("Could not refresh payment");
    } finally {
      setCheckingPay(false);
    }
  };

  return (
    <>
      {payment && (
        <CompletePurchaseModal
          open
          payment={payment}
          productLabel={paymentLabel}
          checking={checkingPay}
          onClose={() => {
            setPayment(null);
            setPayingPlanId(null);
            setPaymentLabel("");
          }}
          onChangeMethod={() => {
            setPayment(null);
            setPayingPlanId(null);
            setPaymentLabel("");
          }}
          onCancel={() => {
            if (window.confirm("Cancel this invoice?")) {
              setPayment(null);
              setPayingPlanId(null);
              setPaymentLabel("");
            }
          }}
          onCheckNow={refreshPayment}
        />
      )}
      {open && (
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
          {items.length === 0 ? (
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
      )}
    </>
  );
}
