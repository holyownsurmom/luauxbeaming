import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Zap,
  Play,
  Square,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  KeyRound,
  ShoppingCart,
  ChevronDown,
  ChevronUp,
  Settings,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { getPluginKeys, createInvoice, getPayment, getMyProfile } from "@/lib/luaux.functions";
import { BotConsole, type ConsoleEntry } from "@/components/bot-console";

export const Route = createFileRoute("/dashboard/discord-spam")({
  head: () => ({ meta: [{ title: "Discord Auto-Spam — LuauX" }] }),
  component: DiscordSpamPage,
});

type KeyRow = {
  id: string;
  key: string;
  expires_at: string;
  created_at: string;
  delivered: boolean;
};

type DiscordBotStatus = {
  id: string;
  status: string;
  label: string;
  error: string | null;
  startedAt: number | null;
  config: Record<string, unknown>;
  logCount: number;
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

function DiscordSpamPage() {
  const fetchKeys = useServerFn(getPluginKeys);
  const invoice = useServerFn(createInvoice);
  const getPay = useServerFn(getPayment);
  const fetchProfile = useServerFn(getMyProfile);

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const [checkout, setCheckout] = useState(false);
  const [currency, setCurrency] = useState("ltc");
  const [creating, setCreating] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [spamPlanId, setSpamPlanId] = useState<"discord-spam" | "discord-bundle">("discord-spam");
  const spamPrice = spamPlanId === "discord-bundle" ? 30 : 20;

  const [runningBots, setRunningBots] = useState<DiscordBotStatus[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const [token, setToken] = useState("");
  const [channelId, setChannelId] = useState("");
  const [messages, setMessages] = useState("");
  // SAFETY: Discord user-token automation is against ToS.
  // We default to 5 minutes (300s) minimum. Do not lower this.
  const [interval, setInterval_] = useState("300");
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [humanize, setHumanize] = useState(true);
  const [minDelay, setMinDelay] = useState("300");
  const [maxDelay, setMaxDelay] = useState("420");
  const [launching, setLaunching] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showConfig, setShowConfig] = useState(true);

  useEffect(() => {
    Promise.all([fetchKeys({ data: { plugin_id: "discord-spam" } }), fetchProfile()])
      .then(([k, p]) => {
        setKeys(k as KeyRow[]);
        setIsAdmin((p as { isAdmin?: boolean }).isAdmin ?? false);
      })
      .finally(() => setLoading(false));
  }, [fetchKeys, fetchProfile]);

  useEffect(() => {
    if (!payment) return;
    const t = setInterval(async () => {
      try {
        const p = (await getPay({ data: { id: payment.id } })) as Payment;
        setPayment(p);
        if (p.status === "finished" || p.status === "confirmed") {
          clearInterval(t);
          fetchKeys({ data: { plugin_id: "discord-spam" } }).then((d) => setKeys(d as KeyRow[]));
        }
      } catch {
        /* ignore polling errors */
      }
    }, 8000);
    return () => clearInterval(t);
  }, [payment, getPay, fetchKeys]);

  const activeKey = isAdmin
    ? { key: "ADMIN", expires_at: "2099-12-31", created_at: "" }
    : keys.find((k) => new Date(k.expires_at).getTime() > Date.now());

  const refreshBots = useCallback(async () => {
    try {
      const res = await fetch("/api/bots/discord/status");
      const data = await res.json();
      if (data.bots) setRunningBots(data.bots);
    } catch {
      /* ignore status errors */
    }
  }, []);

  useEffect(() => {
    refreshBots();
    const interval = setInterval(refreshBots, 5000);
    return () => clearInterval(interval);
  }, [refreshBots]);

  useEffect(() => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = new EventSource("/api/bots/stream");
    eventSourceRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "log" && data.botId === selectedBotId) {
          setConsoleEntries((prev) => [
            ...prev.slice(-499),
            { ts: data.ts, level: data.level, msg: data.msg },
          ]);
        }
      } catch {
        /* ignore parse errors */
      }
    };
    return () => es.close();
  }, [selectedBotId]);

  const startCheckout = async () => {
    setPayError(null);
    setCreating(true);
    try {
      const p = (await invoice({
        data: {
          plan_id: spamPlanId,
          pay_currency: currency as "ltc" | "sol",
        },
      })) as Payment;
      if (p.pay_currency === "admin" && p.status === "finished") {
        fetchKeys({ data: { plugin_id: "discord-spam" } }).then((d) => setKeys(d as KeyRow[]));
        return;
      }
      setPayment(p);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Failed to create invoice");
    } finally {
      setCreating(false);
    }
  };

  const copy = async (v: string) => {
    await navigator.clipboard.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(null), 1500);
  };

  const launchBot = async () => {
    if (!token.trim()) return setError("Bot token required");
    if (!channelId.trim()) return setError("Channel ID required");
    const msgs = messages
      .split("\n")
      .map((m) => m.trim())
      .filter(Boolean);
    if (msgs.length === 0) return setError("At least one message required");

    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/bots/discord/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          guildId: "",
          channelId: channelId.trim(),
          messages: msgs,
          interval: parseInt(interval, 10) || 5,
          deleteAfterSend: deleteAfter,
          humanize,
          minDelay: parseFloat(minDelay) || 3,
          maxDelay: parseFloat(maxDelay) || 8,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      setSelectedBotId(data.botId);
      setConsoleEntries([]);
      await refreshBots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  const stopBot = async (botId: string) => {
    setStoppingId(botId);
    try {
      const res = await fetch("/api/bots/discord/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("Stop failed:", data.error || res.status);
      }
      if (selectedBotId === botId) setSelectedBotId(null);
      await refreshBots();
    } finally {
      setStoppingId(null);
    }
  };

  const stopAndClearAll = async () => {
    setStoppingId("all");
    try {
      const res = await fetch("/api/bots/clear-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "discord" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Clear all failed");
      setConsoleEntries([]);
      setSelectedBotId(null);
      setRunningBots([]);
      toast.success("All spam bots stopped & removed");
      await refreshBots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear all failed");
    } finally {
      setStoppingId(null);
    }
  };

  // Checkout flow (shown if no key or user clicks purchase)
  if (payment) {
    const done = payment.status === "finished" || payment.status === "confirmed";
    return (
      <div className="space-y-6 max-w-xl mx-auto">
        <button
          onClick={() => setPayment(null)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Back
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
              To the address below. Access unlocks after {payment.required_confirmations}{" "}
              confirmations.
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
                    <RefreshCw className="h-4 w-4 animate-spin text-primary" />
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
              Payment confirmed. Your license key has been generated and DM'd to you by the LuauX
              bot.
            </div>
          )}
        </div>
      </div>
    );
  }

  // No license key -- show purchase
  if (!activeKey) {
    return (
      <div className="space-y-10">
        <header className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center">
            <Zap className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h1 className="font-display text-4xl font-semibold tracking-tight">
              Discord Auto-Spam
            </h1>
            <p className="mt-1 text-muted-foreground">
              Multi-token channel spammer with rotation and a live console.
            </p>
          </div>
        </header>

        <div className="flex justify-center">
          <div className="w-full max-w-xl rounded-2xl brutal-border bg-card p-7 space-y-6">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 shrink-0 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center">
                <Zap className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-2xl font-semibold">Discord Spam</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Automated channel spamming with multi-token rotation.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSpamPlanId("discord-spam")}
                className={`rounded-xl brutal-border p-4 text-left transition-colors ${
                  spamPlanId === "discord-spam"
                    ? "bg-primary/15 ring-1 ring-primary/40"
                    : "bg-background/60 hover:bg-secondary/30"
                }`}
              >
                <div className="font-display text-2xl font-semibold">$20</div>
                <div className="text-xs text-muted-foreground mt-0.5">Spam only · lifetime</div>
              </button>
              <button
                type="button"
                onClick={() => setSpamPlanId("discord-bundle")}
                className={`rounded-xl brutal-border p-4 text-left transition-colors ${
                  spamPlanId === "discord-bundle"
                    ? "bg-primary/15 ring-1 ring-primary/40"
                    : "bg-background/60 hover:bg-secondary/30"
                }`}
              >
                <div className="font-display text-2xl font-semibold">$30</div>
                <div className="text-xs text-muted-foreground mt-0.5">Spam + Auto-Reply</div>
              </button>
            </div>

            <div className="rounded-xl brutal-border bg-background/60 p-5 flex items-center justify-between gap-4">
              <div>
                <div className="font-display text-4xl font-semibold">${spamPrice}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {spamPlanId === "discord-bundle"
                    ? "Lifetime — both Discord plugins"
                    : "One-time lifetime purchase"}
                </div>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full brutal-border bg-primary/15 text-primary px-3 py-1.5 text-xs font-semibold">
                <Zap className="h-3.5 w-3.5" /> LTC / SOL only
              </div>
            </div>

            <ul className="space-y-2 text-sm">
              {[
                "Unlimited tokens with rotation",
                "Custom message pool & interval",
                "Auto-delete sent messages",
                "Humanized timing to avoid bans",
                "Live console output",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {checkout ? (
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
                  {creating
                    ? "Creating invoice..."
                    : `Pay $${spamPrice.toFixed(2)} with crypto`}
                </button>
                {payError && <div className="text-xs text-destructive">{payError}</div>}
                <button
                  onClick={() => setCheckout(false)}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCheckout(true)}
                className="block w-full rounded-xl brutal-border bg-primary text-primary-foreground hover:bg-primary/90 text-center py-4 text-sm font-semibold"
              >
                Unlock for ${spamPrice.toFixed(2)}
              </button>
            )}

            <div className="rounded-xl brutal-border bg-background/40 px-4 py-3 flex items-center gap-2 text-[12px] text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5 text-primary" />
              Already have a key? The LuauX bot DMs it to you the moment payment confirms.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Has active key -- show control panel
  const activeBot = runningBots.find((b) => b.id === selectedBotId);

  return (
    <div className="space-y-6 animate-page-in">
      <header className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center animate-border">
          <Zap className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Discord Auto-Spam
            {isAdmin && (
              <span className="ml-3 inline-flex items-center rounded-full bg-primary/15 text-primary px-2.5 py-0.5 text-xs font-semibold brutal-border">
                ADMIN
              </span>
            )}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Multi-token channel spammer with rotation and a live console.
          </p>
        </div>
      </header>

      {/* License Key Display */}
      <div className="rounded-2xl brutal-border bg-card p-5 animated-border noise-texture relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="text-xs uppercase tracking-widest text-primary">
              {isAdmin ? "Admin mode" : "License active"}
            </span>
          </div>
          {!isAdmin && (
            <span className="text-[10px] text-muted-foreground">
              Expires {new Date(activeKey!.expires_at).toLocaleDateString()}
            </span>
          )}
        </div>
        {!isAdmin && (
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-secondary/40 px-3 py-2 font-mono text-sm break-all">
              {activeKey!.key}
            </code>
            <button
              onClick={() => copy(activeKey!.key)}
              className="rounded-lg brutal-border bg-secondary/40 hover:bg-secondary px-3 py-2 text-xs font-semibold"
            >
              {copied === activeKey!.key ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
        )}
        {isAdmin && (
          <div className="mt-3 text-xs text-muted-foreground">
            Payment checks bypassed. All features unlocked.
          </div>
        )}
      </div>

      {/* Config Panel */}
      <div className="rounded-2xl brutal-border bg-card animated-border noise-texture relative overflow-hidden">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="w-full flex items-center justify-between p-5"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Settings className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <div className="font-semibold text-sm">Spam Configuration</div>
              <div className="text-xs text-muted-foreground">
                {channelId ? `Channel: ${channelId}` : "Not configured"}
              </div>
            </div>
          </div>
          {showConfig ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {showConfig && (
          <div className="px-5 pb-5 space-y-4 border-t border-border/60 pt-4">
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                User Token
              </span>
              <input
                type="password"
                className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="MTI..."
              />
              <span className="text-[10px] text-muted-foreground">
                Discord user token (from browser DevTools). Your account must be in the server.
              </span>
            </label>

            <label className="text-xs space-y-1">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                Channel ID
              </span>
              <input
                className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                placeholder="1234567890123456789"
              />
              <span className="text-[10px] text-muted-foreground">
                Right-click channel in Discord with Developer Mode on
              </span>
            </label>

            <label className="text-xs space-y-1">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                Messages (one per line)
              </span>
              <textarea
                className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono resize-none"
                rows={4}
                value={messages}
                onChange={(e) => setMessages(e.target.value)}
                placeholder={"gg everyone\nbump\njoin the server"}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                  Base interval (seconds)
                </span>
                <input
                  type="number"
                  min="1"
                  className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                  value={interval}
                  onChange={(e) => setInterval_(e.target.value)}
                />
              </label>
              <div className="text-xs space-y-1">
                <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                  Options
                </span>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deleteAfter}
                      onChange={(e) => setDeleteAfter(e.target.checked)}
                      className="rounded"
                    />
                    <span>Delete after send</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={humanize}
                      onChange={(e) => setHumanize(e.target.checked)}
                      className="rounded"
                    />
                    <span>Humanize timing</span>
                  </label>
                </div>
              </div>
            </div>

            {humanize && (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                    Min delay (seconds)
                  </span>
                  <input
                    type="number"
                    min="1"
                    className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                    value={minDelay}
                    onChange={(e) => setMinDelay(e.target.value)}
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                    Max delay (seconds)
                  </span>
                  <input
                    type="number"
                    min="1"
                    className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                    value={maxDelay}
                    onChange={(e) => setMaxDelay(e.target.value)}
                  />
                </label>
              </div>
            )}

            {error && <div className="text-xs text-destructive">{error}</div>}

            <button
              onClick={launchBot}
              disabled={launching}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold disabled:opacity-50 btn-premium"
            >
              {launching ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {launching ? "Starting..." : "Start Spamming"}
            </button>
          </div>
        )}
      </div>

      {/* Live Console */}
      {selectedBotId && (
        <div className="rounded-2xl brutal-border bg-card p-5 space-y-3 animated-border noise-texture relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full ${activeBot?.status === "running" ? "bg-primary animate-pulse" : "bg-muted-foreground"}`}
              />
              <span className="text-xs font-semibold uppercase tracking-widest">Console</span>
              <span className="text-xs text-muted-foreground">
                {activeBot?.label || selectedBotId}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-mono">
                {consoleEntries.length} lines
              </span>
              <button
                onClick={() => setConsoleEntries([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
              <button
                onClick={() => setSelectedBotId(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
          </div>
          <BotConsole entries={consoleEntries} highlightBot={true} />
        </div>
      )}

      {/* Running Bots */}
      {runningBots.length > 0 && (
        <div className="rounded-2xl brutal-border bg-card p-5 space-y-3 animated-border noise-texture relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Active Instances
            </div>
            <button
              onClick={stopAndClearAll}
              disabled={stoppingId !== null}
              className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 hover:bg-destructive/20 text-destructive px-3 py-1.5 text-xs font-semibold transition-all duration-200 disabled:opacity-50"
            >
              <Square className="h-3 w-3" /> Stop & Clear All
            </button>
          </div>
          {runningBots.map((bot) => (
            <div
              key={bot.id}
              className="flex items-center justify-between rounded-lg bg-secondary/30 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <div
                  className={`h-2 w-2 rounded-full ${bot.status === "running" ? "bg-primary animate-pulse" : bot.status === "pending" ? "bg-amber-400 animate-pulse" : "bg-muted-foreground"}`}
                />
                <span className="text-sm font-semibold">{bot.label}</span>
                <span className="text-xs text-muted-foreground capitalize">{bot.status}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedBotId(bot.id);
                    setConsoleEntries([]);
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  Console
                </button>
                <button
                  onClick={() => stopBot(bot.id)}
                  disabled={stoppingId === bot.id}
                  className="rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive px-2 py-1"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
