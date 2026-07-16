import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot as BotIcon,
  Clock,
  Calendar,
  Puzzle,
  Zap,
  MessageSquare,
  ShoppingCart,
  ArrowRight,
  Lock,
  Sparkles,
  Terminal,
  ShieldCheck,
} from "lucide-react";
import { getDashboardStats, getMyProfile } from "@/lib/luaux.functions";

export const Route = createFileRoute("/dashboard/")({
  component: Overview,
});

type Profile = {
  discord_id: string;
  username: string;
  global_name: string | null;
  active_plan_id: string | null;
  plan_expires_at: string | null;
  bot_hours_remaining: number;
};
type Plan = { id: string; name: string; max_bots: number; bot_hours: number };

type DashStats = {
  activeBots: number;
  jobsError: number;
  jobsCompleted: number;
  pluginsOwned: number;
  securedTotal: number;
  securedWeek: number;
  successRate: number | null;
  paymentsFulfilled: number;
  paymentsSpentUsd: number;
  runtimeHours7d: number;
  mcJobs7d: number;
  discordJobs7d: number;
};

function AnimatedValue({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const duration = 1200;
          const steps = 50;
          const increment = value / steps;
          let current = 0;
          const timer = setInterval(() => {
            current += increment;
            if (current >= value) {
              setDisplay(value);
              clearInterval(timer);
            } else {
              setDisplay(Number(current.toFixed(decimals)));
            }
          }, duration / steps);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, decimals]);

  return (
    <span ref={ref}>
      {decimals > 0 ? display.toFixed(decimals) : display}
    </span>
  );
}

