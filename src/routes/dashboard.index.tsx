import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-5xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-muted-foreground">
          Here's your fleet at a glance, <span className="text-foreground">{displayName}</span>.
        </p>
      </header>

      {/* Workspace card */}
      <section className="rounded-2xl brutal-border bg-card p-8 flex items-center justify-between gap-6 glow-primary">
        <div>
          <div
            className={`inline-flex items-center gap-2 rounded-full brutal-border px-3 py-1 text-[10px] uppercase tracking-widest ${
              isAdmin
                ? "bg-yellow-500/10 text-yellow-500"
                : active
                  ? "bg-primary/10 text-primary"
                  : "bg-destructive/10 text-destructive"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${isAdmin ? "bg-yellow-500 animate-pulse" : active ? "bg-primary animate-pulse" : "bg-destructive"}`}
            />
            {isAdmin
              ? "ADMIN · all features unlocked"
              : active
                ? `${plan?.name} · active`
                : "No plan · locked"}
          </div>
          <h2 className="mt-4 font-display text-3xl font-semibold">
            {active ? "Your workspace is ready" : "Unlock your workspace"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-lg">
            {active
              ? "Deploy bots, manage plugins, and keep an eye on activity below."
              : "You need an active plan to deploy bots. Choose one and pay with crypto — 2 confirmations and you're in."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {active ? (
              <Link
                to="/dashboard/bots"
                className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-xs font-semibold"
              >
                <BotIcon className="h-4 w-4" /> Deploy a bot
              </Link>
            ) : (
              <button
                disabled
                className="inline-flex items-center gap-2 rounded-full bg-muted/40 text-muted-foreground px-5 py-2.5 text-xs font-semibold cursor-not-allowed"
              >
                <Lock className="h-4 w-4" /> Deploy a bot
              </button>
            )}
            <Link
              to="/dashboard/purchase"
              className="inline-flex items-center gap-2 rounded-full brutal-border bg-secondary/40 hover:bg-secondary px-5 py-2.5 text-xs font-semibold"
            >
              <ShoppingCart className="h-4 w-4" /> {active ? "Extend plan" : "Choose a plan"}
            </Link>
          </div>
        </div>
        <div className="hidden md:flex flex-col items-end">
          <RuntimeRing daysLeft={daysLeft} />
          <div className="mt-3 text-right text-xs">
            <div className="text-muted-foreground uppercase tracking-widest text-[10px]">
              Runtime
            </div>
            <div className="font-mono text-lg">{botHours.toFixed(1)}h</div>
            <div className="mt-1 text-muted-foreground uppercase tracking-widest text-[10px]">
              Expires
            </div>
            <div className="font-mono text-xs">
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
          value={String(maxBots)}
          hint={maxBots === 0 ? "no plan" : "concurrent slots"}
          locked={!active}
        />
        <StatCard
          icon={Clock}
          label="Bot Hours"
          value={`${botHours.toFixed(1)}h`}
          hint={active ? "included with plan" : "no plan"}
          locked={!active}
        />
        <StatCard
          icon={Calendar}
          label="Days Left"
          value={String(daysLeft)}
          hint={active ? "until renewal" : "no plan"}
          locked={!active}
        />
        <StatCard icon={Puzzle} label="Plugins" value="0" hint="owned" />
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
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-3">
          <Puzzle className="h-3.5 w-3.5" /> Plugins
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
  hint,
  locked,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  locked?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl brutal-border bg-card p-5 relative overflow-hidden ${locked ? "opacity-70" : ""}`}
    >
      <div className="absolute inset-0 grid-bg opacity-40" aria-hidden />
      <div className="relative">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          <Icon className={`h-3.5 w-3.5 ${locked ? "text-muted-foreground" : "text-primary"}`} />
          {label}
        </div>
        <div className="mt-3 font-mono text-3xl font-semibold">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
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
      className="rounded-2xl brutal-border bg-card p-5 flex items-start gap-4 hover:bg-card/80 transition-colors"
    >
      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1">
        <div className="font-semibold text-sm">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
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
      className="rounded-2xl brutal-border bg-card p-5 hover:bg-card/80 transition-colors block"
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="font-semibold text-sm">{title}</div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{desc}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
        Open plugin <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}

function RuntimeRing({ daysLeft }: { daysLeft: number }) {
  const pct = Math.min(1, daysLeft / 30);
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88">
      <circle
        cx="44"
        cy="44"
        r={r}
        fill="none"
        stroke="currentColor"
        className="text-secondary"
        strokeWidth="6"
      />
      <circle
        cx="44"
        cy="44"
        r={r}
        fill="none"
        stroke="currentColor"
        className="text-primary"
        strokeWidth="6"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="round"
        transform="rotate(-90 44 44)"
      />
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
  );
}
