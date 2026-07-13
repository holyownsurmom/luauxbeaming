import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
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
import { toast } from "sonner";
import {
  getMyProfile,
  getMcAccounts,
  addMcAccount,
  deleteMcAccount,
  previewMcSsid,
  refreshMcSsid,
} from "@/lib/luaux.functions";
import { BotConsole, type ConsoleEntry } from "@/components/bot-console";
import { adminBypassesPaywall, getAdminShowPaywalls } from "@/lib/admin-preview";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  status: string;
  created_at: string;
  has_ssid?: boolean;
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
  const previewSsid = useServerFn(previewMcSsid);
  const refreshSsid = useServerFn(refreshMcSsid);

  const [active, setActive] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPaywalls, setShowPaywalls] = useState(false);
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
  const [ssidPreview, setSsidPreview] = useState<{
    username: string;
    uuid: string;
  } | null>(null);
  const [ssidChecking, setSsidChecking] = useState(false);
  const [refreshTarget, setRefreshTarget] = useState<Account | null>(null);
  const [refreshToken, setRefreshToken] = useState("");
  const [refreshing, setRefreshing] = useState(false);
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
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [showMCPanel, setShowMCPanel] = useState(true);
  const [pingResult, setPingResult] = useState<{
    online: boolean;
    version?: string;
    players?: { online: number; max: number };
    motd?: string;
    latency?: number;
    error?: string;
  } | null>(null);
  const [pinging, setPinging] = useState(false);
  const [msAuth, setMsAuth] = useState<{
    uri: string;
    code: string;
    mins: number;
    botId: string;
  } | null>(null);
  const [msAuthWaiting, setMsAuthWaiting] = useState(false);
  const selectedBotIdRef = useRef<string | null>(null);
  const msAuthCodeRef = useRef<string | null>(null);
  const logPollSinceRef = useRef<number>(Date.now());

  const handleMsAuthMessage = useCallback((msg: string, botId?: string) => {
    const tryOpen = (uri: string, code: string, mins: number, id?: string) => {
      if (!code || code === "undefined" || code === "null") return;
      if (msAuthCodeRef.current === code) return;
      msAuthCodeRef.current = code;
      setMsAuth({
        uri: uri || "https://www.microsoft.com/link",
        code,
        mins: mins || 15,
        botId: id || selectedBotIdRef.current || "",
      });
      setMsAuthWaiting(false);
      if (id) setSelectedBotId(id);
      toast.message("Microsoft login required", {
        description: `Code: ${code}`,
        duration: 30000,
      });
    };

    if (msg.startsWith("MS_AUTH_REQUIRED|")) {
      const parts = msg.split("|");
      tryOpen(parts[1] || "https://www.microsoft.com/link", parts[2] || "", parseInt(parts[3], 10) || 15, botId);
      return;
    }
    const codeMatch = msg.match(/enter code[:\s]+([A-Z0-9]{4,12})/i);
    if (codeMatch) {
      const urlMatch = msg.match(/https?:\/\/(?:www\.)?microsoft\.com\/link[^\s|]*/i);
      tryOpen(urlMatch?.[0] || "https://www.microsoft.com/link", codeMatch[1], 15, botId);
    }
  }, []);

  const reload = async () => {
    const p = (await fetchProfile()) as {
      active: boolean;
      isAdmin?: boolean;
      plan: { max_bots: number } | null;
    };
    setIsAdmin(p.isAdmin ?? false);
    const bypass = adminBypassesPaywall(!!p.isAdmin);
    setActive(bypass ? true : p.active);
    setMaxBots(bypass ? 999 : (p.plan?.max_bots ?? 0));
    const a = (await fetchAccounts()) as Account[];
    setAccounts(a);
  };

  useEffect(() => {
    setShowPaywalls(getAdminShowPaywalls());
    const on = () => {
      setShowPaywalls(getAdminShowPaywalls());
      void reload();
    };
    window.addEventListener("luaux-admin-preview", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("luaux-admin-preview", on);
      window.removeEventListener("storage", on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  void showPaywalls;

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
    selectedBotIdRef.current = selectedBotId;
  }, [selectedBotId]);

  useEffect(() => {
    reload();
    refreshBots();
  }, []);

  // Stable SSE — do NOT reconnect when selected bot changes (that was dropping MS auth logs)
  useEffect(() => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = new EventSource("/api/bots/stream");
    eventSourceRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type !== "log") return;
        const msg = String(data.msg || data.message || "");
        const botId = data.botId || data.job_id || data.jobId;
        handleMsAuthMessage(msg, botId);
        if (msg.startsWith("MS_AUTH_REQUIRED|")) return;
        if (botId && botId === selectedBotIdRef.current) {
          setConsoleEntries((prev) => [
            ...prev.slice(-499),
            { ts: data.ts || Date.now(), level: data.level || "info", msg },
          ]);
        }
      } catch {
        /* ignore parse errors */
      }
    };
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [handleMsAuthMessage]);

  // Backup poll for MS auth codes (SSE can lag or miss)
  useEffect(() => {
    const poll = async () => {
      try {
        const since = logPollSinceRef.current;
        const res = await fetch(`/api/bots/logs?since=${since}&limit=50`);
        if (!res.ok) return;
        const data = await res.json();
        const logs = (data.logs || []) as Array<{
          ts: number;
          msg: string;
          botId?: string;
          level?: string;
        }>;
        for (const row of logs) {
          if (row.ts > logPollSinceRef.current) logPollSinceRef.current = row.ts;
          handleMsAuthMessage(String(row.msg || ""), row.botId);
          if (
            row.botId &&
            row.botId === selectedBotIdRef.current &&
            !String(row.msg || "").startsWith("MS_AUTH_REQUIRED|")
          ) {
            setConsoleEntries((prev) => {
              const exists = prev.some((p) => p.ts === row.ts && p.msg === row.msg);
              if (exists) return prev;
              return [
                ...prev.slice(-499),
                { ts: row.ts, level: (row.level as ConsoleEntry["level"]) || "info", msg: row.msg },
              ];
            });
          }
        }
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(poll, 1500);
    poll();
    return () => clearInterval(id);
  }, [handleMsAuthMessage]);

  useEffect(() => {
    const interval = setInterval(refreshBots, 5000);
    return () => clearInterval(interval);
  }, [refreshBots]);

  const checkSsid = async () => {
    setError(null);
    setSsidPreview(null);
    if (!form.ssid.trim()) return setError("Paste a Minecraft access token first");
    setSsidChecking(true);
    try {
      const preview = await previewSsid({ data: { ssid: form.ssid.trim() } });
      setSsidPreview({ username: preview.username, uuid: preview.uuid });
      if (!form.label.trim()) {
        setForm((f) => ({ ...f, label: preview.username }));
      }
      toast.success(`Token OK — ${preview.username}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "SSID validation failed");
      toast.error(e instanceof Error ? e.message : "SSID validation failed");
    } finally {
      setSsidChecking(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.label.trim()) return setError("Label required");
    if (form.auth_type === "ssid" && !form.ssid.trim())
      return setError("Minecraft access token (SSID) required");
    if (form.auth_type === "microsoft" && !form.username.trim())
      return setError("Username/email required");
    if (form.auth_type === "offline" && !form.username.trim()) return setError("Username required");
    setSaving(true);
    try {
      await addAcc({
        data: {
          label: form.label.trim(),
          auth_type: form.auth_type as "microsoft" | "ssid" | "offline",
          username: form.username.trim() || undefined,
          uuid: form.uuid.trim() || undefined,
          ssid: form.auth_type === "ssid" ? form.ssid.trim() : undefined,
        },
      });
      toast.success(
        form.auth_type === "ssid" ? "SSID validated and account saved" : "Account added",
      );
      setForm({ label: "", auth_type: "ssid", username: "", uuid: "", ssid: "" });
      setSsidPreview(null);
      setShowForm(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add account");
    } finally {
      setSaving(false);
    }
  };

  const submitRefreshSsid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refreshTarget) return;
    if (!refreshToken.trim()) {
      toast.error("Paste a fresh access token");
      return;
    }
    setRefreshing(true);
    try {
      const row = await refreshSsid({
        data: { id: refreshTarget.id, ssid: refreshToken.trim() },
      });
      toast.success(`Token refreshed — ${row.username || row.label}`);
      setRefreshTarget(null);
      setRefreshToken("");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const remove = async (id: string) => {
    setDeleteId(null);
    try {
      await delAcc({ data: { id } });
      toast.success("Account deleted");
      await reload();
    } catch {
      toast.error("Failed to delete account");
    }
  };

  const pingServer = async () => {
    if (!mcConfig.serverHost.trim()) return;
    setPinging(true);
    setPingResult(null);
    try {
      const address = mcConfig.serverPort && mcConfig.serverPort !== "25565"
        ? `${mcConfig.serverHost}:${mcConfig.serverPort}`
        : mcConfig.serverHost;
      const res = await fetch(
        `https://api.mcsrvstat.us/3/${encodeURIComponent(address)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let motd: string | undefined;
      if (typeof data.motd === "string") {
        motd = data.motd;
      } else if (data.motd?.clean) {
        motd = Array.isArray(data.motd.clean) ? data.motd.clean.join("\n") : data.motd.clean;
      } else if (data.motd?.raw) {
        motd = Array.isArray(data.motd.raw) ? data.motd.raw.join("\n") : data.motd.raw;
      }

      setPingResult({
        online: !!data.online,
        version: data.version || undefined,
        players: data.players
          ? { online: data.players.online ?? 0, max: data.players.max ?? 0 }
          : undefined,
        motd,
        error: data.online ? undefined : "Server is offline",
      });
    } catch (e) {
      setPingResult({
        online: false,
        error: e instanceof Error ? e.message : "Failed to reach server",
      });
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
          messages: msgs,
          interval: parseInt(mcConfig.interval, 10) || 5,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      toast.success(`Launched ${account.label}`);
      setSelectedBotId(data.botId);
      selectedBotIdRef.current = data.botId;
      setConsoleEntries([]);
      logPollSinceRef.current = Date.now() - 5000;
      msAuthCodeRef.current = null;
      if (account.auth_type === "microsoft") {
        setMsAuthWaiting(true);
        toast.message("Waiting for Microsoft code…", {
          description: "A login popup will open when the code is ready",
          duration: 15000,
        });
      }
      await refreshBots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
      setMsAuthWaiting(false);
    } finally {
      setLaunching(false);
    }
  };

  const stopBot = async (botId: string) => {
    setStoppingId(botId);
    try {
      const res = await fetch("/api/bots/mc/stop", {
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
      // Nuke: force-stop every MC job + hide stopped/error from Active list + wipe logs
      const res = await fetch("/api/bots/mc/clear-all", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Clear all failed");
      setConsoleEntries([]);
      setSelectedBotId(null);
      selectedBotIdRef.current = null;
      setMsAuth(null);
      setMsAuthWaiting(false);
      setRunningBots([]);
      toast.success("All MC bots nuked");
      await refreshBots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear all failed");
    } finally {
      setStoppingId(null);
    }
  };

  if (active === null) {
    return (
      <div className="space-y-6">
        <header className="flex items-end justify-between">
          <div className="space-y-2">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-8 w-20" />
        </header>
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
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
    <div className="space-y-6 animate-page-in">
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
      <div className="rounded-2xl animated-border bg-card/60 noise-texture">
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

            <div className="space-y-1.5">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                Recommended Servers
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { host: "donutsmp.net", label: "DonutSMP" },
                  { host: "catpvp.com", label: "CatPVP" },
                  { host: "hugosmp.com", label: "HugoSMP" },
                  { host: "minemen.club", label: "Minemen EU" },
                  { host: "na.mcpvp.club", label: "MCPVP NA" },
                  { host: "eu.mcpvp.club", label: "MCPVP EU" },
                ].map((s) => (
                  <button
                    key={s.host}
                    type="button"
                    onClick={() => setMcConfig({ ...mcConfig, serverHost: s.host })}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-mono transition-all duration-200 ${
                      mcConfig.serverHost === s.host
                        ? "bg-primary/15 border-primary/30 text-primary"
                        : "bg-background border-border/60 text-muted-foreground hover:border-primary/20 hover:text-foreground"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
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
                  {"error" in (pingResult ?? {}) && (
                    <span className="text-muted-foreground ml-1">
                      ({(pingResult as { error?: string }).error})
                    </span>
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
      <div className="rounded-2xl animated-border bg-card/60 noise-texture">
        <div className="p-4 border-b border-border/60 flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Minecraft Accounts
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            disabled={atLimit}
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed btn-premium"
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
                    <option value="ssid">SSID / access token (premium)</option>
                    <option value="microsoft">Microsoft account (device code)</option>
                    <option value="offline">Offline / Cracked (username only)</option>
                  </select>
                </label>
                {form.auth_type === "ssid" ? (
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-xs space-y-1 block">
                      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                        Minecraft access token (SSID)
                      </span>
                      <textarea
                        className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono min-h-[88px]"
                        value={form.ssid}
                        onChange={(e) => {
                          setSsidPreview(null);
                          setForm({ ...form, ssid: e.target.value });
                        }}
                        placeholder="Paste full Minecraft services access_token (eyJ… or long token)"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void checkSsid()}
                        disabled={ssidChecking || !form.ssid.trim()}
                        className="inline-flex items-center gap-1.5 rounded-full brutal-border bg-secondary/50 hover:bg-secondary px-4 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                      >
                        <Wifi className="h-3 w-3" />
                        {ssidChecking ? "Checking…" : "Validate token"}
                      </button>
                      {ssidPreview && (
                        <span className="text-[11px] font-mono text-primary">
                          {ssidPreview.username} · {ssidPreview.uuid.slice(0, 13)}…
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      We call Minecraft services to confirm the token, then store IGN + UUID.
                      Token is never shown in the bot console or account list.
                    </p>
                  </div>
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
                    {form.auth_type === "microsoft" && (
                      <span className="text-[10px] text-muted-foreground">
                        On launch, a Microsoft device-code popup appears — open the link and enter
                        the code.
                      </span>
                    )}
                  </label>
                )}
              </div>
              {error && <div className="text-xs text-destructive">{error}</div>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving || (form.auth_type === "ssid" && !form.ssid.trim())}
                  className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-xs font-semibold disabled:opacity-50 btn-premium"
                >
                  {saving ? "Saving..." : form.auth_type === "ssid" ? "Save SSID account" : "Save account"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setError(null);
                    setSsidPreview(null);
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
                botForAccount?.status === "running" || botForAccount?.status === "pending";
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
                      {a.auth_type.toUpperCase()}
                      {a.auth_type === "ssid" && (
                        <span className="text-muted-foreground/80">
                          {a.has_ssid ? " · token saved" : " · no token"}
                        </span>
                      )}{" "}
                      · {a.username || "hidden"}
                      {a.uuid ? (
                        <span className="font-mono text-[10px] opacity-70">
                          {" "}
                          · {a.uuid.replace(/-/g, "").slice(0, 8)}
                        </span>
                      ) : null}{" "}
                      ·{" "}
                      <span
                        className={
                          isRunning
                            ? "text-primary"
                            : a.status === "token_expired"
                              ? "text-destructive uppercase"
                              : "uppercase"
                        }
                      >
                        {isRunning ? "RUNNING" : a.status === "token_expired" ? "TOKEN EXPIRED" : a.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(a.auth_type === "ssid" || a.status === "token_expired") && !isRunning && (
                      <button
                        type="button"
                        onClick={() => {
                          setRefreshTarget(a);
                          setRefreshToken("");
                        }}
                        className="rounded-lg brutal-border bg-secondary/40 hover:bg-secondary px-3 py-2 text-[11px] font-semibold"
                        title="Paste a fresh Minecraft access token"
                      >
                        Refresh token
                      </button>
                    )}
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
                        disabled={
                          launching ||
                          !mcConfig.serverHost.trim() ||
                          (a.auth_type === "ssid" && a.status === "token_expired")
                        }
                        className="rounded-lg bg-primary/10 hover:bg-primary/20 text-primary px-3 py-2 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" /> Launch
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteId(a.id)}
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
        <div className="rounded-2xl animated-border bg-card/60 p-5 space-y-3 noise-texture">
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
                onClick={() => {
                  setConsoleEntries([]);
                  toast.success("Console cleared");
                }}
                className="text-xs rounded-full bg-secondary/60 hover:bg-secondary px-2.5 py-1 font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear All Consoles
              </button>
              <button
                onClick={() => setSelectedBotId(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
          </div>
          <BotConsole
            entries={consoleEntries}
            highlightBot={true}
            botPaused={activeBot?.status === "paused"}
            pauseDisabled={!selectedBotId || stoppingId === selectedBotId}
            onTogglePause={async () => {
              if (!selectedBotId) return;
              const pause = activeBot?.status !== "paused";
              try {
                const res = await fetch("/api/bots/mc/pause", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ botId: selectedBotId, pause }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || "Pause failed");
                toast.success(pause ? "Bot paused (still online)" : "Bot resumed");
                setConsoleEntries((prev) => [
                  ...prev,
                  {
                    ts: Date.now(),
                    level: "system",
                    msg: pause
                      ? "Bot PAUSED — messages stopped (stay online)."
                      : "Bot RESUMED — message loop active again.",
                  },
                ]);
                await refreshBots();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Pause failed");
              }
            }}
          />
        </div>
      )}

      {/* Running Bots Summary */}
      {runningBots.length > 0 && (
        <div className="rounded-2xl animated-border bg-card/60 p-5 space-y-3 noise-texture">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Active Bots</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setConsoleEntries([]);
                  toast.success("All consoles cleared");
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground px-3 py-1.5 text-xs font-semibold transition-all duration-200"
              >
                Clear All Consoles
              </button>
              <button
                onClick={stopAndClearAll}
                disabled={stoppingId !== null}
                className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 hover:bg-destructive/20 text-destructive px-3 py-1.5 text-xs font-semibold transition-all duration-200 disabled:opacity-50"
              >
                <Square className="h-3 w-3" /> Stop & Clear All
              </button>
            </div>
          </div>
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

      {/* Portal to body so parent overflow/transform cannot bury the modal */}
      {typeof document !== "undefined" &&
        (msAuth || msAuthWaiting) &&
        createPortal(
          <div
            className="fixed inset-0 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            style={{ zIndex: 2147483000 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ms-auth-title"
          >
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="space-y-1">
                <h2 id="ms-auth-title" className="text-lg font-semibold tracking-tight">
                  {msAuth ? "Microsoft login required" : "Waiting for Microsoft code…"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {msAuth
                    ? "Sign in before the bot can join the server."
                    : "Device code is being generated. Keep this page open."}
                </p>
              </div>

              {msAuth ? (
                <div className="space-y-3 text-sm">
                  <ol className="list-decimal list-inside space-y-2 text-foreground/90">
                    <li>
                      Open{" "}
                      <a
                        href={msAuth.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline font-mono break-all"
                      >
                        {msAuth.uri}
                      </a>
                    </li>
                    <li>
                      Enter this code:
                      <div className="mt-2 rounded-xl bg-primary/10 border border-primary/30 px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.25em] text-primary select-all">
                        {msAuth.code}
                      </div>
                    </li>
                    <li>Authorize the Microsoft account that owns Minecraft Java</li>
                  </ol>
                  <p className="text-xs text-muted-foreground">
                    Expires in about {msAuth.mins} minutes. Bot connects automatically after you authorize.
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setMsAuth(null);
                    setMsAuthWaiting(false);
                  }}
                  className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                >
                  Close
                </button>
                {msAuth && (
                  <button
                    type="button"
                    onClick={() => {
                      window.open(msAuth.uri, "_blank", "noopener,noreferrer");
                      navigator.clipboard?.writeText(msAuth.code).catch(() => {});
                      toast.success("Code copied — paste on Microsoft page");
                    }}
                    className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90"
                  >
                    Open login & copy code
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* SSID token refresh */}
      {typeof document !== "undefined" &&
        refreshTarget &&
        createPortal(
          <div
            className="fixed inset-0 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            style={{ zIndex: 2147483000 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ssid-refresh-title"
          >
            <form
              onSubmit={submitRefreshSsid}
              className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4"
            >
              <div className="space-y-1">
                <h2 id="ssid-refresh-title" className="text-lg font-semibold tracking-tight">
                  Refresh SSID token
                </h2>
                <p className="text-sm text-muted-foreground">
                  Paste a fresh Minecraft access token for{" "}
                  <span className="font-mono text-foreground">
                    {refreshTarget.username || refreshTarget.label}
                  </span>
                  . Profile is re-validated before save.
                </p>
              </div>
              <textarea
                className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono min-h-[96px]"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
                placeholder="Paste full Minecraft services access_token"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRefreshTarget(null);
                    setRefreshToken("");
                  }}
                  className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={refreshing || !refreshToken.trim()}
                  className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {refreshing ? "Validating…" : "Save token"}
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the account and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && remove(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
