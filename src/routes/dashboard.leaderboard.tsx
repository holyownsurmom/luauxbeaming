import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  Medal,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  Trophy,
  Minus,
  Sparkles,
} from "lucide-react";
import { getLeaderboardBoard } from "@/lib/luaux.functions";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DashButton,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  Surface,
} from "@/components/dashboard-ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/leaderboard")({
  head: () => ({ meta: [{ title: "Leaderboard — LuauX" }] }),
  component: LeaderboardPage,
});

type Period = "24h" | "7d" | "month" | "lifetime";

type Entry = {
  rank: number;
  discordId: string;
  username: string;
  total: number;
  successRate: number | null;
  lastActive: string | null;
  trend: "up" | "down" | "same" | "new";
  badge: "gold" | "silver" | "bronze" | null;
  isYou: boolean;
};

type Board = {
  period: Period;
  entries: Entry[];
  totalUsers: number;
  page: number;
  pageSize: number;
  stats: {
    accountsToday: number;
    accountsWeek: number;
    accountsMonth: number;
    lifetimeTotal: number;
    averagePerHour: number;
    averagePerDay: number;
    highestDaily: number;
    highestDailyDate: string | null;
    topUser: { username: string; total: number } | null;
    overallSuccessRate: number | null;
  };
  you: Entry | null;
  generatedAt: string;
};

const PERIODS: { id: Period; label: string }[] = [
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
  { id: "month", label: "This month" },
  { id: "lifetime", label: "Lifetime" },
];

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function TrendIcon({ trend }: { trend: Entry["trend"] }) {
  if (trend === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
  if (trend === "down") return <TrendingDown className="h-3.5 w-3.5 text-destructive" />;
  if (trend === "new") return <Sparkles className="h-3.5 w-3.5 text-primary" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground/50" />;
}

function RankMedal({ rank, badge }: { rank: number; badge: Entry["badge"] }) {
  if (badge === "gold" || rank === 1) {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-400/20 text-amber-500 border border-amber-400/40 shadow-[0_0_16px_rgba(251,191,36,0.25)]">
        <Crown className="h-4 w-4" />
      </span>
    );
  }
  if (badge === "silver" || rank === 2) {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-300/15 text-zinc-300 border border-zinc-400/40">
        <Medal className="h-4 w-4" />
      </span>
    );
  }
  if (badge === "bronze" || rank === 3) {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/35">
        <Medal className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary/60 text-xs font-mono font-semibold text-muted-foreground">
      {rank}
    </span>
  );
}

