import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Zap,
  Shield,
  Clock,
  Radio,
  BarChart3,
  Rocket,
  Bot,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Check,
  ArrowRight,
} from "lucide-react";
import luauxLogo from "@/assets/luaux-logo.png";
import { useReveal } from "@/hooks/use-reveal";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "LuauX — Automated Minecraft bot management" },
      {
        name: "description",
        content:
          "Deploy stealthy Minecraft bots in under a minute. Live logs, anti-detect proxies, 24/7 uptime.",
      },
      { property: "og:title", content: "LuauX — Automated Minecraft bot fleets" },
      {
        property: "og:description",
        content:
          "Deploy stealthy Minecraft bot fleets in under a minute. Live logs, anti-detect proxies, 24/7 uptime.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://luaux.wtf/" },
      { property: "og:image", content: "https://luaux.wtf/og.png" },
      { name: "twitter:image", content: "https://luaux.wtf/og.png" },
    ],
    links: [{ rel: "canonical", href: "https://luaux.wtf/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "LuauX",
          applicationCategory: "DeveloperApplication",
          operatingSystem: "Web",
          url: "https://luaux.wtf",
          description:
            "Deploy stealthy Minecraft bot fleets in under a minute. Live logs, anti-detect proxies, 24/7 uptime.",
          offers: [
            { "@type": "Offer", name: "Starter", price: "15", priceCurrency: "USD", description: "1 bot, 5 hours/day" },
            { "@type": "Offer", name: "Pro", price: "25", priceCurrency: "USD", description: "5 bots, 7 hours/day" },
            { "@type": "Offer", name: "Enterprise", price: "50", priceCurrency: "USD", description: "20 bots, 14 hours/day" },
          ],
        }),
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
  { t: "16:00:46", tag: "HOOK", bot: "vexil", msg: "discord webhook · reply logged" },
  { t: "16:00:47", tag: "AFK", bot: "nyxara", msg: "anti-afk rotation · idle drift" },
  { t: "16:00:48", tag: "JOIN", bot: "korrin", msg: "connected · 18ms eu-fra" },
  { t: "16:00:49", tag: "SEND", bot: "korrin", msg: "/pay untualab 64 diamond_block" },
];

const FEATURES = [
  {
    tag: "01",
    label: "Automation",
    title: "Smart automation",
    body: "Spin up dozens of bots with shared behavior profiles. Load balancing distributes tasks across the network automatically.",
    Icon: Zap,
  },
  {
    tag: "02",
    label: "Stealth",
    title: "Undetected",
    body: "Rotating proxies, humanlike movement and unique fingerprints for every session.",
    Icon: Shield,
  },
  {
    tag: "03",
    label: "Reliability",
    title: "24/7 uptime",
    body: "Bots run continuously. No manual restarts, no babysitting, no drama.",
    Icon: Clock,
  },
  {
    tag: "04",
    label: "Tooling",
    title: "Live console",
    body: "Watch bot output in real time. Chat, events, errors — streamed to your browser.",
    Icon: Radio,
  },
  {
    tag: "05",
    label: "Scale",
    title: "Multi-account",
    body: "Manage hundreds of accounts from one unified command center.",
    Icon: BarChart3,
  },
  {
    tag: "06",
    label: "Deploy",
    title: "Instant deploy",
    body: "Drop credentials and your bots are beaming in under a minute. No config files.",
    Icon: Rocket,
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
      "Standard speed",
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
      "Fast speed",
      "Priority Discord support",
    ],
    highlight: false,
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
      "Maximum speed",
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
  },
  {
    text: "excellent. can recommend to anyone tired of manual beams. setup took me 4 minutes.",
    name: "@cpvpary",
  },
  {
    text: "wasn't sure at first. got 2 clean hits in under an hour. its really good.",
    name: "@s0wad",
  },
  {
    text: "the live console is stupid good. i just leave it open on my second monitor.",
    name: "@korr1n",
  },
];

