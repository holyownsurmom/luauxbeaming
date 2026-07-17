import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  ExternalLink,
  QrCode,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type PurchasePayment = {
  id: string;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  status: string;
  confirmations: number;
  required_confirmations: number;
  fulfilled_at?: string | null;
  price_amount?: number | null;
  plan_name?: string | null;
};

type Props = {
  open: boolean;
  payment: PurchasePayment;
  /** e.g. "1 bot hour — $1.50" */
  productLabel?: string;
  onClose: () => void;
  onChangeMethod?: () => void;
  onCancel?: () => void;
  onCheckNow?: () => void | Promise<void>;
  checking?: boolean;
  /** modal centered overlay (default) vs embedded card */
  variant?: "modal" | "embedded";
};

function explorerUrl(currency: string, address: string): string | null {
  const c = currency.toLowerCase();
  if (c === "ltc") return `https://blockchair.com/litecoin/address/${address}`;
  if (c === "sol") return `https://solscan.io/account/${address}`;
  if (c === "btc") return `https://blockchair.com/bitcoin/address/${address}`;
  if (c === "eth") return `https://etherscan.io/address/${address}`;
  return null;
}

function currencySymbol(currency: string): string {
  const c = currency.toLowerCase();
  if (c === "btc") return "₿";
  if (c === "ltc") return "Ł";
  if (c === "sol") return "◎";
  if (c === "eth") return "Ξ";
  return currency.slice(0, 1).toUpperCase();
}

function statusLabel(payment: PurchasePayment, done: boolean, confirming: boolean): {
  text: string;
  tone: "await" | "ok" | "warn";
} {
  if (done) return { text: "Paid", tone: "ok" };
  if (confirming) return { text: "Confirming", tone: "warn" };
  const s = (payment.status || "").toLowerCase();
  if (s === "waiting" || s === "pending" || s === "created" || !s) {
    return { text: "Awaiting", tone: "await" };
  }
  return { text: payment.status, tone: "await" };
}

