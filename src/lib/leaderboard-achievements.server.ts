/**
 * Leaderboard achievements — computed from secured events (no extra tables).
 */

export type AchievementId =
  | "first_blood"
  | "getting_started"
  | "operator"
  | "elite"
  | "hot_streak"
  | "week_warrior"
  | "monthly_king"
  | "daily_ace"
  | "comeback"
  | "on_fire";

export type AchievementIcon = "trophy" | "flame" | "crown" | "zap" | "medal" | "sparkles";
export type AchievementRarity = "common" | "rare" | "epic" | "legendary";

export type AchievementDef = {
  id: AchievementId;
  title: string;
  description: string;
  icon: AchievementIcon;
  rarity: AchievementRarity;
  /** Target for progress bar when locked (null = binary unlock) */
  progressTarget: number | null;
};

export type AchievementStatus = AchievementDef & {
  unlocked: boolean;
  progress: number;
  progressLabel: string | null;
};

export type AchievementContext = {
  lifetimeTotal: number;
  last24hTotal: number;
  streakDays: number;
  rank24h: number | null;
  rank7d: number | null;
  rankMonth: number | null;
  /** Current period trend vs previous window */
  trend: "up" | "down" | "same" | "new" | null;
  /** Total in the current period (for comeback threshold) */
  periodTotal: number;
};

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  {
    id: "first_blood",
    title: "First Blood",
    description: "Secure your first account",
    icon: "sparkles",
    rarity: "common",
    progressTarget: 1,
  },
  {
    id: "getting_started",
    title: "Getting Started",
    description: "Reach 5 lifetime secures",
    icon: "medal",
    rarity: "common",
    progressTarget: 5,
  },
  {
    id: "operator",
    title: "Operator",
    description: "Reach 25 lifetime secures",
    icon: "trophy",
    rarity: "rare",
    progressTarget: 25,
  },
  {
    id: "elite",
    title: "Elite",
    description: "Reach 100 lifetime secures",
    icon: "crown",
    rarity: "legendary",
    progressTarget: 100,
  },
  {
    id: "hot_streak",
    title: "Hot Streak",
    description: "Secure on 3 consecutive days",
    icon: "flame",
    rarity: "rare",
    progressTarget: 3,
  },
  {
    id: "on_fire",
    title: "On Fire",
    description: "Secure 5+ accounts in 24 hours",
    icon: "zap",
    rarity: "epic",
    progressTarget: 5,
  },
  {
    id: "week_warrior",
    title: "Week Warrior",
    description: "Finish top 10 this week",
    icon: "medal",
    rarity: "rare",
    progressTarget: null,
  },
  {
    id: "daily_ace",
    title: "Daily Ace",
    description: "Rank #1 in the last 24 hours",
    icon: "crown",
    rarity: "epic",
    progressTarget: null,
  },
  {
    id: "monthly_king",
    title: "Monthly King",
    description: "Rank #1 this calendar month",
    icon: "crown",
    rarity: "legendary",
    progressTarget: null,
  },
  {
    id: "comeback",
    title: "Comeback",
    description: "Beat your previous period with 3+ secures",
    icon: "trophy",
    rarity: "rare",
    progressTarget: null,
  },
];

/** UTC day key YYYY-MM-DD */
export function utcDayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toISOString().slice(0, 10);
}

