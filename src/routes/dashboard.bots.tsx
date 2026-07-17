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
  Star,
  Bookmark,
  List,
} from "lucide-react";
import {
  BUILTIN_SERVERS,
  addUserServer,
  listLaunchPresets,
  listUserServers,
  removeLaunchPreset,
  removeUserServer,
  saveLaunchPreset,
  type McLaunchPreset,
  type McServerEntry,
} from "@/lib/mc-presets";
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
import {
  AdminBadge,
  BotField,
  BotPageHeader,
  BotPageShell,
  BotPanel,
  BotTabBar,
  BotWorkspace,
  DashButton,
  fieldControlClass,
  fieldMonoClass,
  PageShell,
} from "@/components/dashboard-ui";

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
  has_refresh_token?: boolean;
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
    auth_type: "microsoft",
    username: "",
    uuid: "",
    ssid: "",
    refresh_token: "",
  });
  const [ssidPreview, setSsidPreview] = useState<{
    username: string;
    uuid: string;
  } | null>(null);
  const [ssidChecking, setSsidChecking] = useState(false);
  const [refreshTarget, setRefreshTarget] = useState<Account | null>(null);
  const [refreshToken, setRefreshToken] = useState("");
  const [refreshMsaToken, setRefreshMsaToken] = useState("");
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
    autoReply: true,
    autoReplyMessages: "" as string,
    autoReplyCmd: "r" as "r" | "reply",
    autoReplyCooldownSec: "8",
  });
  const [mcTab, setMcTab] = useState<"launch" | "presets">("launch");
  const [userServers, setUserServers] = useState<McServerEntry[]>([]);
  const [launchPresets, setLaunchPresets] = useState<McLaunchPreset[]>([]);
  const [newServer, setNewServer] = useState({ label: "", host: "", port: "25565" });
  const [presetName, setPresetName] = useState("");
  const [launching, setLaunching] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const refreshMcPresets = useCallback(() => {
    setUserServers(listUserServers());
    setLaunchPresets(listLaunchPresets());
  }, []);

  useEffect(() => {
    refreshMcPresets();
    const on = () => refreshMcPresets();
    window.addEventListener("luaux-mc-presets", on);
    return () => window.removeEventListener("luaux-mc-presets", on);
  }, [refreshMcPresets]);

  const applyServer = (s: { host: string; port?: number }) => {
    setMcConfig((c) => ({
      ...c,
      serverHost: s.host,
      serverPort: String(s.port && s.port > 0 ? s.port : 25565),
    }));
    setMcTab("launch");
    toast.success(`Server set to ${s.host}`);
  };

  const applyPreset = (p: McLaunchPreset) => {
    setMcConfig((c) => ({
      ...c,
      serverHost: p.serverHost,
      serverPort: p.serverPort || "25565",
      messages: p.messages,
      interval: p.interval || "5",
      autoReply: p.autoReply ?? c.autoReply,
      autoReplyMessages: p.autoReplyMessages ?? c.autoReplyMessages,
      autoReplyCmd: p.autoReplyCmd === "reply" ? "reply" : "r",
      autoReplyCooldownSec: p.autoReplyCooldownSec || c.autoReplyCooldownSec,
    }));
    setMcTab("launch");
    toast.success(`Loaded “${p.name}”`);
  };

  const saveCurrentAsPreset = () => {
    if (!mcConfig.serverHost.trim()) {
      toast.error("Set a server first");
      return;
    }
    const name = presetName.trim() || `${mcConfig.serverHost} · ${new Date().toLocaleDateString()}`;
    saveLaunchPreset({
      name,
      serverHost: mcConfig.serverHost,
      serverPort: mcConfig.serverPort,
      messages: mcConfig.messages,
      interval: mcConfig.interval,
      autoReply: mcConfig.autoReply,
      autoReplyMessages: mcConfig.autoReplyMessages,
      autoReplyCmd: mcConfig.autoReplyCmd,
      autoReplyCooldownSec: mcConfig.autoReplyCooldownSec,
    });
    setPresetName("");
    refreshMcPresets();
    toast.success("Launch preset saved");
  };

  const addServerToList = () => {
    const host = newServer.host.trim();
    if (!host) {
      toast.error("Host required");
      return;
    }
    addUserServer({
      label: newServer.label.trim() || host,
      host,
      port: parseInt(newServer.port, 10) || 25565,
    });
    setNewServer({ label: "", host: "", port: "25565" });
    refreshMcPresets();
    toast.success("Server added to your list");
  };

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
    try {
      const p = (await fetchProfile()) as {
        active: boolean;
        isAdmin?: boolean;
        plan: { max_bots: number } | null;
        profile?: {
          bot_hours_remaining?: number;
          active_plan_id?: string | null;
          plan_expires_at?: string | null;
        } | null;
      };
      setIsAdmin(p.isAdmin ?? false);
      const bypass = adminBypassesPaywall(!!p.isAdmin);
      setActive(bypass ? true : p.active);
      const hours = Number(p.profile?.bot_hours_remaining ?? 0);
      const planActive =
        !!p.profile?.active_plan_id &&
        !!p.profile?.plan_expires_at &&
        new Date(p.profile.plan_expires_at).getTime() > Date.now();
      // Hours-only access: 1 concurrent bot (matches /api/bots/mc/start)
      setMaxBots(
        bypass ? 999 : planActive ? Math.max(1, Number(p.plan?.max_bots ?? 1)) : hours > 0 ? 1 : 0,
      );
      const a = ((await fetchAccounts()) as Account[]).filter((x) => x.auth_type !== "offline");
      setAccounts(a);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load accounts / plan");
    }
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

  const statusFailRef = useRef(0);
  const refreshBots = useCallback(async () => {
    try {
      const res = await fetch("/api/bots/mc/status");
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (data.bots) setRunningBots(data.bots);
      statusFailRef.current = 0;
    } catch {
      statusFailRef.current += 1;
      // Don't wipe list on transient errors; toast after repeated failures
      if (statusFailRef.current === 3) {
        toast.error("Can't refresh bot status — check connection / worker");
      }
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
        const ts = typeof data.ts === "number" ? data.ts : Date.now();
        if (ts > logPollSinceRef.current) logPollSinceRef.current = ts;
        handleMsAuthMessage(msg, botId);
        if (msg.startsWith("MS_AUTH_REQUIRED|")) return;
        if (botId && botId === selectedBotIdRef.current) {
          setConsoleEntries((prev) => {
            const key = `${Math.floor(ts / 1000)}|${data.level || "info"}|${msg}`;
            if (prev.some((p) => `${Math.floor(p.ts / 1000)}|${p.level}|${p.msg}` === key)) {
              return prev;
            }
            return [
              ...prev.slice(-499),
              { ts, level: data.level || "info", msg },
            ];
          });
        }
      } catch {
        /* ignore parse errors */
      }
    };
    es.onerror = () => {
      // Browser auto-reconnects EventSource; log poll remains backup
      console.warn("[bots] console stream disconnected — reconnecting…");
    };
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [handleMsAuthMessage]);

  // When switching bots, load recent logs immediately (don't wait for SSE)
  useEffect(() => {
    if (!selectedBotId) return;
    selectedBotIdRef.current = selectedBotId;
    logPollSinceRef.current = Date.now() - 10 * 60_000; // last 10 min
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({
          botId: selectedBotId,
          since: String(logPollSinceRef.current),
          limit: "200",
        });
        const res = await fetch(`/api/bots/logs?${qs.toString()}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const logs = (data.logs || []) as Array<{
          ts: number;
          msg: string;
          botId?: string;
          level?: string;
        }>;
        if (cancelled) return;
        const seen = new Set<string>();
        const entries: ConsoleEntry[] = [];
        for (const row of logs) {
          if (row.ts > logPollSinceRef.current) logPollSinceRef.current = row.ts;
          if (String(row.msg || "").startsWith("MS_AUTH_REQUIRED|")) {
            handleMsAuthMessage(String(row.msg || ""), row.botId);
            continue;
          }
          // Dedupe identical lines within same second (reconnect spam)
          const key = `${Math.floor(row.ts / 1000)}|${row.level}|${row.msg}`;
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push({
            ts: row.ts,
            level: (row.level as ConsoleEntry["level"]) || "info",
            msg: row.msg,
          });
        }
        if (entries.length) {
          entries.sort((a, b) => a.ts - b.ts);
          setConsoleEntries(entries.slice(-500));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedBotId, handleMsAuthMessage]);

  // Sparse backup poll only when SSE is dead (was 1.5s always — triple load with SSE)
  useEffect(() => {
    const poll = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (eventSourceRef.current?.readyState === EventSource.OPEN) return;
      try {
        const botId = selectedBotIdRef.current;
        if (!botId) return;
        const since = logPollSinceRef.current;
        const qs = new URLSearchParams({
          since: String(since),
          limit: "100",
          botId,
        });
        const res = await fetch(`/api/bots/logs?${qs.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        const logs = (data.logs || []) as Array<{
          ts: number;
          msg: string;
          botId?: string;
          level?: string;
        }>;
        if (!logs.length) return;
        const toAdd: ConsoleEntry[] = [];
        for (const row of logs) {
          if (row.ts > logPollSinceRef.current) logPollSinceRef.current = row.ts;
          handleMsAuthMessage(String(row.msg || ""), row.botId);
          if (
            !row.botId ||
            row.botId !== selectedBotIdRef.current ||
            String(row.msg || "").startsWith("MS_AUTH_REQUIRED|")
          ) {
            continue;
          }
          toAdd.push({
            ts: row.ts,
            level: (row.level as ConsoleEntry["level"]) || "info",
            msg: row.msg,
          });
        }
        if (!toAdd.length) return;
        setConsoleEntries((prev) => {
          const seen = new Set(
            prev.map((p) => `${Math.floor(p.ts / 1000)}|${p.level}|${p.msg}`),
          );
          const next = [...prev];
          let changed = false;
          for (const row of toAdd) {
            const key = `${Math.floor(row.ts / 1000)}|${row.level}|${row.msg}`;
            if (seen.has(key)) continue;
            seen.add(key);
            next.push(row);
            changed = true;
          }
          return changed ? next.slice(-500) : prev;
        });
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [handleMsAuthMessage, selectedBotId]);

  useEffect(() => {
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
    if (form.auth_type === "ssid" && !form.ssid.trim() && !form.refresh_token.trim())
      return setError("Minecraft access token (SSID) or MSA refresh_token required");
    if (form.auth_type === "microsoft" && !form.label.trim() && !form.username.trim())
      return setError("Label or Microsoft email required");
    setSaving(true);
    try {
      await addAcc({
        data: {
          label: form.label.trim() || form.username.trim() || "ms-account",
          auth_type: form.auth_type === "microsoft" ? "microsoft" : "ssid",
          username: form.username.trim() || undefined,
          uuid: form.uuid.trim() || undefined,
          ssid: form.auth_type === "ssid" ? form.ssid.trim() || undefined : undefined,
          refresh_token:
            form.auth_type === "ssid" ? form.refresh_token.trim() || undefined : undefined,
        },
      });
      toast.success(
        form.auth_type === "ssid"
          ? form.refresh_token.trim()
            ? "SSID saved — auto-refresh enabled"
            : "SSID validated and account saved"
          : "Microsoft account saved — complete device-code login on launch",
      );
      setForm({
        label: "",
        auth_type: "microsoft",
        username: "",
        uuid: "",
        ssid: "",
        refresh_token: "",
      });
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
    if (!refreshToken.trim() && !refreshMsaToken.trim()) {
      toast.error("Paste a fresh access_token and/or MSA refresh_token");
      return;
    }
    setRefreshing(true);
    try {
      const row = await refreshSsid({
        data: {
          id: refreshTarget.id,
          ssid: refreshToken.trim() || undefined,
          refresh_token: refreshMsaToken.trim() || undefined,
        },
      });
      toast.success(
        refreshMsaToken.trim()
          ? `Session updated — auto-refresh on · ${row.username || row.label}`
          : `Token refreshed — ${row.username || row.label}`,
      );
      setRefreshTarget(null);
      setRefreshToken("");
      setRefreshMsaToken("");
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
    const replyMsgs = mcConfig.autoReplyMessages
      .split("\n")
      .map((m) => m.trim())
      .filter(Boolean);

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
          serverPort: 25565,
          authType: account.auth_type,
          messages: msgs,
          interval: parseInt(mcConfig.interval, 10) || 5,
          autoReply: mcConfig.autoReply,
          autoReplyCmd: mcConfig.autoReplyCmd,
          autoReplyCooldownSec: parseInt(mcConfig.autoReplyCooldownSec, 10) || 8,
          ...(replyMsgs.length ? { autoReplyMessages: replyMsgs } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      setSelectedBotId(data.botId);
      selectedBotIdRef.current = data.botId;
      const isMsDevice = account.auth_type === "microsoft" && !account.has_ssid;
      setConsoleEntries([
        {
          ts: Date.now(),
          level: "system",
          msg: isMsDevice
            ? `Job ${String(data.botId).slice(0, 8)}… queued — waiting for Microsoft device code…`
            : `Job ${String(data.botId).slice(0, 8)}… queued — waiting for worker…`,
        },
      ]);
      logPollSinceRef.current = Date.now() - 60_000;
      msAuthCodeRef.current = null;
      if (isMsDevice) {
        setMsAuthWaiting(true);
        toast.message("Microsoft login starting…", {
          description: "Keep this tab open — a code popup appears in a few seconds",
          duration: 20000,
        });
      } else {
        setMsAuthWaiting(false);
        toast.success(`Launched ${account.label}`);
      }
      await refreshBots();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Launch failed";
      setError(msg);
      setMsAuthWaiting(false);
      if (/token|ssid|expired|refresh/i.test(msg)) {
        toast.error(msg, {
          description: "Open the account → Refresh Token and paste a fresh access_token",
        });
      }
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
        toast.error(typeof data.error === "string" ? data.error : `Stop failed (${res.status})`);
        return;
      }
      if (selectedBotId === botId) setSelectedBotId(null);
      if (msAuth?.botId === botId || selectedBotIdRef.current === botId) {
        setMsAuth(null);
        setMsAuthWaiting(false);
        msAuthCodeRef.current = null;
      }
      toast.success("Stop signal sent");
      await refreshBots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stop failed");
    } finally {
      setStoppingId(null);
    }
  };

  const cancelMicrosoftLogin = async () => {
    const botId = msAuth?.botId || selectedBotIdRef.current;
    setMsAuth(null);
    setMsAuthWaiting(false);
    msAuthCodeRef.current = null;
    if (botId) {
      await stopBot(botId);
      toast.message("Microsoft login cancelled", {
        description: "Bot job stopped. Launch again when ready.",
      });
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
      <div className="space-y-6 animate-page-in">
        <header>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
            MC Auto-Message
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl leading-relaxed">
            Deploy Minecraft bots that auto-message in any server.
          </p>
        </header>
        <div className="rounded-2xl border border-border/50 bg-card/70 px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
            <Lock className="h-5 w-5" />
          </div>
          <h2 className="font-display text-xl font-semibold tracking-tight">No plan or hours</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            Buy a plan or bot hours with crypto. Access unlocks after payment is confirmed and
            fulfilled (usually 1–2 minutes).
          </p>
          <Link
            to="/dashboard/purchase"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-xs font-semibold shadow-sm hover:bg-primary/90 transition-colors"
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
    <BotPageShell>
      <BotPageHeader
        title="Minecraft bots"
        description="Configure server, messages, and accounts — launch with live console."
        badge={isAdmin ? <AdminBadge /> : null}
        actions={
          <>
            <span className="text-xs tabular-nums text-muted-foreground">
              {accounts.length}/{maxBots} slots
            </span>
            {runningBots.some((b) =>
              ["pending", "running", "paused", "stopping"].includes(b.status),
            ) && (
              <DashButton
                variant="danger"
                size="sm"
                onClick={stopAndClearAll}
                disabled={stoppingId === "all"}
              >
                Stop all
              </DashButton>
            )}
          </>
        }
      />

      <BotWorkspace
        main={
          <>
      <BotPanel
        title="Server"
        subtitle={mcConfig.serverHost ? mcConfig.serverHost : "not set"}
      >
        <BotTabBar
          value={mcTab}
          onChange={(id) => setMcTab(id as "launch" | "presets")}
          tabs={[
            { id: "launch", label: "Setup" },
            { id: "presets", label: "Presets" },
          ]}
        />

        {mcTab === "launch" && (
          <>
            <BotField label="Server IP / host">
              <input
                className={fieldMonoClass}
                value={mcConfig.serverHost}
                onChange={(e) => setMcConfig({ ...mcConfig, serverHost: e.target.value })}
                placeholder="mc.hypixel.net"
              />
            </BotField>

            <div className="flex flex-wrap gap-1.5">
              {[...BUILTIN_SERVERS.slice(0, 6), ...userServers.slice(0, 4)].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => applyServer(s)}
                  className={`rounded-md border px-2 py-1 text-xs font-mono ${
                    mcConfig.serverHost === s.host
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <DashButton
                variant="secondary"
                size="sm"
                onClick={pingServer}
                disabled={pinging || !mcConfig.serverHost.trim()}
              >
                {pinging ? "Pinging…" : "Ping"}
              </DashButton>
              {pingResult && (
                <span className={`text-xs ${pingResult.online ? "text-primary" : "text-destructive"}`}>
                  {pingResult.online
                    ? `Online · ${pingResult.players?.online ?? "?"}/${pingResult.players?.max ?? "?"} · ${pingResult.latency ?? "?"}ms`
                    : "Offline"}
                </span>
              )}
            </div>

            <BotField label="Messages (one per line)">
              <textarea
                className={`${fieldMonoClass} resize-y min-h-[96px]`}
                rows={4}
                value={mcConfig.messages}
                onChange={(e) => setMcConfig({ ...mcConfig, messages: e.target.value })}
                placeholder={"gg everyone\n888 to join"}
              />
            </BotField>

            <div className="flex flex-wrap items-end gap-3">
              <BotField label="Interval (sec)">
                <input
                  type="number"
                  min="1"
                  className={`${fieldMonoClass} w-28`}
                  value={mcConfig.interval}
                  onChange={(e) => setMcConfig({ ...mcConfig, interval: e.target.value })}
                />
              </BotField>
              <div className="flex gap-2 flex-1 min-w-[180px]">
                <input
                  className={fieldControlClass}
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Preset name"
                />
                <DashButton variant="secondary" size="sm" onClick={saveCurrentAsPreset}>
                  Save
                </DashButton>
              </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-card/40 p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-border"
                  checked={mcConfig.autoReply}
                  onChange={(e) => setMcConfig({ ...mcConfig, autoReply: e.target.checked })}
                />
                Auto-reply to whispers / DMs
              </label>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Replies only to the <strong>last DM / whisper</strong> with{" "}
                <span className="font-mono text-foreground/80">/{mcConfig.autoReplyCmd}</span>.
                Older DMs are ignored until they message again. Uses reply lines below, or chat
                messages if empty.
              </p>
              {mcConfig.autoReply && (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <BotField label="Reply command">
                      <select
                        className={`${fieldMonoClass} w-32`}
                        value={mcConfig.autoReplyCmd}
                        onChange={(e) =>
                          setMcConfig({
                            ...mcConfig,
                            autoReplyCmd: e.target.value === "reply" ? "reply" : "r",
                          })
                        }
                      >
                        <option value="r">/r</option>
                        <option value="reply">/reply</option>
                      </select>
                    </BotField>
                    <BotField label="Cooldown (sec)">
                      <input
                        type="number"
                        min="3"
                        max="120"
                        className={`${fieldMonoClass} w-28`}
                        value={mcConfig.autoReplyCooldownSec}
                        onChange={(e) =>
                          setMcConfig({ ...mcConfig, autoReplyCooldownSec: e.target.value })
                        }
                      />
                    </BotField>
                  </div>
                  <BotField label="Reply messages (optional, one per line)">
                    <textarea
                      className={`${fieldMonoClass} resize-y min-h-[72px]`}
                      rows={3}
                      value={mcConfig.autoReplyMessages}
                      onChange={(e) =>
                        setMcConfig({ ...mcConfig, autoReplyMessages: e.target.value })
                      }
                      placeholder={"ty for the msg\nwhats up?"}
                    />
                  </BotField>
                </>
              )}
            </div>
          </>
        )}

        {mcTab === "presets" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Popular</div>
              <div className="grid sm:grid-cols-2 gap-1.5">
                {BUILTIN_SERVERS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => applyServer(s)}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-secondary/50"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{s.label}</div>
                      <div className="text-xs font-mono text-muted-foreground truncate">
                        {s.host}
                      </div>
                    </div>
                    <span className="text-xs text-primary shrink-0">Use</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Your servers</div>
              <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
                <input
                  className={fieldControlClass}
                  placeholder="Label"
                  value={newServer.label}
                  onChange={(e) => setNewServer({ ...newServer, label: e.target.value })}
                />
                <input
                  className={fieldMonoClass}
                  placeholder="host"
                  value={newServer.host}
                  onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                />
                <DashButton size="sm" onClick={addServerToList}>
                  Add
                </DashButton>
              </div>
                  {userServers.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No custom servers yet. Add hosts you use often.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {userServers.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-border/40 px-3 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => applyServer(s)}
                            className="text-left min-w-0 flex-1 hover:text-primary"
                          >
                            <div className="text-sm font-medium truncate">{s.label}</div>
                            <div className="text-[11px] font-mono text-muted-foreground truncate">
                              {s.host}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              removeUserServer(s.id);
                              refreshMcPresets();
                            }}
                            className="text-destructive/80 hover:text-destructive p-1"
                            aria-label="Remove server"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Saved presets</div>
              {launchPresets.length === 0 ? (
                <p className="text-xs text-muted-foreground">None yet. Save from Setup tab.</p>
              ) : (
                <div className="space-y-1">
                  {launchPresets.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => applyPreset(p)}
                        className="text-left min-w-0 flex-1 hover:text-primary"
                      >
                        <div className="text-sm font-medium truncate">{p.name}</div>
                        <div className="text-xs font-mono text-muted-foreground truncate">
                          {p.serverHost} · {p.interval}s
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          removeLaunchPreset(p.id);
                          refreshMcPresets();
                        }}
                        className="text-destructive p-1"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </BotPanel>

      <BotPanel
        title="Accounts"
        subtitle={`${accounts.length} / ${maxBots}`}
        actions={
          <DashButton size="sm" onClick={() => setShowForm(!showForm)} disabled={atLimit}>
            {atLimit ? "Full" : "Add"}
          </DashButton>
        }
        bodyClassName="!p-0 !space-y-0"
      >

        {showForm && (
          <div className="p-4 border-b border-border/60 bg-secondary/20">
            <form onSubmit={submit} className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                    Label
                  </span>
                  <input
                    className={fieldMonoClass}
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
                    className={fieldControlClass}
                    value={form.auth_type}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        auth_type: e.target.value === "ssid" ? "ssid" : "microsoft",
                      })
                    }
                  >
                    <option value="microsoft">Microsoft (device code)</option>
                    <option value="ssid">SSID / access token (premium)</option>
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
                    <label className="text-xs space-y-1 block">
                      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                        MSA refresh token (optional)
                      </span>
                      <textarea
                        className="w-full rounded-xl border border-border/60 bg-background/80 px-3.5 py-2.5 text-sm font-mono min-h-[72px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                        value={form.refresh_token}
                        onChange={(e) => setForm({ ...form, refresh_token: e.target.value })}
                        placeholder="Optional — Microsoft refresh_token for automatic session keep-alive"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Prefer Microsoft device-code if you do not have a token. SSID is for advanced
                      users who already have a Minecraft access_token.
                    </p>
                  </div>
                ) : (
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-xs space-y-1 block">
                      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                        Microsoft email / username (optional)
                      </span>
                      <input
                        className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                        value={form.username}
                        onChange={(e) => setForm({ ...form, username: e.target.value })}
                        placeholder="you@outlook.com"
                        autoComplete="off"
                      />
                    </label>
                    <p className="text-[10px] text-muted-foreground leading-relaxed rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                      On <strong>Launch</strong>, a Microsoft device-code popup appears. Open{" "}
                      <span className="font-mono">microsoft.com/link</span>, enter the code, and
                      approve. The worker caches the session for reconnects.
                    </p>
                  </div>
                )}
              </div>
              {error && <div className="text-xs text-destructive">{error}</div>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={
                    saving ||
                    (form.auth_type === "ssid" && !form.ssid.trim() && !form.refresh_token.trim())
                  }
                  className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-xs font-semibold disabled:opacity-50 btn-premium"
                >
                  {saving
                    ? "Saving..."
                    : form.auth_type === "ssid"
                      ? "Save SSID account"
                      : "Save Microsoft account"}
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
              const isRunning = ["running", "pending", "paused", "stopping"].includes(
                botForAccount?.status || "",
              );
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
                          {a.has_refresh_token ? " · auto-refresh" : ""}
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
                  : "Select a bot"
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
              bodyClassName="!pt-3"
            >
              {selectedBotId ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-2 w-2 rounded-full ${activeBot?.status === "running" ? "bg-primary animate-pulse" : "bg-muted-foreground"}`}
                      />
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {activeBot?.status || "idle"}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {consoleEntries.length} lines
                      </span>
                    </div>
                    <DashButton variant="ghost" size="sm" onClick={() => setConsoleEntries([])}>
                      Clear
                    </DashButton>
                  </div>
                  <BotConsole
                    entries={consoleEntries}
                    maxHeight={420}
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
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
                  <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Launch a bot or open Console on an active job to stream logs here.
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
                          className={`h-2 w-2 shrink-0 rounded-full ${bot.status === "running" ? "bg-primary animate-pulse" : "bg-amber-400"}`}
                        />
                        <span className="text-sm font-medium truncate">{bot.label}</span>
                        <span className="text-xs text-muted-foreground capitalize">
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
                          className="text-xs font-medium text-primary hover:underline"
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
          </>
        }
      />

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
                    <li className="text-muted-foreground">
                      Keep this tab open — the bot connects automatically after you approve
                    </li>
                  </ol>
                  <p className="text-xs text-muted-foreground">
                    Code expires in about {msAuth.mins} minutes. If it times out, stop the bot and launch again.
                  </p>
                </div>
              ) : (
                <div className="space-y-4 py-4">
                  <div className="flex items-center justify-center">
                    <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  </div>
                  <ol className="text-xs text-muted-foreground space-y-2 max-w-sm mx-auto">
                    <li className="flex gap-2">
                      <span className="text-primary font-semibold">1.</span>
                      Worker claimed your job
                    </li>
                    <li className="flex gap-2">
                      <span className="text-primary font-semibold">2.</span>
                      Generating Microsoft device code…
                    </li>
                    <li className="flex gap-2">
                      <span className="text-primary font-semibold">3.</span>
                      Popup will show the link + code next
                    </li>
                  </ol>
                  <p className="text-center text-[11px] text-muted-foreground">
                    Usually takes 5–20 seconds. Do not close this page.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    const id = msAuth?.botId || selectedBotIdRef.current;
                    setMsAuth(null);
                    setMsAuthWaiting(false);
                    if (id) {
                      toast.message("Stopping Microsoft login…");
                      await stopBot(id);
                    }
                  }}
                  className="rounded-full px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
                >
                  Cancel login
                </button>
                {msAuth && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(msAuth.code).catch(() => {});
                        toast.success("Code copied");
                      }}
                      className="rounded-full border border-border/60 px-4 py-2 text-sm font-semibold hover:bg-secondary/60"
                    >
                      Copy code
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        window.open(msAuth.uri, "_blank", "noopener,noreferrer");
                        navigator.clipboard?.writeText(msAuth.code).catch(() => {});
                        toast.success("Opened Microsoft — code copied");
                      }}
                      className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90"
                    >
                      Open login & copy code
                    </button>
                  </>
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
                  Refresh session tokens
                </h2>
                <p className="text-sm text-muted-foreground">
                  Update tokens for{" "}
                  <span className="font-mono text-foreground">
                    {refreshTarget.username || refreshTarget.label}
                  </span>
                  . Access token is required unless you only update the optional MSA refresh token
                  (and one is already stored).
                  {refreshTarget.has_refresh_token ? (
                    <span className="block mt-1 text-primary/90 text-xs">
                      Auto-refresh is currently enabled on this account.
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Access token (SSID)
                </span>
                <textarea
                  className="w-full rounded-xl border border-border/60 bg-background/80 px-3.5 py-2.5 text-sm font-mono min-h-[88px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  placeholder="Minecraft services access_token (optional if refresh_token can mint one)"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  MSA refresh token (optional)
                </span>
                <textarea
                  className="w-full rounded-xl border border-border/60 bg-background/80 px-3.5 py-2.5 text-sm font-mono min-h-[72px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  value={refreshMsaToken}
                  onChange={(e) => setRefreshMsaToken(e.target.value)}
                  placeholder="Microsoft refresh_token — enables automatic renewals"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRefreshTarget(null);
                    setRefreshToken("");
                    setRefreshMsaToken("");
                  }}
                  className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={refreshing || (!refreshToken.trim() && !refreshMsaToken.trim())}
                  className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {refreshing ? "Validating…" : "Save tokens"}
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
    </BotPageShell>
  );
}
