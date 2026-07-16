/**
 * Global leaderboard: ranks users by successful secured accounts.
 * Periods: 24h / 7d / month / lifetime.
 */

import {
  buildContextFromEvents,
  evaluateAchievements,
  pickRowBadgeIds,
  type AchievementId,
  type AchievementStatus,
} from "./leaderboard-achievements.server";

export type LeaderboardPeriod = "24h" | "7d" | "month" | "lifetime";

export type LeaderboardEntry = {
  rank: number;
  discordId: string;
  username: string;
  total: number;
  successRate: number | null;
  lastActive: string | null;
  trend: "up" | "down" | "same" | "new";
  badge: "gold" | "silver" | "bronze" | null;
  isYou: boolean;
  achievementIds: AchievementId[];
};

export type LeaderboardStats = {
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

export type LeaderboardResult = {
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  totalUsers: number;
  page: number;
  pageSize: number;
  stats: LeaderboardStats;
  you: LeaderboardEntry | null;
  youAchievements: AchievementStatus[];
  generatedAt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

const cache = new Map<string, { at: number; data: LeaderboardResult }>();
const CACHE_MS = 20_000;

function periodSince(period: LeaderboardPeriod): Date | null {
  const now = Date.now();
  if (period === "24h") return new Date(now - 24 * 60 * 60_000);
  if (period === "7d") return new Date(now - 7 * 24 * 60 * 60_000);
  if (period === "month") {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }
  return null;
}

function previousWindow(period: LeaderboardPeriod): { start: Date; end: Date } | null {
  const now = Date.now();
  if (period === "24h") {
    return { start: new Date(now - 48 * 60 * 60_000), end: new Date(now - 24 * 60 * 60_000) };
  }
  if (period === "7d") {
    return { start: new Date(now - 14 * 24 * 60 * 60_000), end: new Date(now - 7 * 24 * 60 * 60_000) };
  }
  if (period === "month") {
    const d = new Date();
    const startThis = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const startPrev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    return { start: startPrev, end: startThis };
  }
  return null;
}

export async function recordLeaderboardSecured(
  db: Db,
  opts: { discordId: string; username: string; sourceId?: string | null },
): Promise<void> {
  try {
    const rpcRes = await db.rpc("record_leaderboard_event", {
      p_discord_id: opts.discordId,
      p_username: opts.username || "Unknown",
      p_source_id: opts.sourceId || null,
      p_event_type: "secured",
    });
    const error = rpcRes?.error as { message: string } | null | undefined;
    if (error) {
      // Fallback insert if RPC missing
      console.warn("[leaderboard] RPC failed, fallback insert:", error.message);
      const { error: insErr } = await db.from("leaderboard_events").insert({
        discord_id: opts.discordId,
        username: opts.username || "Unknown",
        event_type: "secured",
        source_id: opts.sourceId || null,
      });
      if (insErr && !/duplicate|unique/i.test(insErr.message)) {
        console.error("[leaderboard] fallback insert failed:", insErr.message);
      }
    }
    // bust cache
    cache.clear();
  } catch (e) {
    console.error("[leaderboard] record failed:", e);
  }
}

export async function getLeaderboard(
  db: Db,
  opts: {
    period: LeaderboardPeriod;
    page?: number;
    pageSize?: number;
    search?: string;
    viewerDiscordId?: string | null;
  },
): Promise<LeaderboardResult> {
  const period = opts.period;
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(50, Math.max(5, opts.pageSize || 25));
  const search = (opts.search || "").trim().toLowerCase();
  const cacheKey = `${period}:${page}:${pageSize}:${search}:${opts.viewerDiscordId || ""}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const since = periodSince(period);
  let q = db
    .from("leaderboard_events")
    .select("discord_id, username, created_at");
  if (since) q = q.gte("created_at", since.toISOString());

  const { data: rows, error } = await q.limit(50_000);
  if (error) throw new Error(error.message);

  type Agg = {
    discordId: string;
    username: string;
    total: number;
    lastActive: string | null;
  };
  const map = new Map<string, Agg>();
  for (const r of rows || []) {
    const id = String(r.discord_id);
    const prev = map.get(id);
    const created = r.created_at as string;
    if (!prev) {
      map.set(id, {
        discordId: id,
        username: String(r.username || "Unknown"),
        total: 1,
        lastActive: created,
      });
    } else {
      prev.total += 1;
      if (!prev.lastActive || created > prev.lastActive) {
        prev.lastActive = created;
        prev.username = String(r.username || prev.username);
      }
    }
  }

  // Previous period totals for trend
  const prevWin = previousWindow(period);
  const prevTotals = new Map<string, number>();
  if (prevWin) {
    const { data: prevRows } = await db
      .from("leaderboard_events")
      .select("discord_id")
      .gte("created_at", prevWin.start.toISOString())
      .lt("created_at", prevWin.end.toISOString())
      .limit(50_000);
    for (const r of prevRows || []) {
      const id = String(r.discord_id);
      prevTotals.set(id, (prevTotals.get(id) || 0) + 1);
    }
  }

  let list = [...map.values()];
  if (search) {
    list = list.filter(
      (e) =>
        e.username.toLowerCase().includes(search) ||
        e.discordId.includes(search),
    );
  }
  list.sort((a, b) => b.total - a.total || (b.lastActive || "").localeCompare(a.lastActive || ""));

  const totalUsers = list.length;
  const start = (page - 1) * pageSize;
  const slice = list.slice(start, start + pageSize);

  const makeTrend = (discordId: string, total: number): LeaderboardEntry["trend"] => {
    if (!prevWin) return "same";
    const prev = prevTotals.get(discordId) || 0;
    if (prev === 0 && total > 0) return "new";
    if (total > prev) return "up";
    if (total < prev) return "down";
    return "same";
  };

  // Cross-period ranks for achievement badges (viewer + cheap row badges)
  const rankMaps = await loadCrossPeriodRanks(db);

  const rowAchievements = (
    discordId: string,
    rank: number,
    total: number,
    trend: LeaderboardEntry["trend"],
  ): AchievementId[] => {
    // Cheap row badges — full milestones only when viewing lifetime period
    const ctx = {
      lifetimeTotal: period === "lifetime" ? total : 0,
      last24hTotal: period === "24h" ? total : 0,
      streakDays: 0,
      rank24h: period === "24h" ? rank : (rankMaps.r24.get(discordId) ?? null),
      rank7d: period === "7d" ? rank : (rankMaps.r7.get(discordId) ?? null),
      rankMonth: period === "month" ? rank : (rankMaps.rMonth.get(discordId) ?? null),
      trend,
      periodTotal: total,
    };
    return pickRowBadgeIds(evaluateAchievements(ctx), 2);
  };

  const entries: LeaderboardEntry[] = slice.map((e, i) => {
    const rank = start + i + 1;
    const trend = makeTrend(e.discordId, e.total);
    return {
      rank,
      discordId: e.discordId,
      username: e.username,
      total: e.total,
      successRate: null,
      lastActive: e.lastActive,
      trend,
      badge: rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : null,
      isYou: !!opts.viewerDiscordId && e.discordId === opts.viewerDiscordId,
      achievementIds: rowAchievements(e.discordId, rank, e.total, trend),
    };
  });

  let you: LeaderboardEntry | null = null;
  let youAchievements: AchievementStatus[] = [];
  if (opts.viewerDiscordId) {
    const idx = list.findIndex((e) => e.discordId === opts.viewerDiscordId);
    const viewerId = opts.viewerDiscordId;
    const { data: myEvents } = await db
      .from("leaderboard_events")
      .select("created_at")
      .eq("discord_id", viewerId)
      .order("created_at", { ascending: false })
      .limit(10_000);
    const eventIsos = (myEvents || []).map((r: { created_at: string }) => String(r.created_at));

    const periodTotal = idx >= 0 ? list[idx]!.total : 0;
    const periodRank = idx >= 0 ? idx + 1 : null;
    const trend = idx >= 0 ? makeTrend(viewerId, periodTotal) : null;

    const ctx = buildContextFromEvents(eventIsos, {
      rank24h: period === "24h" ? periodRank : (rankMaps.r24.get(viewerId) ?? null),
      rank7d: period === "7d" ? periodRank : (rankMaps.r7.get(viewerId) ?? null),
      rankMonth: period === "month" ? periodRank : (rankMaps.rMonth.get(viewerId) ?? null),
      trend,
      periodTotal,
    });
    youAchievements = evaluateAchievements(ctx);

    if (idx >= 0) {
      const e = list[idx]!;
      you = {
        rank: idx + 1,
        discordId: e.discordId,
        username: e.username,
        total: e.total,
        successRate: null,
        lastActive: e.lastActive,
        trend: trend || "same",
        badge: idx === 0 ? "gold" : idx === 1 ? "silver" : idx === 2 ? "bronze" : null,
        isYou: true,
        achievementIds: pickRowBadgeIds(youAchievements, 3),
      };
    }
  }

  const stats = await buildStats(db, list);

  const result: LeaderboardResult = {
    period,
    entries,
    totalUsers,
    page,
    pageSize,
    stats,
    you,
    youAchievements,
    generatedAt: new Date().toISOString(),
  };
  cache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}

/** Build discordId → rank maps for 24h / 7d / month (for achievement badges) */
async function loadCrossPeriodRanks(
  db: Db,
): Promise<{ r24: Map<string, number>; r7: Map<string, number>; rMonth: Map<string, number> }> {
  const rankFromSince = async (since: Date | null): Promise<Map<string, number>> => {
    let q = db.from("leaderboard_events").select("discord_id");
    if (since) q = q.gte("created_at", since.toISOString());
    const { data: rows } = await q.limit(50_000);
    const totals = new Map<string, number>();
    for (const r of rows || []) {
      const id = String(r.discord_id);
      totals.set(id, (totals.get(id) || 0) + 1);
    }
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const ranks = new Map<string, number>();
    sorted.forEach(([id], i) => ranks.set(id, i + 1));
    return ranks;
  };

  const [r24, r7, rMonth] = await Promise.all([
    rankFromSince(periodSince("24h")),
    rankFromSince(periodSince("7d")),
    rankFromSince(periodSince("month")),
  ]);
  return { r24, r7, rMonth };
}

async function buildStats(db: Db, periodList: { total: number; username: string }[]): Promise<LeaderboardStats> {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60_000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
  const monthStart = new Date();
  const monthIso = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1),
  ).toISOString();

  const countSince = async (iso: string) => {
    const { count, error } = await db
      .from("leaderboard_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", iso);
    if (error) return 0;
    return count ?? 0;
  };

  const [accountsToday, accountsWeek, accountsMonth, lifetimeRes] = await Promise.all([
    countSince(dayAgo),
    countSince(weekAgo),
    countSince(monthIso),
    db.from("leaderboard_events").select("id", { count: "exact", head: true }),
  ]);

  const lifetimeTotal = lifetimeRes.count ?? 0;

  // Highest daily from daily_totals, fallback compute
  let highestDaily = 0;
  let highestDailyDate: string | null = null;
  const { data: daily } = await db
    .from("leaderboard_daily_totals")
    .select("day, total")
    .order("total", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (daily) {
    highestDaily = Number(daily.total) || 0;
    highestDailyDate = String(daily.day);
  }

  const top = periodList[0];
  const firstEvent = await db
    .from("leaderboard_events")
    .select("created_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  let averagePerDay = 0;
  let averagePerHour = 0;
  if (firstEvent.data?.created_at && lifetimeTotal > 0) {
    const hours = Math.max(
      1,
      (now - new Date(firstEvent.data.created_at).getTime()) / 3_600_000,
    );
    averagePerHour = Number((lifetimeTotal / hours).toFixed(2));
    averagePerDay = Number((lifetimeTotal / (hours / 24)).toFixed(2));
  }

  return {
    accountsToday,
    accountsWeek,
    accountsMonth,
    lifetimeTotal,
    averagePerHour,
    averagePerDay,
    highestDaily,
    highestDailyDate,
    topUser: top ? { username: top.username, total: top.total } : null,
    overallSuccessRate: null,
  };
}
