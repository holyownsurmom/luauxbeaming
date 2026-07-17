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
import { adminBypassesPaywall, getAdminShowPaywalls } from "@/lib/admin-preview";
import {
  DiscordRiskDisclaimer,
  useDiscordRiskDisclaimer,
} from "@/components/discord-risk-disclaimer";
import {
  SPAM_PROFILES,
  deleteTemplate,
  listTemplates,
  saveTemplate,
  type SpamTemplate,
} from "@/lib/job-templates";
import {
  AdminBadge,
  BotField,
  BotPageHeader,
  BotPanel,
  DashButton,
  LicenseBar,
  PageShell,
  fieldControlClass,
  fieldMonoClass,
} from "@/components/dashboard-ui";

export const Route = createFileRoute("/dashboard/discord-spam")({
  head: () => ({
    meta: [{ title: "Discord Auto-Spam — LuauX" }],
  }),
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
  fulfilled_at?: string | null;
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
  const [showPaywalls, setShowPaywalls] = useState(false);
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
  // Worker enforces long floors (15–40 min warmup, 20+ min gaps). UI matches that.
  const [interval, setInterval_] = useState("1800");
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [humanize, setHumanize] = useState(true);
  const [minDelay, setMinDelay] = useState("1800");
  const [maxDelay, setMaxDelay] = useState("2400");
  const [delayProfile, setDelayProfile] = useState<"safe" | "balanced" | "custom">("balanced");
  const [templates, setTemplates] = useState<SpamTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [tokenCheck, setTokenCheck] = useState<{
    status: "idle" | "loading" | "ok" | "bad";
    message: string;
  }>({ status: "idle", message: "" });
  const [launching, setLaunching] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showConfig, setShowConfig] = useState(true);

  const refreshTemplates = useCallback(() => {
    setTemplates(listTemplates("spam") as SpamTemplate[]);
  }, []);

  useEffect(() => {
    refreshTemplates();
    const on = () => refreshTemplates();
    window.addEventListener("luaux-templates", on);
    return () => window.removeEventListener("luaux-templates", on);
  }, [refreshTemplates]);

  const applyProfile = (p: "safe" | "balanced") => {
    const cfg = SPAM_PROFILES[p];
    setDelayProfile(p);
    setInterval_(cfg.interval);
    setMinDelay(cfg.minDelay);
    setMaxDelay(cfg.maxDelay);
  };

  const checkToken = async () => {
    if (!token.trim()) {
      setTokenCheck({ status: "bad", message: "Paste a token first" });
      return;
    }
    setTokenCheck({ status: "loading", message: "Checking…" });
    try {
      const res = await fetch("/api/discord/token-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (data.ok) {
        setTokenCheck({ status: "ok", message: data.message || "Valid token" });
        toast.success(data.message || "Token OK");
      } else {
        setTokenCheck({ status: "bad", message: data.message || "Token failed" });
        toast.error(data.message || "Token failed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Check failed";
      setTokenCheck({ status: "bad", message: msg });
    }
  };

  const saveCurrentTemplate = () => {
    const name = templateName.trim() || `Spam ${new Date().toLocaleDateString()}`;
    saveTemplate({
      kind: "spam",
      name,
      channelId,
      messages,
      interval,
      minDelay,
      maxDelay,
      profile: delayProfile,
    });
    setTemplateName("");
    refreshTemplates();
    toast.success("Template saved (token not stored)");
  };

  const loadTemplate = (t: SpamTemplate) => {
    setChannelId(t.channelId);
    setMessages(t.messages);
    setInterval_(t.interval);
    setMinDelay(t.minDelay);
    setMaxDelay(t.maxDelay);
    setDelayProfile(t.profile || "custom");
    toast.success(`Loaded “${t.name}”`);
  };

  useEffect(() => {
    Promise.all([fetchKeys({ data: { plugin_id: "discord-spam" } }), fetchProfile()])
      .then(([k, p]) => {
        setKeys(k as KeyRow[]);
        setIsAdmin((p as { isAdmin?: boolean }).isAdmin ?? false);
      })
      .finally(() => setLoading(false));
  }, [fetchKeys, fetchProfile]);

  useEffect(() => {
    setShowPaywalls(getAdminShowPaywalls());
    const on = () => setShowPaywalls(getAdminShowPaywalls());
    window.addEventListener("luaux-admin-preview", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("luaux-admin-preview", on);
      window.removeEventListener("storage", on);
    };
  }, []);

  const paymentId = payment?.id;
  useEffect(() => {
    if (!paymentId) return;
    const t = setInterval(async () => {
      try {
        const p = (await getPay({ data: { id: paymentId } })) as Payment;
        setPayment(p);
        if (p.fulfilled_at || p.status === "finished") {
          clearInterval(t);
          fetchKeys({ data: { plugin_id: "discord-spam" } }).then((d) => setKeys(d as KeyRow[]));
        }
      } catch {
        /* ignore polling errors */
      }
    }, 8000);
    return () => clearInterval(t);
  }, [paymentId, getPay, fetchKeys]);

  const activeKey = adminBypassesPaywall(isAdmin)
    ? { key: "ADMIN", expires_at: "2099-12-31", created_at: "" }
    : keys.find((k) => new Date(k.expires_at).getTime() > Date.now());
  void showPaywalls;

  const refreshBots = useCallback(async (opts?: { toastOnError?: boolean }) => {
    try {
      const res = await fetch("/api/bots/discord/status");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Status ${res.status}`);
      }
      const data = await res.json();
      if (data.bots) setRunningBots(data.bots);
    } catch (e) {
      if (opts?.toastOnError) {
        toast.error(e instanceof Error ? e.message : "Failed to load bot status");
      }
    }
  }, []);

  useEffect(() => {
    refreshBots();
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshBots();
    };
    const interval = setInterval(tick, 8000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshBots();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
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

  const risk = useDiscordRiskDisclaimer("spam", !!activeKey);

  const launchBot = async () => {
    if (!risk.requireAccepted()) {
      return setError("Accept the disclaimer before starting.");
    }
    if (!token.trim()) return setError("User token required");
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
          interval: Math.max(parseInt(interval, 10) || 1800, 1800),
          deleteAfterSend: false,
          humanize: true,
          minDelay: Math.max(parseFloat(minDelay) || 1800, 1800),
          maxDelay: Math.max(parseFloat(maxDelay) || 2400, 1800),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      setSelectedBotId(data.botId);
      setConsoleEntries([
        {
          ts: Date.now(),
          level: "system",
          msg: `Job ${String(data.botId).slice(0, 8)}… queued — waiting for worker…`,
        },
      ]);
      toast.success("Discord spam bot launched");
      await refreshBots();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Launch failed";
      setError(msg);
      toast.error(msg);
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
        toast.error(typeof data.error === "string" ? data.error : `Stop failed (${res.status})`);
        return;
      }
      if (selectedBotId === botId) setSelectedBotId(null);
      toast.success("Stop signal sent");
      await refreshBots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stop failed");
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
    const done = !!payment.fulfilled_at || payment.status === "finished";
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
            <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight">
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
    <PageShell>
      <DiscordRiskDisclaimer
        tool="spam"
        open={risk.open}
        onAccepted={risk.onAccepted}
      />
      <BotPageHeader
        title="Discord spam"
        description="Channel campaigns for alt tokens — humanized delays, live console."
        badge={isAdmin ? <AdminBadge /> : null}
      />

      <LicenseBar
        isAdmin={isAdmin}
        expiresAt={activeKey?.expires_at}
        licenseKey={activeKey?.key}
        onCopy={() => activeKey && copy(activeKey.key)}
        copied={!!activeKey && copied === activeKey.key}
      />

      <BotPanel title="Config" subtitle={channelId ? `ch ${channelId}` : "empty"}>
        {showConfig && (
          <>
            <BotField
              label="User token"
              hint={
                tokenCheck.message ||
                "Discord user token (DevTools). Check before start — never stored in templates."
              }
            >
              <div className="flex gap-2">
                <input
                  type="password"
                  className={`${fieldMonoClass} flex-1`}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setTokenCheck({ status: "idle", message: "" });
                  }}
                  placeholder="MTI..."
                />
                <DashButton
                  variant="secondary"
                  size="sm"
                  onClick={checkToken}
                  disabled={tokenCheck.status === "loading"}
                >
                  {tokenCheck.status === "loading" ? "…" : "Check"}
                </DashButton>
              </div>
            </BotField>

            {/* Delay profiles */}
            <div className="space-y-2">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                Delay profile
              </span>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "safe" as const, ...SPAM_PROFILES.safe },
                    { id: "balanced" as const, ...SPAM_PROFILES.balanced },
                    { id: "custom" as const, label: "Custom", hint: "Manual delays" },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => (p.id === "custom" ? setDelayProfile("custom") : applyProfile(p.id))}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                      delayProfile === p.id
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/50 bg-background/40 text-muted-foreground hover:border-primary/20"
                    }`}
                  >
                    <div className="text-xs font-semibold">{p.label}</div>
                    <div className="text-[10px] opacity-80 mt-0.5">{p.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Templates */}
            <div className="rounded-xl border border-border/50 bg-background/30 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Templates
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg bg-background brutal-border px-3 py-2 text-xs"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name"
                />
                <button
                  type="button"
                  onClick={saveCurrentTemplate}
                  className="rounded-lg bg-primary/15 text-primary px-3 py-2 text-xs font-semibold hover:bg-primary/25"
                >
                  Save
                </button>
              </div>
              {templates.length > 0 && (
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/40 px-2 py-1.5 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => loadTemplate(t)}
                        className="text-left flex-1 truncate hover:text-primary font-medium"
                      >
                        {t.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          deleteTemplate(t.id);
                          refreshTemplates();
                        }}
                        className="text-destructive/80 hover:text-destructive shrink-0"
                        aria-label="Delete template"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

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
                  onChange={(e) => {
                    setDelayProfile("custom");
                    setInterval_(e.target.value);
                  }}
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
                    min="1800"
                    className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                    value={minDelay}
                    onChange={(e) => {
                      setDelayProfile("custom");
                      setMinDelay(e.target.value);
                    }}
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                    Max delay (seconds)
                  </span>
                  <input
                    type="number"
                    min="1800"
                    className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                    value={maxDelay}
                    onChange={(e) => {
                      setDelayProfile("custom");
                      setMaxDelay(e.target.value);
                    }}
                  />
                </label>
              </div>
            )}

            {error && <div className="text-xs font-semibold text-destructive">{error}</div>}

            <DashButton className="w-full" size="lg" onClick={launchBot} disabled={launching}>
              {launching ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {launching ? "Starting..." : "Start spamming"}
            </DashButton>
          </>
        )}
      </BotPanel>

      {selectedBotId && (
        <BotPanel
          title="Live console"
          subtitle={activeBot?.label || selectedBotId}
          actions={
            <DashButton
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedBotId(null);
                setConsoleEntries([]);
              }}
            >
              Close
            </DashButton>
          }
        >
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`h-2 w-2 rounded-full shrink-0 ${
                  activeBot?.status === "running"
                    ? "bg-primary animate-pulse"
                    : activeBot?.status === "pending"
                      ? "bg-amber-400 animate-pulse"
                      : activeBot?.status === "error"
                        ? "bg-destructive"
                        : "bg-muted-foreground"
                }`}
              />
              <span className="text-xs font-extrabold uppercase tracking-widest">
                {activeBot?.status || "idle"}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {consoleEntries.length} lines
              </span>
            </div>
            <div className="flex items-center gap-2">
              <DashButton variant="ghost" size="sm" onClick={() => setConsoleEntries([])}>
                Clear
              </DashButton>
              {selectedBotId && (
                <DashButton
                  variant="danger"
                  size="sm"
                  onClick={() => void stopBot(selectedBotId)}
                  disabled={stoppingId === selectedBotId}
                >
                  <Square className="h-3 w-3" /> Stop
                </DashButton>
              )}
            </div>
          </div>
          {activeBot?.error ? (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">
              {activeBot.error}
            </div>
          ) : null}
          <BotConsole
            entries={consoleEntries}
            highlightBot={true}
            title="LUAUX@SPAM ~ TAIL -F BOT.LOG"
          />
        </BotPanel>
      )}

      {runningBots.length > 0 && (
        <BotPanel
          title="Active jobs"
          subtitle={`${runningBots.length} running`}
          actions={
            <DashButton
              variant="danger"
              size="sm"
              onClick={stopAndClearAll}
              disabled={stoppingId !== null}
            >
              <Square className="h-3 w-3" /> Stop all
            </DashButton>
          }
        >
          <div className="space-y-2">
            {runningBots.map((bot) => (
              <div
                key={bot.id}
                className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/20 px-3 py-2.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      bot.status === "running"
                        ? "bg-primary animate-pulse"
                        : bot.status === "pending"
                          ? "bg-amber-400 animate-pulse"
                          : bot.status === "error"
                            ? "bg-destructive"
                            : "bg-muted-foreground"
                    }`}
                  />
                  <span className="text-sm font-extrabold truncate">{bot.label || "spam"}</span>
                  <span className="text-xs font-semibold text-muted-foreground capitalize">
                    {bot.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedBotId(bot.id);
                      setConsoleEntries([]);
                    }}
                    className="text-xs font-extrabold text-primary hover:underline"
                  >
                    Console
                  </button>
                  <button
                    type="button"
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
        </BotPanel>
      )}
    </PageShell>
  );
}
