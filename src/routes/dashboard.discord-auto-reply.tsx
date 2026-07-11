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
} from "lucide-react";
import { getPluginKeys, getMyProfile } from "@/lib/luaux.functions";
import { BotConsole, type ConsoleEntry } from "@/components/bot-console";
import { PluginPage } from "@/components/plugin-page";

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
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const [runningBots, setRunningBots] = useState<AutoReplyBotStatus[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const [token, setToken] = useState("");
  const [messages, setMessages] = useState("");
  const [minDelay, setMinDelay] = useState("3");
  const [maxDelay, setMaxDelay] = useState("8");
  const [typing, setTyping] = useState(true);
  const [autoAcceptFriends, setAutoAcceptFriends] = useState(true);

  const [launching, setLaunching] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(true);

  useEffect(() => {
    Promise.all([fetchKeys({ data: { plugin_id: "discord-autoreply" } }), fetchProfile()])
      .then(([k, p]) => {
        setKeys(k as KeyRow[]);
        setIsAdmin((p as { isAdmin?: boolean }).isAdmin ?? false);
      })
      .finally(() => setLoading(false));
  }, [fetchKeys, fetchProfile]);

  const activeKey = isAdmin
    ? { key: "ADMIN", expires_at: "2099-12-31", created_at: "" }
    : keys.find((k) => new Date(k.expires_at).getTime() > Date.now());

  const refreshBots = useCallback(async () => {
    try {
      const res = await fetch("/api/bots/discord-autoreply/status");
      const data = await res.json();
      if (data.bots) setRunningBots(data.bots);
    } catch {
      /* ignore status errors */
    }
  }, []);

  useEffect(() => {
    if (activeKey) {
      refreshBots();
      const interval = setInterval(refreshBots, 5000);
      return () => clearInterval(interval);
    }
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
          minDelay: parseFloat(minDelay) || 3,
          maxDelay: parseFloat(maxDelay) || 8,
          typing,
          autoAcceptFriends,
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
      const res = await fetch("/api/bots/discord-autoreply/stop", {
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
      const targets = runningBots.filter(
        (b) => b.status === "running" || b.status === "pending",
      );
      await Promise.all(
        targets.map((b) =>
          fetch("/api/bots/discord-autoreply/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ botId: b.id }),
          }).catch(() => {}),
        ),
      );
      setConsoleEntries([]);
      setSelectedBotId(null);
      await refreshBots();
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
        price={10}
        icon={MessageSquare}
        features={[
          "DM mode & Friend mode",
          "Humanized reply delay & typing",
          "Multi-token rotation",
          "Auto-accept friend requests (safe)",
          "Bring your own proxy, or use our premium pool (Enterprise)",
          "Live console",
        ]}
      />
    );
  }

  const activeBot = runningBots.find((b) => b.id === selectedBotId);

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center">
          <MessageSquare className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Discord Auto-Reply
            {isAdmin && (
              <span className="ml-3 inline-flex items-center rounded-full bg-primary/15 text-primary px-2.5 py-0.5 text-xs font-semibold brutal-border">
                ADMIN
              </span>
            )}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Hands-off DM responder with auto friend acceptance and humanized delay.
          </p>
        </div>
      </header>

      {/* License key display */}
      <div className="rounded-2xl brutal-border bg-card p-5">
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
      <div className="rounded-2xl brutal-border bg-card">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="w-full flex items-center justify-between p-5"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Settings className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <div className="font-semibold text-sm">Configuration</div>
              <div className="text-xs text-muted-foreground">
                {token ? "Account token configured" : "Not configured"}
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
                Discord user token (from browser DevTools). The bot will monitor DMs for this
                account.
              </span>
            </label>

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

            {error && <div className="text-xs text-destructive">{error}</div>}

            <button
              onClick={launchBot}
              disabled={launching}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold disabled:opacity-50"
            >
              {launching ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {launching ? "Starting..." : "Start Auto-Reply"}
            </button>
          </div>
        )}
      </div>

      {/* Live Console */}
      {selectedBotId && (
        <div className="rounded-2xl brutal-border bg-card p-5 space-y-3">
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

      {/* Active Instances */}
      {runningBots.length > 0 && (
        <div className="rounded-2xl brutal-border bg-card p-5 space-y-3">
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
