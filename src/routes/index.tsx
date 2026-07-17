import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Zap,
  Shield,
  Clock,
  Radio,
  BarChart3,
  Rocket,
  MessageSquare,
  Check,
  ArrowRight,
  Bot,
  Sparkles,
  Server,
} from "lucide-react";
import luauxLogo from "@/assets/luaux-logo.png";
import { useReveal } from "@/hooks/use-reveal";

const SITE = "https://luaux.wtf";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "LuauX — Minecraft Bot Manager & Discord Automation" },
      {
        name: "description",
        content:
          "Hosted Minecraft auto-message bots and Discord plugins (spam, auto-reply, verification). Live console, crypto billing from $7/mo, Discord login.",
      },
      {
        name: "keywords",
        content:
          "minecraft bot manager, minecraft auto message, discord auto reply, discord verification bot, bot panel, luaux",
      },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "LuauX — Minecraft Bot Manager & Discord Automation" },
      {
        property: "og:description",
        content:
          "Deploy Minecraft bots and Discord automation from one panel. Live logs. Crypto plans from $7/mo.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/` },
      { property: "og:image", content: `${SITE}/og.png` },
      { property: "og:site_name", content: "LuauX" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "LuauX — Minecraft Bot Manager & Discord Automation" },
      {
        name: "twitter:description",
        content: "Hosted Minecraft bots + Discord plugins. Live console. Crypto billing.",
      },
      { name: "twitter:image", content: `${SITE}/og.png` },
    ],
    links: [{ rel: "canonical", href: `${SITE}/` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${SITE}/#org`,
              name: "LuauX",
              url: SITE,
              logo: `${SITE}/favicon.png`,
              sameAs: ["https://discord.gg/n6nEcvwzYQ", "https://t.me/luauxx"],
            },
            {
              "@type": "WebSite",
              "@id": `${SITE}/#website`,
              url: SITE,
              name: "LuauX",
              publisher: { "@id": `${SITE}/#org` },
              description:
                "Hosted Minecraft bot manager and Discord automation plugins with live console and crypto billing.",
            },
            {
              "@type": "SoftwareApplication",
              name: "LuauX",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              url: SITE,
              description:
                "Deploy Minecraft auto-message bots and Discord plugins from one dashboard.",
              offers: [
                {
                  "@type": "Offer",
                  name: "Starter",
                  price: "7",
                  priceCurrency: "USD",
                  description: "1 concurrent bot, 5 bot-hours / day",
                },
                {
                  "@type": "Offer",
                  name: "Pro",
                  price: "16",
                  priceCurrency: "USD",
                  description: "5 bots, 7 hours/day + Discord plugins",
                },
                {
                  "@type": "Offer",
                  name: "Enterprise",
                  price: "35",
                  priceCurrency: "USD",
                  description: "20 bots, 14 hours/day + Discord plugins",
                },
              ],
            },
            {
              "@type": "FAQPage",
              mainEntity: FAQ.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: f.a },
              })),
            },
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
  { t: "16:00:45", tag: "SEND", bot: "vexil", msg: '/msg S1lent_ → "add me on dc"' },
  { t: "16:00:46", tag: "HOOK", bot: "vexil", msg: "discord webhook · reply logged" },
  { t: "16:00:47", tag: "AFK", bot: "nyxara", msg: "anti-afk rotation · idle drift" },
  { t: "16:00:48", tag: "JOIN", bot: "korrin", msg: "connected · 18ms eu-fra" },
];

const FEATURES = [
  {
    tag: "01",
    label: "Minecraft",
    title: "Auto-message fleets",
    body: "Launch premium accounts to any server. Message packs, intervals, last-DM auto-reply, live console.",
    Icon: Bot,
  },
  {
    tag: "02",
    label: "Discord",
    title: "Spam & auto-reply",
    body: "Channel spam and DM auto-reply for alts — humanized delays, rate-limit protection, live logs.",
    Icon: MessageSquare,
  },
  {
    tag: "03",
    label: "Verify",
    title: "Verification bot",
    body: "Your own bot token. Microsoft OTP flow. Secured accounts land in your dashboard.",
    Icon: Shield,
  },
  {
    tag: "04",
    label: "Console",
    title: "Live output",
    body: "Every bot streams chat, joins, errors, and system events to your browser in real time.",
    Icon: Radio,
  },
  {
    tag: "05",
    label: "Scale",
    title: "Multi-account",
    body: "One panel for Minecraft accounts and Discord tokens. Stop, launch, and monitor together.",
    Icon: BarChart3,
  },
  {
    tag: "06",
    label: "Deploy",
    title: "Under a minute",
    body: "Discord login, pick a plan, paste credentials — bots are running. No local scripts.",
    Icon: Rocket,
  },
];

