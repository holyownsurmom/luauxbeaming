import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { ScrollText, RefreshCw, Filter } from "lucide-react";
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
  const eventSourceRef = useRef<EventSource | null>(null);

  const refreshBots = useCallback(async () => {
    try {
      const res = await fetch("/api/bots/all-status");
      const data = await res.json();
      if (data.bots) {
        setBots(data.bots);
      }
    } catch {
      /* ignore fetch errors */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBots();
    const t = setInterval(refreshBots, 5000);
    return () => clearInterval(t);
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
            { ts: data.ts, level: data.level, msg: data.msg },
          ]);
        }
      } catch {
        /* ignore parse errors */
      }
    };
    return () => es.close();
  }, []);

  const filteredLogs = allLogs.filter((l) => {
    if (levelFilter !== "all" && l.level !== levelFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6 animate-page-in">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-2 text-muted-foreground">
            Live console output from every active bot.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              refreshBots();
            }}
            className="inline-flex items-center gap-1.5 rounded-full brutal-border bg-secondary/40 hover:bg-secondary px-3 py-1.5 text-xs font-semibold"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Bot:</span>
        </div>
        <button
          onClick={() => setSelectedBot("all")}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            selectedBot === "all"
              ? "bg-primary text-primary-foreground"
              : "brutal-border bg-secondary/40 hover:bg-secondary"
          }`}
        >
          All ({bots.length})
        </button>
        {bots.map((b) => (
          <button
            key={b.id}
            onClick={() => setSelectedBot(b.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              selectedBot === b.id
                ? "bg-primary text-primary-foreground"
                : "brutal-border bg-secondary/40 hover:bg-secondary"
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
          <button
            onClick={() => setAllLogs([])}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
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