function Overview() {
  const fetchProfile = useServerFn(getMyProfile);
  const fetchStats = useServerFn(getDashboardStats);
  const [data, setData] = useState<{
    profile: Profile | null;
    plan: Plan | null;
    active: boolean;
    isAdmin?: boolean;
  } | null>(null);
  const [stats, setStats] = useState<DashStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      fetchProfile().then((d) =>
        setData(
          d as { profile: Profile | null; plan: Plan | null; active: boolean; isAdmin?: boolean },
        ),
      ),
      fetchStats()
        .then((s) => setStats(s as DashStats))
        .catch(() => setStats(null)),
    ])
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : "Failed to load profile");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [fetchProfile, fetchStats]);

  const active = data?.active ?? false;
  const isAdmin = data?.isAdmin ?? false;
  const profile = data?.profile;
  const plan = data?.plan;
  const displayName = profile?.global_name || profile?.username || "friend";
  const botHours = Number(profile?.bot_hours_remaining ?? 0);
  const planActive =
    !!profile?.active_plan_id &&
    !!profile?.plan_expires_at &&
    new Date(profile.plan_expires_at).getTime() > Date.now();
  const maxBots = isAdmin
    ? 999
    : planActive
      ? Math.max(1, Number(plan?.max_bots ?? 1))
      : botHours > 0
        ? 1
        : 0;
  const daysLeft =
    profile?.plan_expires_at
      ? Math.max(
          0,
          Math.ceil(
            (new Date(profile.plan_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          ),
        )
      : isAdmin
        ? 999
        : 0;

  if (loading && !data) {
    return (
      <div className="space-y-6 md:space-y-8 animate-page-in animate-pulse">
        <div className="h-40 rounded-3xl border border-border/50 bg-card/60" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl border border-border/50 bg-card/40" />
          ))}
        </div>
      </div>
    );
  }

  if (loadError && !data) {
    return (
      <div className="animate-page-in">
        <div className="rounded-2xl border border-destructive/25 bg-destructive/5 px-5 py-10 text-center space-y-3">
          <p className="text-sm font-medium text-destructive">Could not load your workspace</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">{loadError}</p>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-xs font-semibold shadow-sm hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8 animate-page-in">
      {loadError && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs text-destructive flex items-center justify-between gap-3">
          <span>Refresh failed: {loadError}</span>
          <button type="button" onClick={load} className="underline font-semibold shrink-0">
            Retry
          </button>
        </div>
      )}
      {/* Hero header */}
      <header className="relative overflow-hidden rounded-3xl border border-border/50 bg-card/80 p-6 md:p-10 shadow-[0_1px_0_0_oklch(1_0_0_/_0.04)_inset]">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-primary/4 pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground mb-4">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary animate-ping opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              {isAdmin ? "Admin mode" : active ? "Active" : "No plan"}
            </div>

            <h1 className="font-display text-4xl md:text-5xl font-extrabold tracking-tight text-gradient leading-tight">
              Welcome back, {displayName}
            </h1>
            <p className="mt-3 text-muted-foreground text-sm font-semibold max-w-lg leading-relaxed">
              {active
                ? "Your workspace is live. Deploy bots, monitor activity, and manage your setup below."
                : "Unlock your workspace to deploy bots and access all automation tools."}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              {active ? (
                <Link
                  to="/dashboard/bots"
                  className="inline-flex items-center gap-2 rounded-full btn-gold px-6 py-3 text-xs"
                >
                  <BotIcon className="h-4 w-4" /> Deploy a bot
                </Link>
              ) : (
                <button
                  disabled
                  className="inline-flex items-center gap-2 rounded-full bg-muted/40 text-muted-foreground px-6 py-3 text-xs font-semibold cursor-not-allowed"
                >
                  <Lock className="h-4 w-4" /> Deploy a bot
                </button>
              )}
              <Link
                to="/dashboard/purchase"
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 hover:bg-primary/5 hover:border-primary/20 hover:text-primary hover:glow-border px-6 py-3 text-xs font-semibold transition-all duration-300"
              >
                <ShoppingCart className="h-4 w-4" />{" "}
                {active ? "Extend plan" : "Choose a plan"}
              </Link>
            </div>
          </div>

          {/* Plan countdown */}
          <div className="flex flex-col items-center md:items-end shrink-0">
            <RuntimeRing daysLeft={daysLeft} isAdmin={isAdmin} active={active || isAdmin} />
            <div className="mt-4 text-center md:text-right">
              <div className="font-mono text-xl font-semibold text-primary tabular-nums">
                {botHours.toFixed(1)}
                <span className="text-sm text-muted-foreground font-normal ml-0.5">h</span>
              </div>
              <div className="text-muted-foreground/70 uppercase tracking-[0.18em] text-[10px] mt-1">
                bot hours left
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Usage meters */}
      <section className="grid sm:grid-cols-2 gap-3 md:gap-4">
        <UsageBar
          label="Bot slots"
          valueLabel={isAdmin ? "Unlimited" : `${maxBots} concurrent`}
          pct={isAdmin ? 1 : maxBots <= 0 ? 0 : Math.min(1, maxBots / 20)}
          hint={isAdmin ? "Admin bypass" : planActive ? (plan?.name || "Plan") : botHours > 0 ? "Hours pack" : "No access"}
          locked={!active && !isAdmin}
        />
        <UsageBar
          label="Bot hours"
          valueLabel={`${botHours.toFixed(1)}h remaining`}
          pct={
            isAdmin
              ? 1
              : Math.min(1, botHours / Math.max(1, Number(plan?.bot_hours ?? 14)))
          }
          hint={active || isAdmin ? "Shared runtime pool" : "Buy a plan or hours pack"}
          locked={!active && !isAdmin}
        />
      </section>

      {/* Stats row */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard icon={BotIcon} label="Max Bots" value={maxBots} hint={isAdmin ? "admin" : maxBots === 0 ? "no plan" : "concurrent"} locked={!active && !isAdmin} delay={0} />
        <StatCard icon={Clock} label="Bot Hours" value={botHours} suffix="h" decimals={1} hint={active || isAdmin ? "remaining" : "no plan"} locked={!active && !isAdmin} delay={1} />
        <StatCard icon={Calendar} label="Days Left" value={daysLeft} hint={isAdmin ? "admin" : active ? "until renewal" : "no plan"} locked={!active && !isAdmin} delay={2} />
        <StatCard
          icon={Puzzle}
          label="Plugins"
          value={stats?.pluginsOwned ?? 0}
          hint="owned"
          locked={false}
          delay={3}
        />
      </section>

      {/* Activity */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          icon={BotIcon}
          label="Active bots"
          value={stats?.activeBots ?? 0}
          hint="live now"
          locked={false}
          delay={0}
        />
        <StatCard
          icon={ShieldCheck}
          label="Secured (7d)"
          value={stats?.securedWeek ?? 0}
          hint={
            stats?.securedTotal != null
              ? `${stats.securedTotal} lifetime`
              : "this week"
          }
          locked={false}
          delay={1}
        />
        <StatCard
          icon={Sparkles}
          label="Success rate"
          value={stats?.successRate ?? 0}
          suffix={stats?.successRate != null ? "%" : ""}
          decimals={stats?.successRate != null ? 1 : 0}
          hint={stats?.successRate != null ? "verification" : "no attempts"}
          locked={false}
          delay={2}
        />
        <StatCard
          icon={Clock}
          label="Runtime (7d)"
          value={stats?.runtimeHours7d ?? 0}
          suffix="h"
          decimals={1}
          hint={
            stats
              ? `${stats.mcJobs7d} MC · ${stats.discordJobs7d} Discord jobs`
              : "estimated"
          }
          locked={false}
          delay={3}
        />
      </section>

      {/* Quick actions + plugins */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        <Link
          to="/dashboard/purchase"
          className="group relative rounded-2xl border border-border/50 bg-card p-6 hover:bg-card/90 hover:border-primary/30 magnetic-hover overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mb-4 group-hover:bg-primary/20 group-hover:shadow-[0_0_20px_oklch(0.79_0.16_85_/_0.2)] transition-all duration-500 icon-pop">
              <ShoppingCart className="h-5 w-5 text-primary" />
            </div>
            <div className="font-semibold text-sm">Get a Plan</div>
            <p className="mt-1.5 text-xs text-muted-foreground/60 leading-relaxed">
              Pay with crypto. Access unlocks after 2 confirmations.
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary opacity-0 translate-x-0 group-hover:opacity-100 group-hover:translate-x-2 transition-all duration-300">
              Choose plan
            </span>
          </div>
        </Link>

        <Link
          to="/dashboard/bots"
          className="group relative rounded-2xl border border-border/50 bg-card p-6 hover:bg-card/90 hover:border-primary/30 magnetic-hover overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mb-4 group-hover:bg-primary/20 group-hover:shadow-[0_0_20px_oklch(0.79_0.16_85_/_0.2)] transition-all duration-500 icon-pop">
              <BotIcon className="h-5 w-5 text-primary" />
            </div>
            <div className="font-semibold text-sm">MC Auto-Message</div>
            <p className="mt-1.5 text-xs text-muted-foreground/60 leading-relaxed">
              Join any Minecraft server and auto-message with your bots.
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary opacity-0 translate-x-0 group-hover:opacity-100 group-hover:translate-x-2 transition-all duration-300">
              Configure & launch
            </span>
          </div>
        </Link>

        <Link
          to="/dashboard/logs"
          className="group relative rounded-2xl border border-border/40 bg-card/50 p-6 hover:bg-card/70 hover:border-primary/30 magnetic-hover holographic overflow-hidden noise-texture"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mb-4 group-hover:bg-primary/20 group-hover:shadow-[0_0_20px_oklch(0.79_0.16_85_/_0.2)] transition-all duration-500">
              <Terminal className="h-5 w-5 text-primary" />
            </div>
            <div className="font-semibold text-sm">Live Logs</div>
            <p className="mt-1.5 text-xs text-muted-foreground/60 leading-relaxed">
              Watch real-time output from every active bot instance.
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary opacity-0 translate-x-0 group-hover:opacity-100 group-hover:translate-x-2 transition-all duration-300">
              View logs
            </span>
          </div>
        </Link>
      </div>

      {/* Plugins section */}
      <section>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground/60 mb-4">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Plugins
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          <PluginCard
            to="/dashboard/discord-spam"
            icon={Zap}
            title="Discord Auto-Spam"
            desc="Multi-token channel spammer with anti-ban rotation and live console."
          />
          <PluginCard
            to="/dashboard/discord-auto-reply"
            icon={MessageSquare}
            title="Discord Auto-Reply"
            desc="Hands-off DM responder with humanized timing and auto friend accept."
          />
          <PluginCard
            to="/dashboard/verification-bot"
            icon={ShieldCheck}
            title="Verification Bot"
            desc="Verify members and secure MC accounts for your server."
          />
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  suffix = "",
  decimals = 0,
  hint,
  locked,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  hint: string;
  locked?: boolean;
  delay: number;
}) {
  return (
    <div
      className={`tilt-card rounded-2xl border border-border/50 bg-card p-5 relative overflow-hidden transition-all duration-300 hover:border-primary/30 group magnetic-hover ${locked ? "opacity-60" : ""}`}
      style={{ animationDelay: `${delay * 0.08}s` }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-primary/2 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative tilt-card-inner">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground/60">
          <div className={`h-7 w-7 rounded-lg flex items-center justify-center transition-all duration-500 ${
            locked
              ? "bg-muted/40"
              : "bg-primary/10 group-hover:bg-primary/20 group-hover:shadow-[0_0_12px_oklch(0.79_0.16_85_/_0.2)]"
          }`}>
            <Icon
              className={`h-3.5 w-3.5 transition-all duration-300 ${
                locked
                  ? "text-muted-foreground/40"
                  : "text-primary"
              }`}
            />
          </div>
          {label}
        </div>
        <div className="mt-3 font-mono text-3xl font-semibold text-gradient-gold">
          <AnimatedValue value={value} decimals={decimals} />
          {suffix}
        </div>
        <div className="mt-1 text-xs text-muted-foreground/60">{hint}</div>
      </div>
    </div>
  );
}

function PluginCard({
  icon: Icon,
  title,
  desc,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group relative rounded-2xl border border-border/50 bg-card p-6 hover:bg-card/90 hover:border-primary/30 block overflow-hidden transition-all duration-300 magnetic-hover"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-primary/2 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center group-hover:bg-primary/20 group-hover:shadow-[0_0_20px_oklch(0.79_0.16_85_/_0.2)] transition-all duration-500">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="font-semibold text-sm">{title}</div>
        </div>
        <p className="text-xs text-muted-foreground/60 leading-relaxed">{desc}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary opacity-0 translate-x-0 group-hover:opacity-100 group-hover:translate-x-2 transition-all duration-300">
          Open plugin
        </span>
      </div>
    </Link>
  );
}

function UsageBar({
  label,
  valueLabel,
  pct,
  hint,
  locked,
}: {
  label: string;
  valueLabel: string;
  pct: number;
  hint: string;
  locked?: boolean;
}) {
  const fill = Math.max(0, Math.min(1, pct));
  return (
    <div
      className={`rounded-2xl border border-border/50 bg-card/80 p-4 md:p-5 ${locked ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{valueLabel}</div>
        </div>
        <div className="text-[10px] text-muted-foreground text-right max-w-[45%] leading-snug">{hint}</div>
      </div>
      <div className="h-2 rounded-full bg-muted/60 overflow-hidden border border-border/40">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-700 ease-out"
          style={{ width: `${fill * 100}%` }}
        />
      </div>
    </div>
  );
}

function RuntimeRing({
  daysLeft,
  isAdmin,
  active,
}: {
  daysLeft: number;
  isAdmin?: boolean;
  active?: boolean;
}) {
  // Normalize to a 30-day cycle for the arc (plans are monthly-ish)
  const display = isAdmin && daysLeft >= 999 ? "∞" : String(daysLeft);
  const pct = isAdmin && daysLeft >= 999 ? 1 : Math.min(1, Math.max(0, daysLeft / 30));
  const size = 120;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);
  const low = !isAdmin && daysLeft > 0 && daysLeft <= 7;

  return (
    <div className="relative flex flex-col items-center">
      <div
        className={`relative rounded-full p-1 ${
          active
            ? "bg-gradient-to-b from-primary/15 via-card to-card border border-primary/20 shadow-[0_0_32px_-8px_color-mix(in_oklch,var(--primary)_35%,transparent)]"
            : "bg-card border border-border/50"
        }`}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            className="text-border/40"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            className={low ? "text-destructive" : "text-primary"}
            strokeWidth={stroke}
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.22,1,0.36,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
          <div
            className={`font-display text-3xl font-semibold tabular-nums leading-none tracking-tight ${
              low ? "text-destructive" : "text-foreground"
            }`}
          >
            {display}
          </div>
          <div className="mt-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
            {isAdmin && daysLeft >= 999 ? "Admin" : daysLeft === 1 ? "Day left" : "Days left"}
          </div>
        </div>
      </div>
      {low && (
        <div className="mt-2 text-[10px] text-destructive/90 font-medium">Renew soon</div>
      )}
    </div>
  );
}
