import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { ScrollText, RefreshCw, Filter, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BotConsole, type ConsoleEntry } from "@/components/bot-console";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/dashboard/logs")({
  head: () => ({ meta: [{ title: "Logs — LuauX" }] }),
  component: LogsPage,
});

type BotInfo = {
  id: string;
  type: string;
  status: string;
  label: string;
};

function LogsPage() {
  const [allLogs, setAllLogs] = useState<ConsoleEntry[]>([]);
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [selectedBot, setSelectedBot] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [nuking, setNuking] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const refreshBots = useCallback(async () => {
    try {
      const res = await fetch("/api/bots/all-status");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Status ${res.status}`);
      }
      const data = await res.json();
      if (data.bots) {
        setBots(data.bots);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load bot status");
    } finally {
      setLoading(false);
    }
  }, []);

  const clearConsole = () => {
    setAllLogs([]);
    toast.success("Console cleared");
  };

  const removeAllBots = async () => {
    setNuking(true);
    try {
      const res = await fetch("/api/bots/clear-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "all" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Remove all failed");
      setAllLogs([]);
      setBots([]);
      setSelectedBot("all");
      toast.success("All bots stopped & removed");
      await refreshBots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove all failed");
    } finally {
      setNuking(false);
    }
  };

  useEffect(() => {
    refreshBots();
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshBots();
    };
    const t = setInterval(tick, 15000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshBots();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
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
        if (data.type === "log") {
          setAllLogs((prev) => [
            ...prev.slice(-999),
            {
              ts: data.ts,
              level: data.level,
              msg: data.msg,
              // stash bot id in msg prefix for filter (kept in separate field via cast)
              ...( { botId: data.botId || data.job_id } as object),
            } as ConsoleEntry & { botId?: string },
          ]);
        }
      } catch {
        /* ignore parse errors */
      }
    };
    return () => es.close();
  }, []);

  const filteredLogs = useMemo(() => {
    return allLogs.filter((l) => {
      if (levelFilter !== "all" && l.level !== levelFilter) return false;
      if (selectedBot !== "all") {
        const botId = (l as ConsoleEntry & { botId?: string }).botId;
        if (botId && botId !== selectedBot) return false;
        if (!botId) return false;
      }
      return true;
    });
  }, [allLogs, levelFilter, selectedBot]);

  return (
    <div className="space-y-6 animate-page-in">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl leading-relaxed">
            Live console output from every active bot — filter by bot or level.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={() => {
              refreshBots();
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 hover:bg-primary/5 hover:border-primary/25 px-3.5 py-1.5 text-xs font-semibold transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <button
            type="button"
            onClick={clearConsole}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 hover:bg-primary/5 hover:border-primary/25 px-3.5 py-1.5 text-xs font-semibold transition-colors"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={removeAllBots}
            disabled={nuking || bots.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 hover:bg-destructive/15 text-destructive px-3.5 py-1.5 text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            {nuking ? "Removing…" : "Stop all"}
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="flex items-center gap-2.5 flex-wrap rounded-2xl border border-border/50 bg-card/50 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            Bot
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSelectedBot("all")}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            selectedBot === "all"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "border border-border/60 bg-background/60 hover:bg-secondary"
          }`}
        >
          All ({bots.length})
        </button>
        {bots.map((b) => (
          <button
            type="button"
            key={b.id}
            onClick={() => setSelectedBot(b.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              selectedBot === b.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border/60 bg-background/60 hover:bg-secondary"
            }`}
          >
            {b.label}{" "}
            <span
              className={`ml-1 h-1.5 w-1.5 rounded-full inline-block ${
                b.status === "running"
                  ? "bg-primary"
                  : b.status === "pending"
                    ? "bg-amber-400"
                    : "bg-muted-foreground"
              }`}
            />
          </button>
        ))}

        <div className="ml-4 flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Level:</span>
        </div>
        {["all", "info", "warn", "error", "chat", "bot", "system"].map((lvl) => (
          <button
            key={lvl}
            onClick={() => setLevelFilter(lvl)}
            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
              levelFilter === lvl
                ? "bg-primary text-primary-foreground"
                : "brutal-border bg-secondary/40 hover:bg-secondary"
            }`}
          >
            {lvl}
          </button>
        ))}
      </div>

      {/* Console */}
      <div className="rounded-2xl brutal-border bg-card p-5 animated-border noise-texture relative overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-widest">Live Output</span>
            <span className="text-xs text-muted-foreground font-mono">
              {filteredLogs.length} entries
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearConsole}
              className="text-xs rounded-full bg-secondary/60 hover:bg-secondary px-3 py-1.5 font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear Console
            </button>
            <button
              onClick={removeAllBots}
              disabled={nuking}
              className="inline-flex items-center gap-1 text-xs rounded-full bg-destructive/15 hover:bg-destructive/25 text-destructive px-3 py-1.5 font-semibold disabled:opacity-50"
            >
              <Square className="h-3 w-3" />
              {nuking ? "Removing…" : "Stop & Remove All"}
            </button>
          </div>
        </div>
        {loading && allLogs.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-5/6" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : (
          <BotConsole entries={filteredLogs} maxHeight={600} highlightBot={true} />
        )}
      </div>
    </div>
  );
}