function LeaderboardPage() {
  const fetchBoard = useServerFn(getLeaderboardBoard);
  const [period, setPeriod] = useState<Period>("7d");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchBoard({
      data: { period, page, pageSize: 25, search: search || undefined },
    })
      .then((d) => setBoard(d as Board))
      .catch((e) => {
        setBoard(null);
        setError(e instanceof Error ? e.message : "Failed to load leaderboard");
      })
      .finally(() => setLoading(false));
  }, [fetchBoard, period, page, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Soft live poll every 30s
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const totalPages = board ? Math.max(1, Math.ceil(board.totalUsers / board.pageSize)) : 1;

  return (
    <PageShell>
      <PageHeader
        title="Leaderboard"
        description="Global ranking by successful secured accounts — live periods, trends, and stats."
        actions={
          <DashButton type="button" variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </DashButton>
        }
      />

      {/* Period tabs */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setPeriod(p.id);
              setPage(1);
            }}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-semibold transition-all",
              period === p.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border/60 bg-card/70 text-muted-foreground hover:text-foreground hover:border-primary/25",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      {loading && !board ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : board ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Today" value={board.stats.accountsToday} />
          <StatCard label="This week" value={board.stats.accountsWeek} />
          <StatCard label="This month" value={board.stats.accountsMonth} />
          <StatCard label="Lifetime" value={board.stats.lifetimeTotal} />
          <StatCard label="Avg / hour" value={board.stats.averagePerHour} decimals />
          <StatCard label="Avg / day" value={board.stats.averagePerDay} decimals />
          <StatCard
            label="Best day"
            value={board.stats.highestDaily}
            hint={board.stats.highestDailyDate || undefined}
          />
          <StatCard
            label="Top user"
            value={board.stats.topUser?.total ?? 0}
            hint={board.stats.topUser?.username || "—"}
          />
        </div>
      ) : null}

      {/* Your rank */}
      {board?.you && (
        <Surface padded className="border-primary/25 bg-primary/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <RankMedal rank={board.you.rank} badge={board.you.badge} />
              <div>
                <div className="text-[10px] uppercase tracking-widest text-primary font-semibold">
                  Your rank
                </div>
                <div className="font-display text-lg font-semibold">
                  #{board.you.rank} · {board.you.username}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-right">
                <div className="font-mono font-semibold text-primary">{board.you.total}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  accounts
                </div>
              </div>
              <TrendIcon trend={board.you.trend} />
            </div>
          </div>
        </Surface>
      )}

      {/* Search + table */}
      <Surface className="overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b border-border/50">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              className="w-full rounded-xl border border-border/60 bg-background/80 pl-9 pr-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              placeholder="Search username…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSearch(searchDraft.trim());
                  setPage(1);
                }
              }}
            />
          </div>
          <DashButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch(searchDraft.trim());
              setPage(1);
            }}
          >
            Search
          </DashButton>
        </div>

        {error ? (
          <ErrorState title="Could not load leaderboard" message={error} onRetry={load} />
        ) : loading && !board ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : board && board.entries.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="No rankings yet"
            description="Successful secured accounts will appear here. Complete a verification to climb the board."
          />
        ) : board ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm hidden md:table">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/40 sticky top-0">
                  <tr>
                    <th className="text-left px-5 py-3.5 font-semibold">Rank</th>
                    <th className="text-left px-5 py-3.5 font-semibold">User</th>
                    <th className="text-right px-5 py-3.5 font-semibold">Accounts</th>
                    <th className="text-right px-5 py-3.5 font-semibold">Last active</th>
                    <th className="text-center px-5 py-3.5 font-semibold">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {board.entries.map((e) => (
                    <tr
                      key={e.discordId}
                      className={cn(
                        "transition-colors",
                        e.isYou ? "bg-primary/8" : "hover:bg-primary/[0.03]",
                        e.rank === 1 && "bg-amber-400/[0.04]",
                        e.rank === 2 && "bg-zinc-400/[0.03]",
                        e.rank === 3 && "bg-orange-500/[0.03]",
                      )}
                    >
                      <td className="px-5 py-3">
                        <RankMedal rank={e.rank} badge={e.badge} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium">
                          {e.username}
                          {e.isYou ? (
                            <span className="ml-2 text-[10px] uppercase tracking-widest text-primary font-semibold">
                              you
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-semibold">{e.total}</td>
                      <td className="px-5 py-3 text-right text-xs text-muted-foreground">
                        {formatRelative(e.lastActive)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-center">
                          <TrendIcon trend={e.trend} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border/50">
              {board.entries.map((e) => (
                <div
                  key={e.discordId}
                  className={cn("p-4 flex items-center gap-3", e.isYou && "bg-primary/8")}
                >
                  <RankMedal rank={e.rank} badge={e.badge} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {e.username}
                      {e.isYou ? " · you" : ""}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatRelative(e.lastActive)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-semibold">{e.total}</div>
                    <TrendIcon trend={e.trend} />
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border/50">
              <div className="text-[11px] text-muted-foreground">
                {board.totalUsers} ranked · page {board.page}/{totalPages}
                {board.generatedAt ? (
                  <span className="hidden sm:inline">
                    {" "}
                    · updated {formatRelative(board.generatedAt)}
                  </span>
                ) : null}
              </div>
              <div className="flex gap-2">
                <DashButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </DashButton>
                <DashButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </DashButton>
              </div>
            </div>
          </>
        ) : null}
      </Surface>
    </PageShell>
  );
}

function StatCard({
  label,
  value,
  hint,
  decimals,
}: {
  label: string;
  value: number;
  hint?: string;
  decimals?: boolean;
}) {
  return (
    <Surface padded className="!p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tracking-tight">
        {decimals ? Number(value).toFixed(2) : value.toLocaleString()}
      </div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground truncate">{hint}</div> : null}
    </Surface>
  );
}
