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
} from "lucide-react";
import { getMyProfile } from "@/lib/luaux.functions";

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
          const duration = 1000;
          const steps = 40;
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

  return <span ref={ref}>{decimals > 0 ? display.toFixed(decimals) : display}</span>;
}

function Overview() {
  const fetchProfile = useServerFn(getMyProfile);
  const [data, setData] = useState<{
    profile: Profile | null;
    plan: Plan | null;
    active: boolean;
    isAdmin?: boolean;
  } | null>(null);

  useEffect(() => {
    fetchProfile().then((d) =>
      setData(
        d as { profile: Profile | null; plan: Plan | null; active: boolean; isAdmin?: boolean },
      ),
    );
  }, [fetchProfile]);

  const active = data?.active ?? false;
  const isAdmin = data?.isAdmin ?? false;
  const profile = data?.profile;
  const plan = data?.plan;
  const displayName = profile?.global_name || profile?.username || "friend";
  const maxBots = active && plan ? plan.max_bots : 0;
  const botHours = active ? Number(profile?.bot_hours_remaining ?? 0) : 0;
  const daysLeft =
    active && profile?.plan_expires_at
      ? Math.max(
          0,
          Math.ceil(
            (new Date(profile.plan_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          ),
        )
      : 0;

  return (
    <div className="space-y-8">
      <header className="animate-fade-in-up">
        <h1 className="font-display text-5xl md:text-6xl font-semibold tracking-tight text-gradient">
          Welcome back
        </h1>
        <p className="mt-2 text-muted-foreground text-lg">
          Here's your fleet at a glance, <span className="text-foreground font-medium">{displayName}</span>.
        </p>
      </header>

      {/* Workspace card */}
      <section className="rounded-2xl border border-border/60 bg-card/60 p-8 flex items-center justify-between gap-6 relative overflow-hidden group animate-fade-in-up stagger-1" style={{ opacity: 0 }}>
        {/* Background effects */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/3 rounded-full blur-[80px] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
        {/* Top gold line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

        <div className="relative">
          <div
            className={`inline-flex items-center gap-2.5 rounded-full border px-4 py-1.5 text-[10px] uppercase tracking-widest font-semibold transition-all duration-300 ${
              isAdmin
                ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                : active
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-destructive/10 text-destructive border-destructive/20"
            }`}
          >
            <span className="relative flex h-2 w-2">
              {(isAdmin || active) && (
                <span className={`absolute inline-flex h-full w-full rounded-full animate-ping opacity-75 ${isAdmin ? "bg-yellow-500" : "bg-primary"}`} />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${isAdmin ? "bg-yellow-500" : active ? "bg-primary" : "bg-destructive"}`} />
            </span>
            {isAdmin
              ? "ADMIN · all features unlocked"
              : active
                ? `${plan?.name} · active`
                : "No plan · locked"}
          </div>

          <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight">
            {active ? "Your workspace is ready" : "Unlock your workspace"}
          </h2>
          <p className="mt-2.5 text-sm text-muted-foreground max-w-lg leading-relaxed">
            {active
              ? "Deploy bots, manage plugins, and keep an eye on activity below."
              : "You need an active plan to deploy bots. Choose one and pay with crypto — 2 confirmations and you're in."}
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
              <ShoppingCart className="h-4 w-4" /> {active ? "Extend plan" : "Choose a plan"}
            </Link>
          </div>
        </div>
        <div className="hidden md:flex flex-col items-end">
          <RuntimeRing daysLeft={daysLeft} />
          <div className="mt-4 text-right text-xs">
            <div className="text-muted-foreground/60 uppercase tracking-widest text-[10px]">
              Runtime
            </div>
            <div className="font-mono text-lg text-gradient-gold mt-1">{botHours.toFixed(1)}h</div>
            <div className="mt-2 text-muted-foreground/60 uppercase tracking-widest text-[10px]">
              Expires
            </div>
            <div className="font-mono text-xs mt-1">
              {profile?.plan_expires_at
                ? new Date(profile.plan_expires_at).toLocaleDateString()
                : "—"}
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={BotIcon}
          label="Max Bots"
          value={maxBots}
          hint={maxBots === 0 ? "no plan" : "concurrent slots"}
          locked={!active}
          delay={0}
        />
        <StatCard
          icon={Clock}
          label="Bot Hours"
          value={botHours}
          suffix="h"
          decimals={1}
          hint={active ? "included with plan" : "no plan"}
          locked={!active}
          delay={1}
        />
        <StatCard
          icon={Calendar}
          label="Days Left"
          value={daysLeft}
          hint={active ? "until renewal" : "no plan"}
          locked={!active}
          delay={2}
        />
        <StatCard icon={Puzzle} label="Plugins" value={0} hint="owned" locked={false} delay={3} />
      </section>

      {/* Quick actions */}
      <section className="grid md:grid-cols-2 gap-4">
        <QuickAction
          to="/dashboard/purchase"
          icon={ShoppingCart}
          title="Get a plan"
          desc="Pay with LTC, SOL, or USDT/USDC. Access unlocks after 2 confirmations."
          cta="Choose plan"
        />
        <QuickAction
          to="/dashboard/bots"
          icon={BotIcon}
          title="MC Auto-Message"
          desc="Join any Minecraft server and auto-message with your bot fleet."
          cta="Configure & launch"
        />
      </section>

      <section>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground/60 mb-4">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Plugins
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <PluginCard
            to="/dashboard/discord-spam"
            icon={Zap}
            title="Discord Auto-Spam"
            desc="Multi-token channel spammer with rotation, humanization & live console."
          />
          <PluginCard
            to="/dashboard/discord-bot"
            icon={Puzzle}
            title="More Plugins"
            desc="Browse verification bot, auto-reply, and more Discord automation tools."
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
      className={`rounded-2xl border border-border/60 bg-card/60 p-5 relative overflow-hidden transition-all duration-500 hover:border-primary/20 hover:-translate-y-1 hover:glow-sm group animate-fade-in-up ${locked ? "opacity-60" : ""}`}
      style={{ animationDelay: `${delay * 0.1}s`, opacity: 0 }}
    >
      {/* Hover gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground/60">
          <Icon className={`h-3.5 w-3.5 transition-colors duration-300 ${locked ? "text-muted-foreground/40" : "text-primary group-hover:drop-shadow-[0_0_4px_oklch(0.79_0.16_85_/_0.4)]"}`} />
          {label}
        </div>
        <div className="mt-3 font-mono text-3xl font-semibold text-gradient-gold">
          <AnimatedValue value={value} decimals={decimals} />{suffix}
        </div>
        <div className="mt-1 text-xs text-muted-foreground/60">{hint}</div>
      </div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  title,
  desc,
  cta,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  cta: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-2xl border border-border/60 bg-card/60 p-6 flex items-start gap-4 hover:bg-card/80 hover:border-primary/20 hover:-translate-y-1 transition-all duration-500 group relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative h-12 w-12 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0 group-hover:bg-primary/15 group-hover:shadow-[0_0_20px_oklch(0.79_0.16_85_/_0.15)] transition-all duration-500">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="relative flex-1">
        <div className="font-semibold text-sm">{title}</div>
        <div className="mt-1.5 text-xs text-muted-foreground/60 leading-relaxed">{desc}</div>
        <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary group-hover:translate-x-1 transition-transform duration-300">
          {cta} <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
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
      className="rounded-2xl border border-border/60 bg-card/60 p-6 hover:bg-card/80 hover:border-primary/20 hover:-translate-y-1 transition-all duration-500 block group relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center group-hover:bg-primary/15 group-hover:shadow-[0_0_20px_oklch(0.79_0.16_85_/_0.15)] transition-all duration-500">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="font-semibold text-sm">{title}</div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground/60 leading-relaxed">{desc}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary group-hover:translate-x-1 transition-transform duration-300">
          Open plugin <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

function RuntimeRing({ daysLeft }: { daysLeft: number }) {
  const pct = Math.min(1, daysLeft / 30);
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative">
      <svg width="88" height="88" viewBox="0 0 88 88" className="drop-shadow-[0_0_8px_oklch(0.79_0.16_85_/_0.2)]">
        {/* Background track glow */}
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-border/50"
          strokeWidth="6"
        />
        {/* Progress arc */}
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke="url(#ringGradient)"
          strokeWidth="6"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
          style={{ transition: "stroke-dashoffset 1s ease-out" }}
        />
        {/* Glow circle behind progress */}
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="12"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
          opacity="0.08"
        />
        <defs>
          <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="oklch(0.85 0.18 85)" />
            <stop offset="100%" stopColor="oklch(0.72 0.14 85)" />
          </linearGradient>
        </defs>
        <text
          x="44"
          y="42"
          textAnchor="middle"
          className="fill-foreground font-mono"
          fontSize="18"
          fontWeight="600"
        >
          {daysLeft}
        </text>
        <text
          x="44"
          y="58"
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize="8"
          letterSpacing="2"
        >
          DAYS LEFT
        </text>
      </svg>
    </div>
  );
}
