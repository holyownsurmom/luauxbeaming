import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import luauxLogo from "@/assets/luaux-logo.png";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "LuauX — Automated Minecraft bot fleets" },
      {
        name: "description",
        content:
          "Deploy stealthy Minecraft bot fleets in under a minute. Live logs, anti-detect proxies, 24/7 uptime.",
      },
    ],
  }),
});

const LOG_LINES = [
  { t: "16:00:41", tag: "JOIN", bot: "vexil", msg: "spawned · stealth profile active" },
  { t: "16:00:42", tag: "SEND", bot: "vexil", msg: 'broadcast → "888 to join unstableSMP"' },
  { t: "16:00:43", tag: "CHAT", bot: "vexil", msg: "<S1lent_> yo whats 888?" },
  { t: "16:00:44", tag: "AI", bot: "vexil", msg: "trigger 888 · composing reply" },
  { t: "16:00:45", tag: "SEND", bot: "vexil", msg: '/msg S1lent_ → "add me on dc — untualab"' },
  { t: "16:00:46", tag: "HOOK", bot: "vexil", msg: "discord webhook · reply logged ✓" },
  { t: "16:00:47", tag: "AFK", bot: "nyxara", msg: "anti-afk rotation · idle drift" },
  { t: "16:00:48", tag: "JOIN", bot: "korrin", msg: "connected · 18ms eu-fra" },
  { t: "16:00:49", tag: "SEND", bot: "korrin", msg: "/pay untualab 64 diamond_block" },
];

const FEATURES = [
  {
    tag: "01",
    label: "Automation",
    title: "Smart fleet",
    body: "Spin up dozens of bots with shared behavior profiles. Load balancing distributes tasks across the fleet automatically.",
    icon: "⚡",
  },
  {
    tag: "02",
    label: "Stealth",
    title: "Undetected",
    body: "Rotating proxies, humanlike movement and unique fingerprints for every session.",
    icon: "🛡",
  },
  {
    tag: "03",
    label: "Reliability",
    title: "24/7 uptime",
    body: "Bots run continuously. No manual restarts, no babysitting, no drama.",
    icon: "⏱",
  },
  {
    tag: "04",
    label: "Tooling",
    title: "Live console",
    body: "Watch bot output in real time. Chat, events, errors — streamed to your browser.",
    icon: "📡",
  },
  {
    tag: "05",
    label: "Scale",
    title: "Multi-account",
    body: "Manage hundreds of accounts from one unified command center.",
    icon: "📊",
  },
  {
    tag: "06",
    label: "Deploy",
    title: "Instant deploy",
    body: "Drop credentials and your fleet is beaming in under a minute. No config files.",
    icon: "🚀",
  },
];

const PLANS = [
  {
    name: "Starter",
    price: 15,
    bots: 1,
    hours: 5,
    feats: [
      "1 concurrent bot",
      "5 bot-hours / day",
      "Basic telemetry & logs",
      "Standard beam speed",
      "Community Discord",
    ],
    highlight: false,
  },
  {
    name: "Pro",
    price: 25,
    bots: 5,
    hours: 7,
    feats: [
      "5 concurrent bots",
      "7 bot-hours / day",
      "Full analytics & live console",
      "Advanced scanner + priority queue",
      "All plugins included",
      "Fast beam speed",
      "Priority Discord support",
    ],
    highlight: true,
  },
  {
    name: "Enterprise",
    price: 50,
    bots: 20,
    hours: 14,
    feats: [
      "20 concurrent bots",
      "14 bot-hours / day",
      "Custom behaviors & API access",
      "Maximum beam speed",
      "Early access to features",
      "Dedicated 1:1 support",
    ],
    highlight: false,
  },
];

const REVIEWS = [
  {
    text: "went from beaming manually for hours to having 12 bots running while i sleep. its unfair.",
    name: "@prinsi_",
    stars: 5,
  },
  {
    text: "excellent. can recommend to anyone tired of manual beams. setup took me 4 minutes.",
    name: "@cpvpary",
    stars: 5,
  },
  {
    text: "wasn't sure at first. got 2 clean hits in under an hour. its really good.",
    name: "@s0wad",
    stars: 4,
  },
  {
    text: "the live console is stupid good. i just leave it open on my second monitor.",
    name: "@korr1n",
    stars: 5,
  },
];

