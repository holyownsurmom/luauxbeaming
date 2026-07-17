import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquare,
  Play,
  Square,
  Copy,
  Check,
  KeyRound,
  ChevronDown,
  ChevronUp,
  Settings,
  Shield,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { getPluginKeys, getMyProfile } from "@/lib/luaux.functions";
import { BotConsole, type ConsoleEntry } from "@/components/bot-console";
import { PluginPage } from "@/components/plugin-page";
import { adminBypassesPaywall, getAdminShowPaywalls } from "@/lib/admin-preview";
import {
  DiscordRiskDisclaimer,
  useDiscordRiskDisclaimer,
} from "@/components/discord-risk-disclaimer";
import {
  AUTOREPLY_PROFILES,
  deleteTemplate,
  listTemplates,
  saveTemplate,
  type AutoreplyTemplate,
} from "@/lib/job-templates";
import {
  AdminBadge,
  BotField,
  BotPageHeader,
  BotPageShell,
  BotPanel,
  BotWorkspace,
  DashButton,
  LicenseBar,
  fieldMonoClass,
} from "@/components/dashboard-ui";

export const Route = createFileRoute("/dashboard/discord-auto-reply")({
  head: () => ({ meta: [{ title: "Discord Auto-Reply — LuauX" }] }),
  component: DiscordAutoReplyPage,
});

type KeyRow = {
  id: string;
  key: string;
  expires_at: string;
  created_at: string;
  delivered: boolean;
};

type AutoReplyBotStatus = {
  id: string;
  status: string;
  label: string;
  error: string | null;
  startedAt: number | null;
  config: Record<string, unknown>;
  logCount: number;
};