const PLANS = [
  {
    name: "Starter",
    price: 7,
    bots: 1,
    hours: 5,
    feats: ["1 concurrent bot", "5 bot-hours / day", "Live logs", "Community Discord"],
    highlight: false,
  },
  {
    name: "Pro",
    price: 16,
    bots: 5,
    hours: 7,
    feats: [
      "5 concurrent bots",
      "7 bot-hours / day",
      "Discord Auto-Spam",
      "Discord Auto-Reply",
      "Priority support",
    ],
    highlight: true,
  },
  {
    name: "Enterprise",
    price: 35,
    bots: 20,
    hours: 14,
    feats: [
      "20 concurrent bots",
      "14 bot-hours / day",
      "All Discord plugins",
      "Custom behaviors",
      "Dedicated support",
    ],
    highlight: false,
  },
];

const STATS = [
  { k: "60s", v: "to first bot" },
  { k: "24/7", v: "hosted workers" },
  { k: "$7", v: "plans from" },
  { k: "3", v: "Discord plugins" },
];

const FAQ = [
  {
    q: "What is LuauX?",
    a: "A hosted control panel for Minecraft auto-message bots and Discord automation (spam, auto-reply, verification). You sign in with Discord, buy a plan with crypto, and run bots from the browser.",
  },
  {
    q: "Do I need to host anything?",
    a: "No. LuauX runs the bot worker for you. You only need accounts/tokens and a browser.",
  },
  {
    q: "How do I sign in?",
    a: "Continue with Discord. You’ll join the LuauX server and land in the dashboard.",
  },
  {
    q: "What payments do you accept?",
    a: "Crypto via our checkout (LTC, SOL, and other supported coins). Plans renew monthly; cancel anytime.",
  },
  {
    q: "Can accounts get banned?",
    a: "Any automation has risk. We humanize timing and delays, but no service can guarantee zero bans. Use alt accounts and sensible settings.",
  },
  {
    q: "Do you offer custom plans?",
    a: "Yes — more concurrent bots or private setups. Message us on Discord or Telegram.",
  },
];

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
  }, [navigate]);

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

  const visibleLogs = LOG_LINES.slice(0, 6);

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden">
      {/* Soft background */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,oklch(0.55_0.22_25_/_0.18),transparent)]" />
        <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-background via-transparent to-transparent" />
      </div>

      {/* NAV */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <a href="#top" className="flex items-center gap-2.5 shrink-0">
            <img
              src={luauxLogo}
              alt="LuauX"
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg border border-border/50 bg-card p-0.5"
            />
            <span className="font-display text-sm font-extrabold tracking-[0.14em]">LUAUX</span>
          </a>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {[
              ["Product", "#features"],
              ["Console", "#console"],
              ["Pricing", "#pricing"],
              ["FAQ", "#faq"],
            ].map(([l, h]) => (
              <a
                key={h}
                href={h}
                className="rounded-lg px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              >
                {l}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {me ? (
              <>
                <div className="hidden sm:flex items-center gap-2 rounded-full border border-border/50 bg-card/80 px-2.5 py-1 text-xs">
                  {me.avatar && (
                    <img src={me.avatar} alt="" className="h-5 w-5 rounded-full" width={20} height={20} />
                  )}
                  <span className="max-w-[100px] truncate">{me.global_name || me.username}</span>
                </div>
                <Link
                  to="/dashboard"
                  className="rounded-full bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  Dashboard
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={openAuth}
                  className="hidden sm:inline-flex rounded-full border border-border/60 px-3.5 py-1.5 text-xs font-semibold hover:bg-secondary/50 transition-colors"
                >
                  Log in
                </button>
                <button
                  type="button"
                  onClick={openAuth}
                  className="rounded-full bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold hover:opacity-90 transition-opacity"
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
        <section id="top" className="mx-auto max-w-6xl px-4 sm:px-6 pt-16 pb-20 md:pt-24 md:pb-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-10 items-center">
            <div className="lg:col-span-6 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
                <Sparkles className="h-3 w-3" />
                Minecraft + Discord · one panel
              </div>
              <h1 className="mt-6 font-display text-4xl sm:text-5xl md:text-6xl font-extrabold leading-[1.05] tracking-tight">
                Run bots that{" "}
                <span className="text-primary">actually ship</span>
              </h1>
              <p className="mt-5 text-base md:text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto lg:mx-0">
                Hosted Minecraft auto-message fleets and Discord plugins — live console, crypto
                plans, Discord login. No VPS babysitting.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center lg:justify-start gap-3">
                {me ? (
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-7 py-3 text-sm font-semibold shadow-lg shadow-primary/20 hover:opacity-95 transition-opacity"
                  >
                    Open dashboard <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={openAuth}
                    className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-7 py-3 text-sm font-semibold shadow-lg shadow-primary/20 hover:opacity-95 transition-opacity"
                  >
                    Start free with Discord <ArrowRight className="h-4 w-4" />
                  </button>
                )}
                <a
                  href="#pricing"
                  className="inline-flex items-center rounded-full border border-border/70 bg-card/50 px-6 py-3 text-sm font-semibold hover:border-primary/30 hover:bg-primary/5 transition-colors"
                >
                  View pricing
                </a>
              </div>
              <p className="mt-4 text-[11px] text-muted-foreground uppercase tracking-wider">
                Crypto billing · cancel anytime · Discord OAuth
              </p>
            </div>

            {/* Hero console preview */}
            <div className="lg:col-span-6">
              <div className="rounded-2xl border border-border/50 bg-card/80 shadow-2xl shadow-black/20 overflow-hidden ring-1 ring-primary/10">
                <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5 bg-secondary/30">
                  <div className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-primary/70" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    live console
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-primary font-semibold">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    ONLINE
                  </span>
                </div>
                <div className="p-4 space-y-1.5 min-h-[280px] bg-[oklch(0.04_0.01_25)] font-mono text-[11px] sm:text-xs">
                  {visibleLogs.map((l, i) => {
                    const tagColor: Record<string, string> = {
                      JOIN: "text-primary",
                      SEND: "text-amber-300",
                      CHAT: "text-sky-300",
                      AI: "text-fuchsia-300",
                      HOOK: "text-violet-300",
                      AFK: "text-muted-foreground",
                    };
                    return (
                      <div key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-relaxed">
                        <span className="text-muted-foreground/50 tabular-nums">{l.t}</span>
                        <span className={`font-semibold ${tagColor[l.tag] || ""}`}>{l.tag}</span>
                        <span className="text-primary/70">{l.bot}</span>
                        <span className="text-foreground/75">{l.msg}</span>
                      </div>
                    );
                  })}
                  <div className="pt-2 text-primary/80">
                    <span className="opacity-60">▸</span>
                    <span className="ml-1 inline-block h-3.5 w-1.5 bg-primary/80 animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats strip */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-3">
            {STATS.map((s) => (
              <div
                key={s.v}
                className="rounded-2xl border border-border/50 bg-card/40 px-4 py-4 text-center"
              >
                <div className="font-display text-2xl sm:text-3xl font-bold text-primary">{s.k}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {s.v}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* PRODUCT */}
        <section id="features" className="border-t border-border/40 bg-card/20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 md:py-24">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                Product
              </p>
              <h2 className="mt-2 font-display text-3xl md:text-4xl font-extrabold tracking-tight">
                Everything to automate at scale
              </h2>
              <p className="mt-3 text-muted-foreground leading-relaxed">
                Minecraft fleets, Discord plugins, verification — one login, one dashboard, live
                logs.
              </p>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <article
                  key={f.tag}
                  className="group rounded-2xl border border-border/50 bg-background/60 p-6 hover:border-primary/35 hover:bg-card/80 transition-colors"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                      <f.Icon className="h-5 w-5 text-primary" />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{f.tag}</span>
                  </div>
                  <p className="text-[10px] uppercase tracking-widest text-primary font-semibold">
                    {f.label}
                  </p>
                  <h3 className="mt-1 font-display text-xl font-bold tracking-tight">{f.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* CONSOLE DETAIL */}
        <section id="console" className="border-t border-border/40">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 md:py-24">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                  Live ops
                </p>
                <h2 className="mt-2 font-display text-3xl md:text-4xl font-extrabold tracking-tight">
                  Watch every bot in real time
                </h2>
                <p className="mt-4 text-muted-foreground leading-relaxed">
                  Joins, chat, sends, rate-limits, Microsoft auth — streamed as it happens. Pause,
                  stop, or relaunch without SSH.
                </p>
                <ul className="mt-8 space-y-3">
                  {[
                    { Icon: Zap, t: "Humanized timing" },
                    { Icon: Server, t: "Hosted workers — no local setup" },
                    { Icon: Clock, t: "24/7 runtime with bot-hour plans" },
                  ].map(({ Icon, t }) => (
                    <li key={t} className="flex items-center gap-3 text-sm">
                      <span className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-primary" />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-border/50 bg-card p-6 sm:p-8">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    ["MC bots", "Auto-message + last-DM reply"],
                    ["Discord spam", "Channel campaigns"],
                    ["Auto-reply", "DM every inbound"],
                    ["Verification", "MS OTP + secure"],
                  ].map(([a, b]) => (
                    <div
                      key={a}
                      className="rounded-xl border border-border/50 bg-background/50 p-4"
                    >
                      <div className="text-sm font-semibold">{a}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{b}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="border-t border-border/40 bg-card/20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 md:py-24">
            <div className="text-center max-w-2xl mx-auto">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                Pricing
              </p>
              <h2 className="mt-2 font-display text-3xl md:text-4xl font-extrabold tracking-tight">
                Simple crypto plans
              </h2>
              <p className="mt-3 text-muted-foreground">
                Monthly. Cancel anytime. Hours packs available in the dashboard.
              </p>
            </div>
            <div className="mt-12 grid gap-5 lg:grid-cols-3 items-stretch">
              {PLANS.map((p) => (
                <div
                  key={p.name}
                  className={`relative flex flex-col rounded-2xl border p-7 transition-colors ${
                    p.highlight
                      ? "border-primary/50 bg-primary/5 shadow-lg shadow-primary/10"
                      : "border-border/50 bg-background/60 hover:border-primary/25"
                  }`}
                >
                  {p.highlight && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary text-primary-foreground px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                      Popular
                    </span>
                  )}
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">
                    {p.name}
                  </div>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="font-display text-5xl font-bold">${p.price}</span>
                    <span className="text-sm text-muted-foreground">/mo</span>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-border/50 bg-card/50 p-3">
                      <div className="font-display text-xl font-bold text-primary">{p.bots}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        bots
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-card/50 p-3">
                      <div className="font-display text-xl font-bold text-primary">{p.hours}h</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        daily
                      </div>
                    </div>
                  </div>
                  <ul className="mt-6 space-y-2.5 text-sm flex-1">
                    {p.feats.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-muted-foreground">
                        <Check className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  {me ? (
                    <Link
                      to="/dashboard/purchase"
                      className={`mt-8 block w-full text-center rounded-full py-3 text-xs font-bold uppercase tracking-wider transition-colors ${
                        p.highlight
                          ? "bg-primary text-primary-foreground hover:opacity-95"
                          : "border border-border/60 hover:border-primary/40 hover:bg-primary/5"
                      }`}
                    >
                      Buy plan
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={openAuth}
                      className={`mt-8 w-full rounded-full py-3 text-xs font-bold uppercase tracking-wider transition-colors ${
                        p.highlight
                          ? "bg-primary text-primary-foreground hover:opacity-95"
                          : "border border-border/60 hover:border-primary/40 hover:bg-primary/5"
                      }`}
                    >
                      Get started
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-border/40">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 py-20 md:py-24">
            <div className="text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                FAQ
              </p>
              <h2 className="mt-2 font-display text-3xl md:text-4xl font-extrabold tracking-tight">
                Questions, answered
              </h2>
            </div>
            <div className="mt-10 rounded-2xl border border-border/50 bg-card/40 overflow-hidden divide-y divide-border/40">
              {FAQ.map((f, i) => {
                const open = openFaq === i;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    className={`w-full text-left px-5 sm:px-6 py-4 transition-colors ${
                      open ? "bg-primary/5" : "hover:bg-secondary/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-semibold text-sm sm:text-base pr-2">{f.q}</span>
                      <span
                        className={`text-xl font-light shrink-0 transition-transform ${
                          open ? "rotate-45 text-primary" : "text-muted-foreground"
                        }`}
                      >
                        +
                      </span>
                    </div>
                    <div
                      className={`grid transition-all duration-300 ${
                        open ? "grid-rows-[1fr] mt-2" : "grid-rows-[0fr]"
                      }`}
                    >
                      <div className="overflow-hidden">
                        <p className="text-sm text-muted-foreground leading-relaxed pb-1">{f.a}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border/40">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 md:py-20">
            <div className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card to-card px-6 py-14 sm:px-12 text-center">
              <h2 className="font-display text-3xl md:text-5xl font-extrabold tracking-tight">
                Ready to run bots?
              </h2>
              <p className="mx-auto mt-4 max-w-md text-muted-foreground">
                Sign in with Discord. First bot can be live in under a minute.
              </p>
              <button
                type="button"
                onClick={openAuth}
                className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-8 py-3.5 text-sm font-semibold shadow-lg shadow-primary/25 hover:opacity-95 transition-opacity"
              >
                Continue with Discord <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-border/40 bg-card/30">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-8">
            <div>
              <div className="flex items-center gap-2">
                <img
                  src={luauxLogo}
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 rounded-md border border-border/50"
                />
                <span className="font-display font-bold tracking-wide">LuauX</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground max-w-xs leading-relaxed">
                Minecraft bot manager & Discord automation. Hosted. Crypto. Live console.
              </p>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-4 text-sm">
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Product
                </div>
                <a href="#features" className="block text-muted-foreground hover:text-primary">
                  Features
                </a>
                <a href="#pricing" className="block text-muted-foreground hover:text-primary">
                  Pricing
                </a>
                <a href="#faq" className="block text-muted-foreground hover:text-primary">
                  FAQ
                </a>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Community
                </div>
                <a
                  href="https://discord.gg/n6nEcvwzYQ"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-muted-foreground hover:text-primary"
                >
                  Discord
                </a>
                <a
                  href="https://t.me/luauxx"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-muted-foreground hover:text-primary"
                >
                  Telegram
                </a>
              </div>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-border/40 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span>© {new Date().getFullYear()} LuauX. All rights reserved.</span>
            <span className="font-mono">luaux.wtf</span>
          </div>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-border/60 bg-card p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 h-8 w-8 rounded-full text-muted-foreground hover:bg-secondary text-lg"
          aria-label="Close"
        >
          ×
        </button>
        <div className="flex flex-col items-center text-center">
          <img
            src={luauxLogo}
            alt="LuauX"
            width={72}
            height={72}
            className={`h-16 w-16 rounded-2xl border border-border/60 bg-background p-2 ${loading ? "animate-pulse" : ""}`}
          />
          <h2 id="auth-title" className="mt-5 font-display text-2xl font-bold">
            LuauX
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {me
              ? `Signed in as ${me.global_name || me.username}`
              : loading
                ? "Redirecting to Discord…"
                : "Sign in with Discord to open the dashboard."}
          </p>
          {me ? (
            <div className="mt-6 w-full rounded-xl border border-border/50 p-3 flex items-center gap-3">
              {me.avatar && (
                <img src={me.avatar} alt="" className="h-10 w-10 rounded-full" width={40} height={40} />
              )}
              <div className="text-left text-sm font-semibold">{me.global_name || me.username}</div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleStart}
              disabled={loading}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#5865F2] text-white px-6 py-3 text-sm font-semibold hover:brightness-110 disabled:opacity-70 transition-all"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3a13.7 13.7 0 0 0-.617 1.264 18.298 18.298 0 0 0-5.878 0A13.5 13.5 0 0 0 9.44 3a19.736 19.736 0 0 0-3.76 1.369C1.966 9.834.94 15.148 1.453 20.383a19.9 19.9 0 0 0 6.02 3.049c.484-.655.915-1.352 1.286-2.084-.706-.264-1.379-.59-2.02-.972.17-.126.336-.257.497-.393a14.183 14.183 0 0 0 12.528 0c.163.14.329.271.499.393-.643.383-1.317.71-2.023.973.371.732.802 1.428 1.287 2.083a19.79 19.79 0 0 0 6.021-3.049c.6-6.057-1.041-11.324-4.231-16.014zM8.02 17.212c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42s2.176 1.086 2.156 2.42c0 1.335-.954 2.42-2.156 2.42zm7.974 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42s2.176 1.086 2.156 2.42c0 1.335-.954 2.42-2.156 2.42z" />
              </svg>
              {loading ? "Connecting…" : "Continue with Discord"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