const FAQ = [
  {
    q: "What exactly is LuauX?",
    a: "A hosted fleet manager for Minecraft bots. You provide credentials, we handle proxies, uptime, anti-detection, and streaming logs.",
  },
  {
    q: "Is it safe? Will my accounts get banned?",
    a: "Every bot gets a unique fingerprint, rotating residential proxy, and humanized movement patterns. We can't promise zero risk on any server, but detection is rare.",
  },
  {
    q: "How do I sign in?",
    a: "Continue with Discord. Your first bot deploys in under 60 seconds after linking credentials.",
  },
  {
    q: "Can I cancel my subscription?",
    a: "Any time, no questions. Crypto billing is monthly — cancel and the fleet spins down at the end of the cycle.",
  },
  {
    q: "Do you offer custom plans?",
    a: "Yes. If you need more than 20 concurrent bots or a private cluster, message us in Discord.",
  },
];

function Logo() {
  return (
    <div className="relative grid grid-cols-2 grid-rows-2 gap-[2px] rounded-md bg-primary p-1 glow-sm">
      <span className="h-1.5 w-1.5 bg-primary-foreground" />
      <span className="h-1.5 w-1.5 bg-primary-foreground/50" />
      <span className="h-1.5 w-1.5 bg-primary-foreground/50" />
      <span className="h-1.5 w-1.5 bg-primary-foreground" />
    </div>
  );
}

function GoldDivider() {
  return (
    <div className="relative h-px w-full">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-4 bg-primary/10 blur-xl rounded-full" />
    </div>
  );
}

function FloatingParticles() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Main radial glow */}
      <div
        className="absolute left-1/2 top-0 h-[700px] w-[900px] -translate-x-1/2 rounded-full blur-[150px] animate-glow-breathe"
        style={{
          background: "radial-gradient(circle, oklch(0.79 0.16 85 / 0.15), transparent 70%)",
        }}
      />
      {/* Secondary glow bottom right */}
      <div
        className="absolute right-0 bottom-0 h-[500px] w-[500px] rounded-full blur-[120px] opacity-40"
        style={{
          background: "radial-gradient(circle, oklch(0.79 0.16 85 / 0.08), transparent 70%)",
        }}
      />
      {/* Floating gold orbs */}
      <div className="absolute top-[20%] left-[10%] w-2 h-2 rounded-full bg-primary/30 animate-float" style={{ animationDelay: "0s" }} />
      <div className="absolute top-[40%] right-[15%] w-1.5 h-1.5 rounded-full bg-primary/20 animate-float-slow" style={{ animationDelay: "2s" }} />
      <div className="absolute top-[60%] left-[20%] w-1 h-1 rounded-full bg-primary/25 animate-float" style={{ animationDelay: "4s" }} />
      <div className="absolute top-[30%] right-[25%] w-2.5 h-2.5 rounded-full bg-primary/15 animate-float-slow" style={{ animationDelay: "1s" }} />
      <div className="absolute top-[70%] right-[10%] w-1.5 h-1.5 rounded-full bg-primary/20 animate-float" style={{ animationDelay: "3s" }} />
      <div className="absolute top-[15%] left-[40%] w-1 h-1 rounded-full bg-primary/25 animate-float-slow" style={{ animationDelay: "5s" }} />
    </div>
  );
}

function AnimatedCounter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const duration = 1500;
          const steps = 60;
          const increment = target / steps;
          let current = 0;
          const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
              setCount(target);
              clearInterval(timer);
            } else {
              setCount(Math.floor(current));
            }
          }, duration / steps);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