/** Consecutive UTC days with ≥1 event, counting from most recent day that is today or yesterday */
export function computeStreakDays(eventIsos: string[], now = new Date()): number {
  if (!eventIsos.length) return 0;
  const days = new Set(eventIsos.map(utcDayKey));
  const today = utcDayKey(now);
  const yesterday = utcDayKey(new Date(now.getTime() - 86_400_000));

  let cursor: string | null = null;
  if (days.has(today)) cursor = today;
  else if (days.has(yesterday)) cursor = yesterday;
  else return 0;

  let streak = 0;
  while (cursor && days.has(cursor)) {
    streak++;
    const prev = new Date(`${cursor}T12:00:00.000Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    cursor = utcDayKey(prev);
  }
  return streak;
}

function isUnlocked(id: AchievementId, ctx: AchievementContext): boolean {
  switch (id) {
    case "first_blood":
      return ctx.lifetimeTotal >= 1;
    case "getting_started":
      return ctx.lifetimeTotal >= 5;
    case "operator":
      return ctx.lifetimeTotal >= 25;
    case "elite":
      return ctx.lifetimeTotal >= 100;
    case "hot_streak":
      return ctx.streakDays >= 3;
    case "on_fire":
      return ctx.last24hTotal >= 5;
    case "week_warrior":
      return ctx.rank7d != null && ctx.rank7d >= 1 && ctx.rank7d <= 10;
    case "daily_ace":
      return ctx.rank24h === 1;
    case "monthly_king":
      return ctx.rankMonth === 1;
    case "comeback":
      return (ctx.trend === "up" || ctx.trend === "new") && ctx.periodTotal >= 3;
    default:
      return false;
  }
}

function progressFor(id: AchievementId, ctx: AchievementContext, target: number | null): number {
  if (target == null) return isUnlocked(id, ctx) ? 1 : 0;
  switch (id) {
    case "first_blood":
    case "getting_started":
    case "operator":
    case "elite":
      return Math.min(target, ctx.lifetimeTotal);
    case "hot_streak":
      return Math.min(target, ctx.streakDays);
    case "on_fire":
      return Math.min(target, ctx.last24hTotal);
    default:
      return isUnlocked(id, ctx) ? target : 0;
  }
}

export function evaluateAchievements(ctx: AchievementContext): AchievementStatus[] {
  return ACHIEVEMENT_DEFS.map((def) => {
    const unlocked = isUnlocked(def.id, ctx);
    const progress = progressFor(def.id, ctx, def.progressTarget);
    let progressLabel: string | null = null;
    if (def.progressTarget != null && !unlocked) {
      progressLabel = `${progress}/${def.progressTarget}`;
    } else if (def.id === "hot_streak" && unlocked) {
      progressLabel = `${ctx.streakDays}d`;
    }
    return { ...def, unlocked, progress, progressLabel };
  });
}

/** Highlight badges for table rows (max 3, prefer rare+) */
export function pickRowBadgeIds(statuses: AchievementStatus[], max = 2): AchievementId[] {
  const unlocked = statuses.filter((s) => s.unlocked);
  const order: AchievementRarity[] = ["legendary", "epic", "rare", "common"];
  unlocked.sort(
    (a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.title.localeCompare(b.title),
  );
  // Prefer flashy rank/streak badges on rows
  const preferred: AchievementId[] = [
    "monthly_king",
    "daily_ace",
    "elite",
    "hot_streak",
    "on_fire",
    "week_warrior",
    "operator",
  ];
  const picked: AchievementId[] = [];
  for (const id of preferred) {
    if (unlocked.some((u) => u.id === id)) picked.push(id);
    if (picked.length >= max) break;
  }
  if (picked.length < max) {
    for (const u of unlocked) {
      if (!picked.includes(u.id)) picked.push(u.id);
      if (picked.length >= max) break;
    }
  }
  return picked;
}

export function buildContextFromEvents(
  eventIsos: string[],
  opts: {
    rank24h: number | null;
    rank7d: number | null;
    rankMonth: number | null;
    trend: AchievementContext["trend"];
    periodTotal: number;
    now?: Date;
  },
): AchievementContext {
  const now = opts.now || new Date();
  const dayAgo = now.getTime() - 24 * 60 * 60_000;
  const last24hTotal = eventIsos.filter((iso) => new Date(iso).getTime() >= dayAgo).length;
  return {
    lifetimeTotal: eventIsos.length,
    last24hTotal,
    streakDays: computeStreakDays(eventIsos, now),
    rank24h: opts.rank24h,
    rank7d: opts.rank7d,
    rankMonth: opts.rankMonth,
    trend: opts.trend,
    periodTotal: opts.periodTotal,
  };
}