export function CompletePurchaseModal({
  open,
  payment,
  productLabel,
  onClose,
  onChangeMethod,
  onCancel,
  onCheckNow,
  checking,
  variant = "modal",
}: Props) {
  const [copiedField, setCopiedField] = useState<"amount" | "address" | null>(null);
  const [showQr, setShowQr] = useState(false);

  const done = !!payment.fulfilled_at || payment.status === "finished";
  const confirming =
    !done &&
    (payment.status === "confirmed" ||
      payment.status === "confirming" ||
      payment.status === "sending");
  const status = statusLabel(payment, done, confirming);
  const cur = (payment.pay_currency || "").toUpperCase();
  const amountStr = String(payment.pay_amount);
  const explorer = explorerUrl(payment.pay_currency, payment.pay_address);

  const qrSrc = useMemo(() => {
    const data = encodeURIComponent(payment.pay_address);
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${data}`;
  }, [payment.pay_address]);

  const subtitle =
    productLabel ||
    (payment.plan_name
      ? `${payment.plan_name}${payment.price_amount != null ? ` — $${Number(payment.price_amount).toFixed(2)}` : ""}`
      : `${cur} payment`);

  useEffect(() => {
    if (!open || variant !== "modal") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, variant]);

  const copy = async (text: string, field: "amount" | "address") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1400);
    } catch {
      /* ignore */
    }
  };

  if (!open) return null;

  const body = (
    <div
      className={cn(
        "w-full rounded-2xl border border-border/70 bg-card text-card-foreground",
        "bg-[oklch(0.11_0.012_25)] dark:bg-[oklch(0.11_0.012_25)]",
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0">
          <h2
            id="complete-purchase-title"
            className="font-display text-xl font-bold tracking-tight"
          >
            Complete Purchase
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground truncate">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground flex items-center justify-center shrink-0"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="h-px bg-border/50 mx-5" />

      {/* Change method */}
      {onChangeMethod && !done && (
        <button
          type="button"
          onClick={onChangeMethod}
          className="mx-5 mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Change method
        </button>
      )}

      <div className="px-5 py-4 space-y-4">
        {/* Method row */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-black/25 px-3.5 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="h-8 w-8 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 text-sm font-bold shrink-0">
              {currencySymbol(payment.pay_currency)}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{cur} Payment</div>
              <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
            </div>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-semibold shrink-0",
              status.tone === "ok" && "text-emerald-400",
              status.tone === "warn" && "text-amber-400",
              status.tone === "await" && "text-amber-400",
            )}
          >
            {status.tone === "ok" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Clock className="h-3.5 w-3.5 animate-pulse" />
            )}
            {status.text}
          </span>
        </div>

        {/* Amount */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
            Send exactly
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-black/30 px-3.5 py-2.5">
            <code className="flex-1 font-mono text-sm font-semibold tabular-nums break-all">
              {amountStr}{" "}
              <span className="text-muted-foreground font-normal uppercase">{cur}</span>
            </code>
            <button
              type="button"
              onClick={() => void copy(`${amountStr}`, "amount")}
              className="h-8 w-8 rounded-lg border border-border/40 hover:bg-white/5 flex items-center justify-center shrink-0"
              aria-label="Copy amount"
            >
              {copiedField === "amount" ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* Address */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
            To address
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-black/30 px-3.5 py-2.5">
            <code className="flex-1 font-mono text-[11px] sm:text-xs break-all leading-relaxed">
              {payment.pay_address}
            </code>
            <button
              type="button"
              onClick={() => void copy(payment.pay_address, "address")}
              className="h-8 w-8 rounded-lg border border-border/40 hover:bg-white/5 flex items-center justify-center shrink-0"
              aria-label="Copy address"
            >
              {copiedField === "address" ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* QR toggle */}
        {!done && (
          <button
            type="button"
            onClick={() => setShowQr((v) => !v)}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-black/40 hover:bg-black/55 py-3 text-sm font-semibold transition-colors"
          >
            <QrCode className="h-4 w-4" />
            {showQr ? "Hide QR Code" : "Show QR Code"}
          </button>
        )}

        {showQr && !done && (
          <div className="flex justify-center rounded-xl border border-border/40 bg-white p-4">
            <img src={qrSrc} alt="Payment QR code" width={180} height={180} className="rounded-md" />
          </div>
        )}

        {/* Warning */}
        {!done && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-3 text-[12px] leading-relaxed text-amber-200/95">
            Send the <strong>exact amount</strong> shown. Keep this open until the payment confirms —
            your access unlocks automatically once the transaction is seen on-chain.
          </div>
        )}

        {done && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-300 font-semibold flex items-center gap-2">
            <Check className="h-4 w-4" />
            Payment confirmed — access unlocked
          </div>
        )}

        {!done && (
          <div className="text-[11px] text-muted-foreground text-center tabular-nums">
            Confirmations {payment.confirmations}/{payment.required_confirmations || "?"}
          </div>
        )}

        {/* I've paid */}
        {!done && onCheckNow && (
          <button
            type="button"
            disabled={checking}
            onClick={() => void onCheckNow()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-white/5 hover:bg-white/10 py-3 text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("h-4 w-4", checking && "animate-spin")} />
            {checking ? "Checking…" : "I've paid — check now"}
          </button>
        )}

        {/* Explorer */}
        {explorer && (
          <a
            href={explorer}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Track on blockchain explorer
          </a>
        )}

        {/* Cancel */}
        {!done && onCancel && (
          <div className="pt-1 pb-1">
            <button
              type="button"
              onClick={onCancel}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full border border-destructive/40 text-destructive hover:bg-destructive/10 py-2.5 text-sm font-semibold transition-colors"
            >
              <X className="h-4 w-4" />
              Cancel invoice
            </button>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              Only possible while payment has not been sent yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  if (variant === "embedded") {
    return body;
  }

  // Portal to body so dashboard overflow/transform never clips or mis-positions the modal
  const overlay = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="complete-purchase-title"
    >
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md mx-auto max-h-[min(92vh,760px)] overflow-y-auto rounded-2xl shadow-2xl">
        {body}
      </div>
    </div>
  );

  if (typeof document === "undefined") return overlay;
  return createPortal(overlay, document.body);
}