const FAQ = [
  {
    q: "What exactly is LuauX?",
    a: "A hosted bot manager for Minecraft. You provide credentials, we handle proxies, uptime, anti-detection, and streaming logs.",
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
    a: "Any time, no questions. Crypto billing is monthly — cancel and your bots spin down at the end of the cycle.",
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
  // Static gradient only — no blur filters (they destroy paint performance)
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.05] via-transparent to-transparent" />
    </div>
  );
}

function Index() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [authOpen, setAuthOpen] = useState(false);
  const [me, setMe] = useState<{
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  } | null>(null);
  const navigate = useNavigate();
  useReveal([me]);

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

  // Static demo log lines — no interval re-renders (was a major lag source)
  const visibleLogs = LOG_LINES.slice(0, 6);

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden">
      <FloatingParticles />

      {/* NAV */}
      <header className="sticky top-4 z-40 mx-auto max-w-6xl px-4">
        <div         className="rounded-2xl border border-border/60 bg-card flex items-center justify-between px-5 py-2.5">
          <a href="#top" className="flex items-center gap-3">
            <Logo />
            <span className="font-display text-sm font-extrabold tracking-[0.18em]">LUAUX</span>
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
                <Link
                  to="/dashboard"
                  className="rounded-full btn-gold px-4 py-1.5 text-xs"
                >
                  Go to dashboard
                </Link>
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
                  Get started
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
      {/* HERO */}
      <section id="top" className="mx-auto max-w-6xl px-6 pt-28 pb-28 md:pt-40 text-center relative">
        {/* Orbiting ring decoration */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] md:w-[700px] md:h-[700px] pointer-events-none" aria-hidden>

          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary/40" />
          <div className="absolute bottom-0 right-1/4 w-1 h-1 rounded-full bg-primary/30" />
          <div className="absolute top-1/3 left-0 w-1 h-1 rounded-full bg-primary/25" />
        </div>

        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-4 py-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            Hosted bots · live console
          </div>

          <h1 className="mt-10 font-display text-6xl md:text-8xl lg:text-[96px] font-extrabold leading-[0.88] tracking-tight text-gradient">
            Stop beaming
            <br />
            <span className="text-primary">manually.</span>
          </h1>

          <h2 className="mt-4 font-display text-3xl md:text-5xl font-extrabold leading-[1] tracking-tight">
            <span className="text-primary">Let the bots do it.</span>
          </h2>

          <p className="mx-auto mt-8 max-w-xl text-base md:text-lg font-semibold text-muted-foreground leading-relaxed">
            Deploy a stealth Minecraft bot army in under a minute. Live logs, anti-detect proxies,
            24/7 uptime — no babysitting, no scripts, no cope.
          </p>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            {me ? (
              <Link
                to="/dashboard"
                className="rounded-full btn-gold-lg px-10 py-4 text-sm"
              >
                Go to dashboard
              </Link>
            ) : (
              <button
                onClick={openAuth}
                className="rounded-full btn-gold-lg px-10 py-4 text-sm"
              >
                Get started free
              </button>
            )}
            <a
              href="#console"
              className="rounded-full border border-border/60 bg-card/60 px-8 py-4 text-sm font-semibold text-foreground/90 hover:bg-primary/10 hover:text-primary hover:border-primary/30 hover:glow-border transition-all duration-300"
            >
              See it running
            </a>
          </div>

        </div>
      </section>

      <GoldDivider />

      {/* CONSOLE */}
      <section id="console" className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="grid gap-12 lg:grid-cols-12 items-center">
          <div className="lg:col-span-5">
            <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-primary">
              <span className="inline-flex h-2 w-2 rounded-full bg-primary" />
              live
            </div>
              <h2 className="mt-4 font-display text-4xl md:text-5xl font-extrabold leading-[1.05] tracking-tight text-gradient">
                Watch your bots
                <br />
                run themselves.
              </h2>
              <p className="mt-5 font-semibold text-muted-foreground leading-relaxed">
                Every bot streams its activity in real time and answers chat autonomously. No
                babysitting — just a browser tab and a coffee.
              </p>
            <div className="mt-8 space-y-4">
              {[
                ["Live", "console streaming"],
                ["Auto", "chat replies"],
                ["Hosted", "no setup scripts"],
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

          <div className="lg:col-span-7">
            <div className="rounded-2xl border border-border/40 overflow-hidden bg-card font-mono text-xs relative">
              <div className="relative">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 bg-card">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-primary/70" />
                  </div>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    luaux@runner ~ tail -f bot.log
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-primary">
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                    live
                  </span>
                </div>
                <div className="p-5 space-y-1.5 min-h-[320px] bg-[oklch(0.03_0_0)]">
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
                      <div key={i} className="flex items-start gap-3 leading-relaxed">
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
                    <span className="text-primary">{'>'}</span>
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
            <div className="reveal-up">
              <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// platform</div>
              <h2 className="mt-3 font-display text-4xl md:text-5xl font-extrabold max-w-2xl leading-tight tracking-tight text-gradient">
                Everything you need to
                <br />
                automate at scale.
              </h2>
            </div>
            <p className="max-w-sm text-sm text-muted-foreground reveal-up delay-2">
              A focused toolkit for operators. No bloat. No feature bingo. Six things, done
              properly.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => {
              const delays = ["delay-1", "delay-2", "delay-3", "delay-4", "delay-5", "delay-6"] as const;
              const delayClass = delays[Math.min(i, delays.length - 1)];
              return (
              <div
                key={f.tag}
                className={`group relative rounded-2xl border border-border/40 bg-card/50 p-6 transition-colors duration-200 hover:border-primary/30 hover:bg-card/70 reveal-up ${delayClass}`}
              >
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-primary/8 via-primary/2 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
                <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative">
                  <div className="mb-6 flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground/60">{f.tag}</span>
                    <span className="rounded-full border border-primary/20 bg-primary/8 px-2.5 py-0.5 text-[10px] uppercase tracking-widest text-primary shadow-[0_0_8px_oklch(0.79_0.16_85_/_0.1)]">
                      {f.label}
                    </span>
                  </div>
                  <div className="mb-4 h-12 w-12 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center group-hover:bg-primary/20 group-hover:shadow-[0_0_20px_oklch(0.79_0.16_85_/_0.2)] transition-all duration-500 icon-pop">
                    <f.Icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-display text-2xl font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                  <div className="mt-6 inline-flex items-center gap-1 text-xs text-primary opacity-0 translate-x-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-2">
                    Learn more
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        </div>
      </section>

      <GoldDivider />

      {/* PRICING */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="mb-16 text-center reveal-up">
          <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// pricing</div>
          <h2 className="mt-3 font-display text-4xl md:text-6xl font-extrabold tracking-tight text-gradient">
            Simple. Transparent. <span className="text-primary">Crypto.</span>
          </h2>
          <p className="mt-5 font-semibold text-muted-foreground">
            Pay monthly with crypto. Cancel anytime.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3 items-start">
          {PLANS.map((p, pi) => {
            const delays = ["delay-1", "delay-2", "delay-3"] as const;
            const delayClass = delays[Math.min(pi, delays.length - 1)];
            return (
            <div
              key={p.name}
              className={`relative rounded-2xl p-8 transition-colors duration-200 group reveal-scale ${delayClass} border border-border/40 bg-card/50 hover:border-primary/30`}
            >
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
                    <Check className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {me ? (
                <Link
                  to="/dashboard"
                  className="mt-8 block w-full text-center rounded-full py-4 text-xs font-semibold uppercase tracking-widest transition-all duration-400 border border-border/60 bg-card/80 hover:bg-primary/10 hover:text-primary hover:border-primary/30 hover:glow-border"
                >
                  Go to dashboard
                </Link>
              ) : (
                <button
                  onClick={openAuth}
                  className="mt-8 block w-full text-center rounded-full py-4 text-xs font-semibold uppercase tracking-widest transition-all duration-400 border border-border/60 bg-card/80 hover:bg-primary/10 hover:text-primary hover:border-primary/30 hover:glow-border"
                >
                   Get started
                 </button>
               )}
             </div>
            );
          })}
         </div>
       </section>

       <GoldDivider />

       {/* REVIEWS */}
       <section className="bg-card/20 relative">
         <div className="absolute inset-0 bg-gradient-to-b from-primary/3 via-transparent to-primary/3 pointer-events-none" />
         <div className="mx-auto max-w-6xl px-6 py-24 relative">
           <div className="mb-14 flex flex-wrap items-end justify-between gap-6">
             <div className="reveal-left">
               <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// reviews</div>
               <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold max-w-xl leading-tight tracking-tight text-gradient">
                 Loved by operators
                 <br />
                 worldwide.
               </h2>
             </div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground max-w-xs text-right">
              Real operators. Real setups.
              <br />
              Built for people who run bots daily.
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {REVIEWS.map((r, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border/40 bg-card/50 p-6 transition-colors duration-200 hover:border-primary/30 group relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="relative">
                  <p className="text-sm leading-relaxed text-foreground/80">"{r.text}"</p>
                  <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-6 w-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] text-primary font-semibold shadow-[0_0_8px_oklch(0.79_0.16_85_/_0.15)]">
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
        <div className="rounded-2xl border border-border/40 bg-card/50 overflow-hidden">
          {FAQ.map((f, i) => {
            const open = openFaq === i;
            return (
              <button
                key={i}
                onClick={() => setOpenFaq(open ? null : i)}
                className={`block w-full text-left border-b border-border/40 last:border-b-0 p-6 transition-all duration-300 ${
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
          <div className="relative">
            <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// ready</div>
            <h2 className="mt-4 font-display text-5xl md:text-7xl font-semibold leading-[0.95] tracking-tight text-gradient">
              Ready to <span className="text-primary">start?</span>
            </h2>
            <p className="mx-auto mt-6 max-w-md text-muted-foreground">
              Sign in with Discord. First bot deployed in under a minute.
            </p>
            <button
              onClick={openAuth}
              className="mt-8 inline-flex items-center gap-2 rounded-full btn-gold-lg px-10 py-4 text-sm"
            >
              Continue with Discord <ArrowRight className="h-4 w-4" />
            </button>
            <div className="mt-5 text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              Crypto payments · Discord login
            </div>
          </div>
        </div>
      </section>

      </main>
      {/* FOOTER */}
      <footer className="mx-auto max-w-6xl px-6 py-10 flex flex-wrap items-center justify-between gap-4 text-xs uppercase tracking-widest text-muted-foreground border-t border-border/60">
        <div className="flex items-center gap-2">
          <Logo />
          <span>&copy; 2026 LuauX</span>
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
          <a href="#features" className="hover:text-primary transition-colors duration-200">
            Features
          </a>
          <a href="#pricing" className="hover:text-primary transition-colors duration-200">
            Pricing
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
        className="relative w-full max-w-sm rounded-3xl border border-border/60 bg-card p-8 animate-fade-in-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-primary/8 via-transparent to-primary/5 pointer-events-none" />
        <button
          onClick={onClose}
          className="absolute top-3 right-3 h-8 w-8 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-200 text-lg"
          aria-label="Close"
        >
          x
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
                ? "Redirecting to Discord..."
                : "Sign up with Discord to spin up your bots."}
          </p>

          {me ? (
            <div className="mt-6 w-full rounded-xl border border-border/60 bg-card/80 p-4 flex items-center gap-3">
              {me.avatar && <img src={me.avatar} alt="" className="h-10 w-10 rounded-full" />}
              <div className="text-left">
                <div className="text-sm font-semibold">{me.global_name || me.username}</div>
                <div className="text-[11px] text-muted-foreground">Auto-joined LuauX Discord</div>
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
              {loading ? "Connecting..." : "Continue with Discord"}
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