function DiscordAutoReplyPage() {
  const fetchKeys = useServerFn(getPluginKeys);
  const fetchProfile = useServerFn(getMyProfile);

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPaywalls, setShowPaywalls] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const [runningBots, setRunningBots] = useState<AutoReplyBotStatus[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const [token, setToken] = useState("");
  const [messages, setMessages] = useState("");
  const [minDelay, setMinDelay] = useState("60");
  const [maxDelay, setMaxDelay] = useState("120");
  const [typing, setTyping] = useState(false);
  const [autoAcceptFriends, setAutoAcceptFriends] = useState(false);
  const [delayProfile, setDelayProfile] = useState<"safe" | "balanced" | "custom">("balanced");
  const [templates, setTemplates] = useState<AutoreplyTemplate[]>([]);
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
    setTemplates(listTemplates("autoreply") as AutoreplyTemplate[]);
  }, []);

  useEffect(() => {
    refreshTemplates();
    const on = () => refreshTemplates();
    window.addEventListener("luaux-templates", on);
    return () => window.removeEventListener("luaux-templates", on);
  }, [refreshTemplates]);

  const applyProfile = (p: "safe" | "balanced") => {
    const cfg = AUTOREPLY_PROFILES[p];
    setDelayProfile(p);
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
    const name = templateName.trim() || `Auto-reply ${new Date().toLocaleDateString()}`;
    saveTemplate({
      kind: "autoreply",
      name,
      messages,
      minDelay,
      maxDelay,
      autoAcceptFriends,
      profile: delayProfile,
    });
    setTemplateName("");
    refreshTemplates();
    toast.success("Template saved (token not stored)");
  };

  const loadTemplate = (t: AutoreplyTemplate) => {
    setMessages(t.messages);
    setMinDelay(t.minDelay);
    setMaxDelay(t.maxDelay);
    setAutoAcceptFriends(!!t.autoAcceptFriends);
    setDelayProfile(t.profile || "custom");
    toast.success(`Loaded “${t.name}”`);
  };

  useEffect(() => {
    Promise.all([fetchKeys({ data: { plugin_id: "discord-autoreply" } }), fetchProfile()])
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

  const activeKey = adminBypassesPaywall(isAdmin)
    ? { key: "ADMIN", expires_at: "2099-12-31", created_at: "" }
    : keys.find((k) => new Date(k.expires_at).getTime() > Date.now());
  void showPaywalls;

  const risk = useDiscordRiskDisclaimer("autoreply", !!activeKey);

  const refreshBots = useCallback(async (opts?: { toastOnError?: boolean }) => {
    try {
      const res = await fetch("/api/bots/discord-autoreply/status");
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
    if (!activeKey) return;
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
  }, [activeKey, refreshBots]);

  useEffect(() => {
    if (!activeKey) return;
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
  }, [selectedBotId, activeKey]);

  const copy = async (v: string) => {
    await navigator.clipboard.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(null), 1500);
  };

  const launchBot = async () => {
    if (!risk.requireAccepted()) {
      return setError("Accept the disclaimer before starting.");
    }
    if (!token.trim()) return setError("User token required");
    const msgs = messages
      .split("\n")
      .map((m) => m.trim())
      .filter(Boolean);
    if (msgs.length === 0) return setError("At least one reply message required");

    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/bots/discord-autoreply/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          messages: msgs,
          minDelay: Math.max(parseFloat(minDelay) || 60, 40),
          maxDelay: Math.max(parseFloat(maxDelay) || 180, 80),
          typing: false,
          autoAcceptFriends,
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
      toast.success("Auto-reply bot launched");
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
      const res = await fetch("/api/bots/discord-autoreply/stop", {
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
        body: JSON.stringify({ type: "discord-autoreply" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Clear all failed");
      setConsoleEntries([]);
      setSelectedBotId(null);
      setRunningBots([]);
      toast.success("All auto-reply bots stopped & removed");
      await refreshBots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear all failed");
    } finally {
      setStoppingId(null);
    }
  };

  // If no license key, show the purchase PluginPage
  if (!activeKey) {
    return (
      <PluginPage
        pluginId="discord-autoreply"
        title="Discord Auto-Reply"
        tagline="Hands-off DM responder with humanized timing."
        cardTitle="Discord Auto-Reply"
        cardDescription="Hands-off DM auto-responder. Pick DM or Friend mode and let it reply for you — humanized timing, zero captcha solving."
        price={20}
        priceNote="One-time lifetime purchase"
        showBundleOffer
        icon={MessageSquare}
        features={[
          "DM auto-reply with humanized delays",
          "Optional friend-accept (rate-limited)",
          "Live console",
          "Use alt accounts only",
        ]}
      />
    );
  }

  const activeBot = runningBots.find((b) => b.id === selectedBotId);

  return (
    <BotPageShell>
      <DiscordRiskDisclaimer
        tool="autoreply"
        open={risk.open}
        onAccepted={risk.onAccepted}
      />
      <BotPageHeader
        title="Discord auto-reply"
        description="Reply to every inbound DM on an alt — humanized timing, live logs."
        badge={isAdmin ? <AdminBadge /> : null}
      />

      <LicenseBar
        isAdmin={isAdmin}
        expiresAt={activeKey?.expires_at}
        licenseKey={activeKey?.key}
        onCopy={() => activeKey && copy(activeKey.key)}
        copied={!!activeKey && copied === activeKey.key}
      />

      <BotWorkspace
        main={
          <>
      <BotPanel title="Config" subtitle={token ? "token set" : "empty"}>
        {showConfig && (
          <>
            <BotField
              label="User token"
              hint={
                tokenCheck.message ||
                "Discord user token. Check before start — never stored in templates."
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

            <div className="space-y-2">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                Delay profile
              </span>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "safe" as const, ...AUTOREPLY_PROFILES.safe },
                    { id: "balanced" as const, ...AUTOREPLY_PROFILES.balanced },
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
                Reply message pool (one per line, chosen randomly)
              </span>
              <textarea
                className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono resize-none"
                rows={4}
                value={messages}
                onChange={(e) => setMessages(e.target.value)}
                placeholder={
                  "hey! add me on my main discord: cooluser\nhello, please message my server!\nsorry, i'm busy right now"
                }
              />
            </label>

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
                  min="1"
                  className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                  value={maxDelay}
                  onChange={(e) => {
                    setDelayProfile("custom");
                    setMaxDelay(e.target.value);
                  }}
                />
              </label>
            </div>

            <div className="text-xs space-y-1">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                Features
              </span>
              <div className="flex gap-6 mt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={typing}
                    onChange={(e) => setTyping(e.target.checked)}
                    className="rounded"
                  />
                  <span>Simulate typing</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoAcceptFriends}
                    onChange={(e) => setAutoAcceptFriends(e.target.checked)}
                    className="rounded"
                  />
                  <span>Auto-accept friend requests</span>
                </label>
              </div>
            </div>

            {error && <div className="text-xs font-semibold text-destructive">{error}</div>}

            <DashButton className="w-full" size="lg" onClick={launchBot} disabled={launching}>
              {launching ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {launching ? "Starting..." : "Start auto-reply"}
            </DashButton>
          </>
        )}
      </BotPanel>
          </>
        }
        side={
          <>
            <BotPanel
              title="Live console"
              subtitle={
                selectedBotId
                  ? activeBot?.label || selectedBotId.slice(0, 8)
                  : "Select a job"
              }
              actions={
                selectedBotId ? (
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
                ) : null
              }
            >
              {selectedBotId ? (
                <>
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
                      <DashButton
                        variant="danger"
                        size="sm"
                        onClick={() => void stopBot(selectedBotId)}
                        disabled={stoppingId === selectedBotId}
                      >
                        <Square className="h-3 w-3" /> Stop
                      </DashButton>
                    </div>
                  </div>
                  {activeBot?.error ? (
                    <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive mb-2">
                      {activeBot.error}
                    </div>
                  ) : null}
                  <BotConsole
                    entries={consoleEntries}
                    maxHeight={420}
                    highlightBot={true}
                    title="LUAUX@AUTOREPLY ~ TAIL -F BOT.LOG"
                  />
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
                  <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Start auto-reply or open Console on a job to stream logs.
                  </p>
                </div>
              )}
            </BotPanel>

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
                        <span className="text-sm font-extrabold truncate">
                          {bot.label || "auto-reply"}
                        </span>
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
                          onClick={() => void stopBot(bot.id)}
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
          </>
        }
      />
    </BotPageShell>
  );
}