function Index() {
  const [tick, setTick] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [authOpen, setAuthOpen] = useState(false);
  const [me, setMe] = useState<{
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        setMe(d.user);
        if (
          d.user &&
          typeof window !== "undefined" &&
          window.location.search.includes("signed_in=1")
        ) {
          navigate({ to: "/dashboard" });
        }
      })
      .catch(() => {});
    if (typeof window !== "undefined" && window.location.search.includes("signed_in=1")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const openAuth = () => {
    if (me) {
      navigate({ to: "/dashboard" });
      return;
    }
    setAuthOpen(true);
  };
  const startDiscord = () => {
    const url = "/api/discord/login";
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = new URL(url, window.location.origin).toString();
        return;
      }
    } catch {
      /* fall through */
    }
    window.location.href = url;
  };
  const signOut = async () => {
    await fetch("/api/discord/logout", { method: "POST" });
    setMe(null);
  };

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1400);
    return () => clearInterval(id);
  }, []);

  const shown = 3 + (tick % (LOG_LINES.length - 2));
  const visibleLogs = LOG_LINES.slice(0, shown);

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden">
      <FloatingParticles />

      {/* NAV */}
      <header className="sticky top-4 z-40 mx-auto max-w-6xl px-4">
        <div className="rounded-2xl border border-border/60 glass-card flex items-center justify-between px-5 py-2.5">
          <a href="#top" className="flex items-center gap-3">
            <Logo />
            <span className="font-display text-sm font-bold tracking-[0.2em]">LUAUX</span>
          </a>
          <nav className="hidden md:flex items-center gap-1 text-xs">
            {[
              ["Features", "#features"],
              ["Console", "#console"],
              ["Pricing", "#pricing"],
              ["FAQ", "#faq"],
            ].map(([l, h]) => (
              <a
                key={h}
                href={h}
                className="rounded-full px-3 py-1.5 text-muted-foreground transition-all duration-200 hover:bg-primary/10 hover:text-primary"
              >
                {l}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {me ? (
              <>
                <div className="hidden sm:flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs">
                  {me.avatar && <img src={me.avatar} alt="" className="h-5 w-5 rounded-full" />}
                  <span className="text-foreground/90">{me.global_name || me.username}</span>
                </div>
                <button
                  onClick={signOut}
                  className="rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-semibold hover:bg-primary/10 hover:text-primary transition-all duration-200"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={openAuth}
                  className="rounded-full border border-border/60 bg-card/60 px-4 py-1.5 text-xs font-semibold hover:bg-primary/10 hover:text-primary transition-all duration-200"
                >
                  Sign up
                </button>
                <button
                  onClick={openAuth}
                  className="rounded-full btn-gold px-4 py-1.5 text-xs"
                >
                  Get started →
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* HERO */}
      <section id="top" className="mx-auto max-w-6xl px-6 pt-28 pb-28 md:pt-40 text-center relative">
        {/* Orbiting ring decoration */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] md:w-[700px] md:h-[700px] pointer-events-none" aria-hidden>
          <div className="absolute inset-0 rounded-full border border-primary/5 animate-[spin_60s_linear_infinite]" />
          <div className="absolute inset-8 rounded-full border border-primary/8 animate-[spin_45s_linear_infinite_reverse]" />
          <div className="absolute inset-16 rounded-full border border-primary/4 animate-[spin_30s_linear_infinite]" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary/40" />
          <div className="absolute bottom-0 right-1/4 w-1 h-1 rounded-full bg-primary/30" />
          <div className="absolute top-1/3 left-0 w-1 h-1 rounded-full bg-primary/25" />
        </div>

        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 glass-card px-4 py-1.5 text-[11px] text-muted-foreground animate-fade-in-up">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-primary animate-ping opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            128 nodes online · eu-fra 18ms
          </div>

          <h1 className="mt-10 font-display text-6xl md:text-8xl lg:text-[96px] font-semibold leading-[0.88] tracking-tight text-gradient animate-fade-in-up stagger-2" style={{ opacity: 0 }}>
            Stop beaming
            <br />
            <span className="text-shimmer" style={{ textShadow: "0 0 60px oklch(0.79 0.16 85 / 0.3)" }}>
              manually.
            </span>
          </h1>

          <h2 className="mt-4 font-display text-3xl md:text-5xl font-semibold leading-[1] tracking-tight animate-fade-in-up stagger-3" style={{ opacity: 0 }}>
            <span className="text-primary" style={{ textShadow: "0 0 40px oklch(0.79 0.16 85 / 0.4)" }}>
              Let the fleet do it.
            </span>
          </h2>

          <p className="mx-auto mt-8 max-w-xl text-base md:text-lg text-muted-foreground leading-relaxed animate-fade-in-up stagger-4" style={{ opacity: 0 }}>
            Deploy a stealth Minecraft bot fleet in under a minute. Live logs, anti-detect proxies,
            24/7 uptime — no babysitting, no scripts, no cope.
          </p>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-4 animate-fade-in-up stagger-5" style={{ opacity: 0 }}>
            <button
              onClick={openAuth}
              className="rounded-full btn-gold-lg px-10 py-4 text-sm"
            >
              Get started free →
            </button>
            <a
              href="#console"
              className="rounded-full border border-border/60 bg-card/60 px-8 py-4 text-sm font-semibold text-foreground/90 hover:bg-primary/10 hover:text-primary hover:border-primary/30 hover:glow-border transition-all duration-300"
            >
              See it running
            </a>
          </div>

          {/* Stats bar */}
          <div className="mx-auto mt-24 grid max-w-3xl grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border md:grid-cols-3 animate-fade-in-up stagger-6" style={{ opacity: 0 }}>
            {[
              { k: "$10,000+", v: "value beamed", num: 10000, suffix: "+" },
              { k: "99%", v: "uptime", num: 99, suffix: "%" },
              { k: "35s", v: "avg deploy", num: 35, suffix: "s" },
            ].map((s) => (
              <div key={s.v} className="bg-card/80 px-6 py-8 text-left group hover:bg-card transition-all duration-300 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative font-display text-3xl md:text-4xl font-semibold text-gradient-gold">
                  <AnimatedCounter target={s.num} suffix={s.suffix} />
                </div>
                <div className="relative mt-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
                  {s.v}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <GoldDivider />

      {/* CONSOLE */}
      <section id="console" className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="grid gap-12 lg:grid-cols-12 items-center">
          <div className="lg:col-span-5 animate-slide-in-left">
            <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-primary">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary animate-ping opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              live
            </div>
            <h2 className="mt-4 font-display text-4xl md:text-5xl font-semibold leading-[1.05] tracking-tight text-gradient">
              Watch your fleet
              <br />
              run itself.
            </h2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              Every bot streams its activity in real time and answers chat autonomously. No
              babysitting — just a browser tab and a coffee.
            </p>
            <div className="mt-8 space-y-4">
              {[
                ["2,418", "AI replies today"],
                ["128", "nodes online"],
                ["18ms", "avg latency (eu-fra)"],
              ].map(([k, v]) => (
                <div
                  key={v}
                  className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-4 group"
                >
                  <span className="text-xs uppercase tracking-widest text-muted-foreground group-hover:text-foreground/70 transition-colors">
                    {v}
                  </span>
                  <span className="font-display text-2xl font-semibold text-gradient-gold">{k}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 animate-slide-in-right">
            <div className="rounded-2xl border border-border/60 overflow-hidden bg-card/80 glow-sm font-mono text-xs relative">
              {/* Terminal glow effect */}
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-primary/10 via-transparent to-primary/5 pointer-events-none" />
              <div className="relative">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 bg-card/90">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-primary/70" />
                  </div>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    luaux@runner ~ tail -f fleet.log
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-primary">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-primary animate-ping opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                    live
                  </span>
                </div>
                <div className="p-5 space-y-1.5 min-h-[380px] scanlines">
                  {visibleLogs.map((l, i) => {
                    const tagColor: Record<string, string> = {
                      JOIN: "bg-primary/15 text-primary border-primary/30",
                      SEND: "bg-yellow-400/8 text-yellow-300 border-yellow-400/20",
                      CHAT: "bg-sky-400/8 text-sky-300 border-sky-400/20",
                      AI: "bg-fuchsia-400/8 text-fuchsia-300 border-fuchsia-400/20",
                      HOOK: "bg-violet-400/8 text-violet-300 border-violet-400/20",
                      AFK: "bg-muted text-muted-foreground border-border",
                    };
                    return (
                      <div key={i} className="flex items-start gap-3 leading-relaxed" style={{ animationDelay: `${i * 0.05}s` }}>
                        <span className="text-muted-foreground/50">{l.t}</span>
                        <span
                          className={`rounded-md border px-1.5 py-px text-[10px] font-semibold uppercase ${tagColor[l.tag] || "bg-muted text-muted-foreground border-border"}`}
                        >
                          {l.tag}
                        </span>
                        <span className="text-primary/80">{l.bot}</span>
                        <span className="text-foreground/70">{l.msg}</span>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2 pt-2 text-muted-foreground">
                    <span className="text-primary">›</span>
                    <span className="terminal-cursor" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <GoldDivider />

      {/* FEATURES */}
      <section id="features" className="bg-card/20 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/3 via-transparent to-primary/3 pointer-events-none" />
        <div className="mx-auto max-w-6xl px-6 py-24 relative">
          <div className="mb-16 flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// platform</div>
              <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold max-w-2xl leading-tight tracking-tight text-gradient">
                Everything you need to
                <br />
                beam at scale.
              </h2>
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">
              A focused toolkit for operators. No bloat. No feature bingo. Six things, done
              properly.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.tag}
                className="group relative rounded-2xl border border-border/60 bg-card/60 p-6 transition-all duration-500 hover:border-primary/30 hover:bg-card/80 hover:-translate-y-2 hover:glow-sm"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                {/* Hover gradient overlay */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-primary/8 via-primary/2 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                {/* Top glow line on hover */}
                <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative">
                  <div className="mb-6 flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground/60">{f.tag}</span>
                    <span className="rounded-full border border-primary/20 bg-primary/8 px-2.5 py-0.5 text-[10px] uppercase tracking-widest text-primary">
                      {f.label}
                    </span>
                  </div>
                  <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-300">{f.icon}</div>
                  <h3 className="font-display text-2xl font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                  <div className="mt-6 inline-flex items-center gap-1 text-xs text-primary opacity-0 translate-x-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-2">
                    Learn more →
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <GoldDivider />

      {/* PRICING */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="mb-16 text-center">
          <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// pricing</div>
          <h2 className="mt-3 font-display text-4xl md:text-6xl font-semibold tracking-tight text-gradient">
            Simple. Transparent. <span className="text-shimmer" style={{ textShadow: "0 0 40px oklch(0.79 0.16 85 / 0.3)" }}>Crypto.</span>
          </h2>
          <p className="mt-5 text-muted-foreground">
            Pay monthly with crypto. Cancel anytime. 24h free trial — no payment required.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3 items-start">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`relative rounded-2xl p-8 transition-all duration-500 group ${
                p.highlight
                  ? "border-2 border-primary/60 bg-card/80 lg:-translate-y-4 glow-primary pricing-glow"
                  : "border border-border/60 bg-card/60 hover:border-primary/20 hover:-translate-y-2 hover:glow-sm"
              }`}
            >
              {p.highlight && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-primary via-primary/90 to-primary/80 text-primary-foreground px-5 py-1 text-[10px] font-semibold uppercase tracking-widest shadow-lg shadow-primary/30">
                  Most popular
                </div>
              )}
              {/* Shimmer border on highlight */}
              {p.highlight && (
                <div className="absolute inset-0 rounded-2xl gold-shimmer pointer-events-none" style={{ mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", maskComposite: "exclude", WebkitMaskComposite: "xor", padding: "2px" }} />
              )}
              <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                {p.name}
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="font-display text-6xl font-semibold text-gradient-gold">
                  ${p.price}
                </span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/60 bg-card/80 p-3 group-hover:border-primary/15 transition-colors duration-300">
                  <div className="font-display text-2xl font-semibold text-gradient-gold">{p.bots}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    bots
                  </div>
                </div>
                <div className="rounded-xl border border-border/60 bg-card/80 p-3 group-hover:border-primary/15 transition-colors duration-300">
                  <div className="font-display text-2xl font-semibold text-gradient-gold">{p.hours}h</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    daily
                  </div>
                </div>
              </div>
              <ul className="mt-6 space-y-3 text-sm">
                {p.feats.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-muted-foreground">
                    <span className="mt-0.5 text-primary text-xs">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={openAuth}
                className={`mt-8 block w-full text-center rounded-full py-4 text-xs font-semibold uppercase tracking-widest transition-all duration-400 ${
                  p.highlight
                    ? "btn-gold-lg"
                    : "border border-border/60 bg-card/80 hover:bg-primary/10 hover:text-primary hover:border-primary/30 hover:glow-border"
                }`}
              >
                Get started →
              </button>
            </div>
          ))}
        </div>
      </section>

      <GoldDivider />

      {/* REVIEWS */}
      <section className="bg-card/20 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/3 via-transparent to-primary/3 pointer-events-none" />
        <div className="mx-auto max-w-6xl px-6 py-24 relative">
          <div className="mb-14 flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// reviews</div>
              <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold max-w-xl leading-tight tracking-tight text-gradient">
                Loved by operators
                <br />
                worldwide.
              </h2>
            </div>
            <div className="flex items-center gap-4">
              <div className="font-display text-5xl font-semibold text-gradient-gold">4.7</div>
              <div className="text-xs uppercase tracking-widest">
                <div className="text-primary text-lg">★★★★★</div>
                <div className="mt-1 text-muted-foreground">based on 247 reviews</div>
              </div>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {REVIEWS.map((r, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border/60 bg-card/60 p-6 transition-all duration-500 hover:border-primary/20 hover:-translate-y-2 hover:glow-sm group relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="relative">
                  <div className="text-primary text-sm">
                    {"★".repeat(r.stars)}
                    <span className="text-muted-foreground/20">{"★".repeat(5 - r.stars)}</span>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-foreground/80">"{r.text}"</p>
                  <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-6 w-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] text-primary font-semibold">
                      {r.name[1]?.toUpperCase()}
                    </span>
                    <span>{r.name}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <GoldDivider />

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-4xl px-6 py-24 md:py-32">
        <div className="mb-12 text-center">
          <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// faq</div>
          <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight text-gradient">
            Frequently asked.
          </h2>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/60 overflow-hidden">
          {FAQ.map((f, i) => {
            const open = openFaq === i;
            return (
              <button
                key={i}
                onClick={() => setOpenFaq(open ? null : i)}
                className={`block w-full text-left border-b border-border/60 last:border-b-0 p-6 transition-all duration-300 ${
                  open ? "bg-primary/5" : "hover:bg-primary/5"
                }`}
              >
                <div className="flex items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-xs text-primary">0{i + 1}</span>
                    <span className="font-display text-base md:text-lg font-medium">{f.q}</span>
                  </div>
                  <span
                    className={`font-display text-2xl transition-transform duration-300 ${open ? "rotate-45 text-primary" : "text-muted-foreground"}`}
                  >
                    +
                  </span>
                </div>
                <div className={`grid transition-all duration-300 ${open ? "grid-rows-[1fr] mt-4" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden">
                    <p className="pl-10 text-sm text-muted-foreground max-w-2xl leading-relaxed">{f.a}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card/60 px-8 py-24 text-center group">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/8 via-transparent to-primary/8 pointer-events-none" />
          <div className="absolute -inset-px rounded-3xl bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          {/* Decorative orbs */}
          <div className="absolute top-10 left-10 w-32 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none animate-glow-breathe" />
          <div className="absolute bottom-10 right-10 w-40 h-40 bg-primary/5 rounded-full blur-3xl pointer-events-none animate-glow-breathe" style={{ animationDelay: "2s" }} />
          <div className="relative">
            <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// ready</div>
            <h2 className="mt-4 font-display text-5xl md:text-7xl font-semibold leading-[0.95] tracking-tight text-gradient">
              Ready to <span className="text-shimmer" style={{ textShadow: "0 0 60px oklch(0.79 0.16 85 / 0.4)" }}>beam?</span>
            </h2>
            <p className="mx-auto mt-6 max-w-md text-muted-foreground">
              Sign in with Discord. First bot deployed in under a minute.
            </p>
            <button
              onClick={openAuth}
              className="mt-8 inline-flex items-center gap-2 rounded-full btn-gold-lg px-10 py-4 text-sm"
            >
              Continue with Discord →
            </button>
            <div className="mt-5 text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              No credit card · 24h free trial
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mx-auto max-w-6xl px-6 py-10 flex flex-wrap items-center justify-between gap-4 text-xs uppercase tracking-widest text-muted-foreground border-t border-border/60">
        <div className="flex items-center gap-2">
          <Logo />
          <span>© 2026 LuauX</span>
        </div>
        <div className="flex gap-6">
          <a
            href="https://discord.gg/n6nEcvwzYQ"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary transition-colors duration-200"
          >
            Discord
          </a>
          <a
            href="https://t.me/luauxx"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary transition-colors duration-200"
          >
            Telegram
          </a>
          <a href="#" className="hover:text-primary transition-colors duration-200">
            Docs
          </a>
          <a href="#" className="hover:text-primary transition-colors duration-200">
            Status
          </a>
          <a href="#" className="hover:text-primary transition-colors duration-200">
            Terms
          </a>
        </div>
      </footer>

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onStart={startDiscord} me={me} />}
    </div>
  );
}

function AuthModal({
  onClose,
  onStart,
  me,
}: {
  onClose: () => void;
  onStart: () => void;
  me: { id: string; username: string; global_name: string | null; avatar: string | null } | null;
}) {
  const [loading, setLoading] = useState(false);

  const handleStart = () => {
    setLoading(true);
    onStart();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-3xl border border-border/60 glass-card p-8 glow-primary animate-fade-in-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Background glow */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/8 via-transparent to-primary/5 pointer-events-none" />
        <button
          onClick={onClose}
          className="absolute top-3 right-3 h-8 w-8 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-200 text-lg"
          aria-label="Close"
        >
          ×
        </button>

        <div className="relative flex flex-col items-center text-center">
          <div className="relative">
            {loading && (
              <div
                aria-hidden
                className="absolute inset-[-14px] rounded-full border-2 border-primary/30 border-t-primary animate-spin"
              />
            )}
            <img
              src={luauxLogo}
              alt="LuauX"
              className={`h-20 w-20 rounded-2xl border border-border/60 bg-background p-2 ${loading ? "animate-pulse" : ""}`}
            />
          </div>

          <div className="mt-6 font-display text-3xl font-semibold tracking-tight text-gradient">
            LuauX
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {me
              ? `Signed in as ${me.global_name || me.username}`
              : loading
                ? "Redirecting to Discord…"
                : "Sign up with Discord to spin up your fleet."}
          </p>

          {me ? (
            <div className="mt-6 w-full rounded-xl border border-border/60 bg-card/80 p-4 flex items-center gap-3">
              {me.avatar && <img src={me.avatar} alt="" className="h-10 w-10 rounded-full" />}
              <div className="text-left">
                <div className="text-sm font-semibold">{me.global_name || me.username}</div>
                <div className="text-[11px] text-muted-foreground">Auto-joined LuauX Discord ✓</div>
              </div>
            </div>
          ) : (
            <button
              onClick={handleStart}
              disabled={loading}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#5865F2] text-white px-6 py-3 text-sm font-semibold transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-[#5865F2]/20 disabled:opacity-70"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3a13.7 13.7 0 0 0-.617 1.264 18.298 18.298 0 0 0-5.878 0A13.5 13.5 0 0 0 9.44 3a19.736 19.736 0 0 0-3.76 1.369C1.966 9.834.94 15.148 1.453 20.383a19.9 19.9 0 0 0 6.02 3.049c.484-.655.915-1.352 1.286-2.084-.706-.264-1.379-.59-2.02-.972.17-.126.336-.257.497-.393a14.183 14.183 0 0 0 12.528 0c.163.14.329.271.499.393-.643.383-1.317.71-2.023.973.371.732.802 1.428 1.287 2.083a19.79 19.79 0 0 0 6.021-3.049c.6-6.057-1.041-11.324-4.231-16.014zM8.02 17.212c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42s2.176 1.086 2.156 2.42c0 1.335-.954 2.42-2.156 2.42zm7.974 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42s2.176 1.086 2.156 2.42c0 1.335-.954 2.42-2.156 2.42z" />
              </svg>
              {loading ? "Connecting…" : "Continue with Discord"}
            </button>
          )}

          <p className="mt-5 text-[10px] uppercase tracking-widest text-muted-foreground">
            You'll auto-join our Discord server
          </p>
        </div>
      </div>
    </div>
  );
}
