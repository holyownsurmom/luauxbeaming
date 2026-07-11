import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Bot,
  Plus,
  Trash2,
  Lock,
  ShoppingCart,
  Play,
  Square,
  Send,
  Globe,
  MessageSquare,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Wifi,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfile, getMcAccounts, addMcAccount, deleteMcAccount } from "@/lib/luaux.functions";
import { BotConsole, type ConsoleEntry } from "@/components/bot-console";

export const Route = createFileRoute("/dashboard/bots")({
  head: () => ({ meta: [{ title: "MC Auto-Message — LuauX" }] }),
  component: BotsPage,
});

type Account = {
  id: string;
  label: string;
  auth_type: string;
  username: string | null;
  uuid: string | null;
  ssid: string | null;
  status: string;
  created_at: string;
};

type McBotStatus = {
  id: string;
  status: string;
  label: string;
  error: string | null;
  startedAt: number | null;
  config: Record<string, unknown>;
  logCount: number;
};

function BotsPage() {
  const fetchProfile = useServerFn(getMyProfile);
  const fetchAccounts = useServerFn(getMcAccounts);
  const addAcc = useServerFn(addMcAccount);
  const delAcc = useServerFn(deleteMcAccount);

  const [active, setActive] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [maxBots, setMaxBots] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    label: "",
    auth_type: "ssid",
    username: "",
    uuid: "",
    ssid: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [runningBots, setRunningBots] = useState<McBotStatus[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const [mcConfig, setMcConfig] = useState({
    serverHost: "",
    serverPort: "25565",
    messages: "" as string,
    interval: "5",
  });
  const [launching, setLaunching] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const [showMCPanel, setShowMCPanel] = useState(true);
  const [pingResult, setPingResult] = useState<{
    online: boolean;
    version?: string;
    players?: { online: number; max: number };
    motd?: string;
    latency?: number;
  } | null>(null);
  const [pinging, setPinging] = useState(false);

  const reload = async () => {
    const p = (await fetchProfile()) as {
      active: boolean;
      isAdmin?: boolean;
      plan: { max_bots: number } | null;
    };
    setActive(p.active);
    setIsAdmin(p.isAdmin ?? false);
    setMaxBots(p.isAdmin ? 999 : (p.plan?.max_bots ?? 0));
    const a = (await fetchAccounts()) as Account[];
    setAccounts(a);
  };

  const refreshBots = useCallback(async () => {
    try {
      const res = await fetch("/api/bots/mc/status");
      const data = await res.json();
      if (data.bots) setRunningBots(data.bots);
    } catch {
      /* ignore status errors */
    }
  }, []);

  useEffect(() => {
    reload();
    refreshBots();
  }, []);

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

  useEffect(() => {
    const interval = setInterval(refreshBots, 5000);
    return () => clearInterval(interval);
  }, [refreshBots]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.label.trim()) return setError("Label required");
    if (form.auth_type === "ssid" && !form.ssid.trim()) return setError("SSID required");
    if (form.auth_type === "microsoft" && !form.username.trim())
      return setError("Username/email required");
    if (form.auth_type === "offline" && !form.username.trim()) return setError("Username required");
    setSaving(true);
    try {
      await addAcc({
        data: {
          label: form.label.trim(),
          auth_type: form.auth_type as "ssid" | "microsoft" | "offline",
          username: form.username.trim() || undefined,
          uuid: form.uuid.trim() || undefined,
          ssid: form.ssid.trim() || undefined,
        },
      });
      setForm({ label: "", auth_type: "ssid", username: "", uuid: "", ssid: "" });
      setShowForm(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add account");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this account?")) return;
    await delAcc({ data: { id } });
    await reload();
  };

  const pingServer = async () => {
    if (!mcConfig.serverHost.trim()) return;
    setPinging(true);
    setPingResult(null);
    try {
      const res = await fetch(
        `/api/bots/mc/ping?host=${encodeURIComponent(mcConfig.serverHost)}&port=${mcConfig.serverPort}`,
      );
      const data = await res.json();
      setPingResult(data);
    } catch {
      setPingResult({ online: false });
    } finally {
      setPinging(false);
    }
  };

  const launchBot = async (account: Account) => {
    if (!mcConfig.serverHost.trim()) {
      setError("Server IP required");
      return;
    }
    const msgs = mcConfig.messages
      .split("\n")
      .map((m) => m.trim())
      .filter(Boolean);
    if (msgs.length === 0) {
      setError("At least one message required");
      return;
    }

    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/bots/mc/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account.id,
          label: account.label,
          serverHost: mcConfig.serverHost,
          serverPort: parseInt(mcConfig.serverPort, 10),
          authType: account.auth_type,
          username: account.username || undefined,
          uuid: account.uuid || undefined,
          ssid: account.ssid || undefined,
          messages: msgs,
          interval: parseInt(mcConfig.interval, 10) || 5,
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
      await fetch("/api/bots/mc/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId }),
      });
      if (selectedBotId === botId) setSelectedBotId(null);
      await refreshBots();
    } finally {
      setStoppingId(null);
    }
  };

  if (active === null) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  if (!active) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-4xl font-semibold tracking-tight">MC Auto-Message</h1>
          <p className="mt-2 text-muted-foreground">
            Deploy Minecraft bots that auto-message in any server.
          </p>
        </header>
        <div className="rounded-2xl brutal-border bg-card p-10 text-center">
          <Lock className="h-8 w-8 mx-auto text-destructive" />
          <h2 className="mt-4 font-display text-2xl font-semibold">No active plan</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            You need an active plan before you can deploy bots. Purchase one with crypto -- access
            unlocks after 2 confirmations.
          </p>
          <Link
            to="/dashboard/purchase"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-xs font-semibold"
          >
            <ShoppingCart className="h-4 w-4" /> Choose a plan
          </Link>
        </div>
      </div>
    );
  }

  const atLimit = accounts.length >= maxBots;
  const activeBot = runningBots.find((b) => b.id === selectedBotId);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            MC Auto-Message
            {isAdmin && (
              <span className="ml-3 inline-flex items-center rounded-full bg-primary/15 text-primary px-2.5 py-0.5 text-xs font-semibold brutal-border">
                ADMIN
              </span>
            )}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Join any Minecraft server and auto-message with your accounts.
          </p>
        </div>
        <div className="text-right text-xs">
          <div className="text-muted-foreground uppercase tracking-widest text-[10px]">Slots</div>
          <div className="font-mono text-lg">
            {accounts.length} / {maxBots}
          </div>
        </div>
      </header>

      {/* Server Config Panel */}
      <div className="rounded-2xl brutal-border bg-card">
        <button
          onClick={() => setShowMCPanel(!showMCPanel)}
          className="w-full flex items-center justify-between p-5"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Globe className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <div className="font-semibold text-sm">Server Configuration</div>
              <div className="text-xs text-muted-foreground">
                {mcConfig.serverHost || "No server set"}:{mcConfig.serverPort}
              </div>
            </div>
          </div>
          {showMCPanel ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {showMCPanel && (
          <div className="px-5 pb-5 space-y-4 border-t border-border/60 pt-4">
            <div className="grid md:grid-cols-3 gap-3">
              <label className="text-xs space-y-1 md:col-span-2">
                <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                  Server IP
                </span>
                <input
                  className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                  value={mcConfig.serverHost}
                  onChange={(e) => setMcConfig({ ...mcConfig, serverHost: e.target.value })}
                  placeholder="mc.hypixel.net"
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                  Port
                </span>
                <input
                  className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                  value={mcConfig.serverPort}
                  onChange={(e) => setMcConfig({ ...mcConfig, serverPort: e.target.value })}
                  placeholder="25565"
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={pingServer}
                disabled={pinging || !mcConfig.serverHost.trim()}
                className="inline-flex items-center gap-2 rounded-full brutal-border bg-secondary/40 hover:bg-secondary px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {pinging ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wifi className="h-3.5 w-3.5" />
                )}
                {pinging ? "Pinging..." : "Ping Server"}
              </button>
              {pingResult && (
                <div
                  className={`text-xs ${pingResult.online ? "text-primary" : "text-destructive"}`}
                >
                  {pingResult.online ? (
                    <>
                      Online -- v{pingResult.version} -- {pingResult.players?.online}/
                      {pingResult.players?.max} players
                      {pingResult.latency ? ` -- ${pingResult.latency}ms` : ""}
                    </>
                  ) : (
                    "Offline or unreachable"
                  )}
                </div>
              )}
            </div>

            <label className="text-xs space-y-1">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                Messages (one per line)
              </span>
              <textarea
                className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono resize-none"
                rows={4}
                value={mcConfig.messages}
                onChange={(e) => setMcConfig({ ...mcConfig, messages: e.target.value })}
                placeholder={"gg everyone\n888 to join\nhello world"}
              />
            </label>

            <label className="text-xs space-y-1">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                Interval (seconds)
              </span>
              <input
                type="number"
                min="1"
                className="w-32 rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                value={mcConfig.interval}
                onChange={(e) => setMcConfig({ ...mcConfig, interval: e.target.value })}
              />
            </label>
          </div>
        )}
      </div>

      {/* Accounts */}
      <div className="rounded-2xl brutal-border bg-card">
        <div className="p-4 border-b border-border/60 flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Minecraft Accounts
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            disabled={atLimit}
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" /> {atLimit ? "Limit reached" : "Add"}
          </button>
        </div>

        {showForm && (
          <div className="p-4 border-b border-border/60 bg-secondary/20">
            <form onSubmit={submit} className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                    Label
                  </span>
                  <input
                    className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    placeholder="alt-1"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                    Auth type
                  </span>
                  <select
                    className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm"
                    value={form.auth_type}
                    onChange={(e) => setForm({ ...form, auth_type: e.target.value })}
                  >
                    <option value="ssid">SSID (session cookie)</option>
                    <option value="microsoft">Microsoft account</option>
                    <option value="offline">Offline / Cracked (username only)</option>
                  </select>
                </label>
                {form.auth_type === "ssid" ? (
                  <>
                    <label className="text-xs space-y-1 md:col-span-2">
                      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                        SSID token
                      </span>
                      <input
                        type="password"
                        className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                        value={form.ssid}
                        onChange={(e) => setForm({ ...form, ssid: e.target.value })}
                        placeholder="paste your session cookie"
                      />
                    </label>
                    <label className="text-xs space-y-1 md:col-span-2">
                      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                        Player UUID (for online-mode servers like Hypixel)
                      </span>
                      <input
                        className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                        value={form.uuid}
                        onChange={(e) => setForm({ ...form, uuid: e.target.value })}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        Find yours at namemc.com — required for premium servers
                      </span>
                    </label>
                  </>
                ) : (
                  <label className="text-xs space-y-1 md:col-span-2">
                    <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                      {form.auth_type === "offline" ? "Username" : "Username / email"}
                    </span>
                    <input
                      className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder={form.auth_type === "offline" ? "Steve" : "you@example.com"}
                    />
                  </label>
                )}
              </div>
              {error && <div className="text-xs text-destructive">{error}</div>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-xs font-semibold disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save account"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setError(null);
                  }}
                  className="rounded-full brutal-border bg-secondary/40 hover:bg-secondary px-5 py-2.5 text-xs font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {accounts.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No accounts yet. Add your first above.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {accounts.map((a) => {
              const botForAccount = runningBots.find((b) => b.config?.accountId === a.id);
              const isRunning =
                botForAccount?.status === "running" || botForAccount?.status === "connecting";
              return (
                <li key={a.id} className="p-4 flex items-center gap-4">
                  <div
                    className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                      isRunning ? "bg-primary/20" : "bg-primary/10"
                    }`}
                  >
                    <Bot
                      className={`h-5 w-5 ${isRunning ? "text-primary animate-pulse" : "text-primary"}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{a.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.auth_type.toUpperCase()} · {a.username || "hidden"} ·{" "}
                      <span className={isRunning ? "text-primary" : "uppercase"}>
                        {isRunning ? "RUNNING" : a.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isRunning && botForAccount ? (
                      <>
                        <button
                          onClick={() => setSelectedBotId(botForAccount.id)}
                          className="rounded-lg bg-primary/10 hover:bg-primary/20 text-primary px-3 py-2 text-xs font-semibold"
                        >
                          Console
                        </button>
                        <button
                          onClick={() => stopBot(botForAccount.id)}
                          disabled={stoppingId === botForAccount.id}
                          className="rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive px-3 py-2"
                        >
                          <Square className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => launchBot(a)}
                        disabled={launching || !mcConfig.serverHost.trim()}
                        className="rounded-lg bg-primary/10 hover:bg-primary/20 text-primary px-3 py-2 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" /> Launch
                      </button>
                    )}
                    <button
                      onClick={() => remove(a.id)}
                      className="rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive px-3 py-2"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
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

      {/* Running Bots Summary */}
      {runningBots.length > 0 && !selectedBotId && (
        <div className="rounded-2xl brutal-border bg-card p-5 space-y-3">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Active Bots</div>
          {runningBots.map((bot) => (
            <div
              key={bot.id}
              className="flex items-center justify-between rounded-lg bg-secondary/30 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <div
                  className={`h-2 w-2 rounded-full ${bot.status === "running" ? "bg-primary animate-pulse" : "bg-amber-400"}`}
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
                  View console
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
