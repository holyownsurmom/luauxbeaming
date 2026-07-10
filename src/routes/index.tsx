import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import luauxLogo from "@/assets/luaux-logo.png";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "LuauX — Automated Minecraft bot fleets" },
      { name: "description", content: "Deploy stealthy Minecraft bot fleets in under a minute. Live logs, anti-detect proxies, 24/7 uptime." },
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
  { tag: "01", label: "Automation", title: "Smart fleet", body: "Spin up dozens of bots with shared behavior profiles. Load balancing distributes tasks across the fleet automatically." },
  { tag: "02", label: "Stealth", title: "Undetected", body: "Rotating proxies, humanlike movement and unique fingerprints for every session." },
  { tag: "03", label: "Reliability", title: "24/7 uptime", body: "Bots run continuously. No manual restarts, no babysitting, no drama." },
  { tag: "04", label: "Tooling", title: "Live console", body: "Watch bot output in real time. Chat, events, errors — streamed to your browser." },
  { tag: "05", label: "Scale", title: "Multi-account", body: "Manage hundreds of accounts from one unified command center." },
  { tag: "06", label: "Deploy", title: "Instant deploy", body: "Drop credentials and your fleet is beaming in under a minute. No config files." },
];

const PLANS = [
  { name: "Starter", price: 15, bots: 1, hours: 5, feats: ["1 concurrent bot", "5 bot-hours / day", "Basic telemetry & logs", "Standard beam speed", "Community Discord"], highlight: false },
  { name: "Pro", price: 25, bots: 5, hours: 7, feats: ["5 concurrent bots", "7 bot-hours / day", "Full analytics & live console", "Advanced scanner + priority queue", "All plugins included", "Fast beam speed", "Priority Discord support"], highlight: true },
  { name: "Enterprise", price: 50, bots: 20, hours: 14, feats: ["20 concurrent bots", "14 bot-hours / day", "Custom behaviors & API access", "Maximum beam speed", "Early access to features", "Dedicated 1:1 support"], highlight: false },
];

const REVIEWS = [
  { text: "went from beaming manually for hours to having 12 bots running while i sleep. its unfair.", name: "@prinsi_", stars: 5 },
  { text: "excellent. can recommend to anyone tired of manual beams. setup took me 4 minutes.", name: "@cpvpary", stars: 5 },
  { text: "wasn't sure at first. got 2 clean hits in under an hour. its really good.", name: "@s0wad", stars: 4 },
  { text: "the live console is stupid good. i just leave it open on my second monitor.", name: "@korr1n", stars: 5 },
];

const FAQ = [
  { q: "What exactly is LuauX?", a: "A hosted fleet manager for Minecraft bots. You provide credentials, we handle proxies, uptime, anti-detection, and streaming logs." },
  { q: "Is it safe? Will my accounts get banned?", a: "Every bot gets a unique fingerprint, rotating residential proxy, and humanized movement patterns. We can't promise zero risk on any server, but detection is rare." },
  { q: "How do I sign in?", a: "Continue with Discord. Your first bot deploys in under 60 seconds after linking credentials." },
  { q: "Can I cancel my subscription?", a: "Any time, no questions. Crypto billing is monthly — cancel and the fleet spins down at the end of the cycle." },
  { q: "Do you offer custom plans?", a: "Yes. If you need more than 20 concurrent bots or a private cluster, message us in Discord." },
];

function Logo() {
  return (
    <div className="relative grid grid-cols-2 grid-rows-2 gap-[2px] rounded-md bg-primary p-1 glow-primary">
      <span className="h-1.5 w-1.5 bg-primary-foreground" />
      <span className="h-1.5 w-1.5 bg-primary-foreground/50" />
      <span className="h-1.5 w-1.5 bg-primary-foreground/50" />
      <span className="h-1.5 w-1.5 bg-primary-foreground" />
    </div>
  );
}

function Index() {
  const [tick, setTick] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [authOpen, setAuthOpen] = useState(false);
  const [me, setMe] = useState<{ id: string; username: string; global_name: string | null; avatar: string | null } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        setMe(d.user);
        if (d.user && typeof window !== "undefined" && window.location.search.includes("signed_in=1")) {
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
      // Break out of the Lovable preview iframe so Discord OAuth (which
      // blocks iframe embedding) loads at the top level and the session
      // cookie is treated as first-party.
      if (window.top && window.top !== window.self) {
        window.top.location.href = new URL(url, window.location.origin).toString();
        return;
      }
    } catch {
      // Cross-origin top — fall through to same-window nav.
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
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div
          className="absolute left-1/2 top-0 h-[700px] w-[900px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.88 0.22 145 / 0.5), transparent 60%)" }}
        />
        <div className="absolute inset-0 grid-bg" />
      </div>

      {/* NAV */}
      <header className="sticky top-4 z-40 mx-auto max-w-6xl px-4">
        <div className="brutal-border rounded-full bg-card/70 backdrop-blur-xl flex items-center justify-between px-4 py-2">
          <a href="#top" className="flex items-center gap-3">
            <Logo />
            <span className="font-display text-sm font-bold tracking-[0.2em]">LUAUX</span>
          </a>
          <nav className="hidden md:flex items-center gap-1 text-xs">
            {[["Features","#features"],["Console","#console"],["Pricing","#pricing"],["FAQ","#faq"]].map(([l,h]) => (
              <a key={h} href={h} className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">{l}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {me ? (
              <>
                <div className="hidden sm:flex items-center gap-2 rounded-full brutal-border bg-card/60 px-3 py-1 text-xs">
                  {me.avatar && <img src={me.avatar} alt="" className="h-5 w-5 rounded-full" />}
                  <span className="text-foreground/90">{me.global_name || me.username}</span>
                </div>
                <button onClick={signOut} className="rounded-full brutal-border bg-card/60 px-3 py-1.5 text-xs font-semibold hover:bg-secondary">
                  Sign out
                </button>
              </>
            ) : (
              <>
                <button onClick={openAuth} className="rounded-full brutal-border bg-card/60 px-4 py-1.5 text-xs font-semibold hover:bg-secondary">
                  Sign up
                </button>
                <button onClick={openAuth} className="rounded-full bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold glow-primary transition-transform hover:scale-105">
                  Get started →
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* HERO */}
      <section id="top" className="mx-auto max-w-6xl px-6 pt-24 pb-24 md:pt-32 text-center">
        <div className="inline-flex items-center gap-2 rounded-full brutal-border bg-card/60 backdrop-blur px-3 py-1 text-[11px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary blink" />
          128 nodes online · eu-fra 18ms
        </div>
        <h1 className="mt-8 font-display text-5xl md:text-7xl lg:text-8xl font-semibold leading-[0.95] tracking-tight text-gradient">
          Stop beaming manually.<br />
          <span className="italic text-primary">Let the fleet do it.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base md:text-lg text-muted-foreground">
          Deploy a stealth Minecraft bot fleet in under a minute. Live logs, anti-detect proxies, 24/7 uptime — no babysitting, no scripts, no cope.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <button onClick={openAuth} className="rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold glow-primary transition-transform hover:scale-105">
            Get started free →
          </button>
          <a href="#console" className="rounded-full brutal-border bg-card/60 px-6 py-3 text-sm font-semibold text-foreground/90 hover:bg-secondary">
            See it running
          </a>
        </div>

        <div className="mx-auto mt-20 grid max-w-3xl grid-cols-1 gap-px overflow-hidden rounded-2xl brutal-border bg-border md:grid-cols-3">
          {[
            { k: "$10,000+", v: "value beamed" },
            { k: "99%", v: "uptime" },
            { k: "35s", v: "avg deploy" },
          ].map((s) => (
            <div key={s.v} className="bg-card px-6 py-6 text-left">
              <div className="font-display text-3xl font-semibold text-gradient">{s.k}</div>
              <div className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">{s.v}</div>
            </div>
          ))}
        </div>
      </section>


      {/* CONSOLE */}
      <section id="console" className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary blink" /> live
            </div>
            <h2 className="mt-4 font-display text-4xl md:text-5xl font-semibold leading-[1.05] tracking-tight text-gradient">
              Watch your fleet<br/>run itself.
            </h2>
            <p className="mt-5 text-muted-foreground">
              Every bot streams its activity in real time and answers chat autonomously. No babysitting — just a browser tab and a coffee.
            </p>
            <div className="mt-8 space-y-3">
              {[["2,418","AI replies today"],["128","nodes online"],["18ms","avg latency (eu-fra)"]].map(([k,v]) => (
                <div key={v} className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">{v}</span>
                  <span className="font-display text-2xl font-semibold">{k}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="rounded-2xl brutal-border overflow-hidden bg-card glow-primary font-mono text-xs">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-secondary/40">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-primary/70" />
                </div>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">luaux@runner ~ tail -f fleet.log</span>
                <span className="flex items-center gap-1 text-[10px] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary blink"/>live</span>
              </div>
              <div className="p-5 space-y-1.5 min-h-[380px]">
                {visibleLogs.map((l, i) => {
                  const tagColor: Record<string,string> = {
                    JOIN: "bg-primary/20 text-primary border-primary/40",
                    SEND: "bg-yellow-400/10 text-yellow-300 border-yellow-400/30",
                    CHAT: "bg-sky-400/10 text-sky-300 border-sky-400/30",
                    AI: "bg-fuchsia-400/10 text-fuchsia-300 border-fuchsia-400/30",
                    HOOK: "bg-violet-400/10 text-violet-300 border-violet-400/30",
                    AFK: "bg-muted text-muted-foreground border-border",
                  };
                  return (
                    <div key={i} className="flex items-start gap-3 leading-relaxed">
                      <span className="text-muted-foreground/60">{l.t}</span>
                      <span className={`rounded-md border px-1.5 py-px text-[10px] font-semibold uppercase ${tagColor[l.tag] || "bg-muted text-muted-foreground border-border"}`}>{l.tag}</span>
                      <span className="text-primary/90">{l.bot}</span>
                      <span className="text-foreground/80">{l.msg}</span>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 pt-2 text-muted-foreground">
                  <span className="text-primary">›</span>
                  <span className="h-3 w-2 bg-primary blink" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="border-y border-border bg-card/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-16 flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// platform</div>
              <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold max-w-2xl leading-tight tracking-tight text-gradient">
                Everything you need to<br/>beam at scale.
              </h2>
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">A focused toolkit for operators. No bloat. No feature bingo. Six things, done properly.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.tag} className="group relative rounded-2xl brutal-border bg-card p-6 transition-all hover:border-primary/40 hover:-translate-y-0.5">
                <div className="mb-6 flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{f.tag}</span>
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-primary">{f.label}</span>
                </div>
                <h3 className="font-display text-2xl font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-3 text-sm text-muted-foreground">{f.body}</p>
                <div className="mt-6 inline-flex items-center gap-1 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">Learn more →</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="mb-16 text-center">
          <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// pricing</div>
          <h2 className="mt-3 font-display text-4xl md:text-6xl font-semibold tracking-tight text-gradient">
            Simple. Transparent. <span className="italic text-primary">Crypto.</span>
          </h2>
          <p className="mt-5 text-muted-foreground">Pay monthly with crypto. Cancel anytime. 24h free trial — no payment required.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className={`relative rounded-2xl p-8 ${p.highlight ? "border-2 border-primary bg-card glow-primary lg:-translate-y-4" : "brutal-border bg-card"}`}>
              {p.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-primary-foreground px-3 py-1 text-[10px] font-semibold uppercase tracking-widest">
                  Most popular
                </div>
              )}
              <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">{p.name}</div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="font-display text-6xl font-semibold text-gradient">${p.price}</span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-xl brutal-border bg-secondary/40 p-3">
                  <div className="font-display text-2xl font-semibold">{p.bots}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">bots</div>
                </div>
                <div className="rounded-xl brutal-border bg-secondary/40 p-3">
                  <div className="font-display text-2xl font-semibold">{p.hours}h</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">daily</div>
                </div>
              </div>
              <ul className="mt-6 space-y-2 text-sm">
                {p.feats.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-muted-foreground">
                    <span className="mt-0.5 text-primary">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            <button onClick={openAuth} className={`mt-8 block w-full text-center rounded-full py-3 text-xs font-semibold uppercase tracking-widest transition-transform hover:scale-[1.02] ${p.highlight ? "bg-primary text-primary-foreground glow-primary" : "brutal-border bg-secondary/40 hover:bg-secondary"}`}>
                Get started →
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* REVIEWS */}
      <section className="border-y border-border bg-card/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-14 flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// reviews</div>
              <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold max-w-xl leading-tight tracking-tight text-gradient">
                Loved by operators<br/>worldwide.
              </h2>
            </div>
            <div className="flex items-center gap-4">
              <div className="font-display text-5xl font-semibold text-gradient">4.7</div>
              <div className="text-xs uppercase tracking-widest">
                <div className="text-primary">★★★★★</div>
                <div className="mt-1 text-muted-foreground">based on 247 reviews</div>
              </div>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {REVIEWS.map((r, i) => (
              <div key={i} className="rounded-2xl brutal-border bg-card p-6 transition-colors hover:border-primary/30">
                <div className="text-primary text-sm">{"★".repeat(r.stars)}<span className="text-muted-foreground/30">{"★".repeat(5 - r.stars)}</span></div>
                <p className="mt-4 text-sm leading-relaxed text-foreground/90">"{r.text}"</p>
                <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center text-[10px] text-primary">{r.name[1]?.toUpperCase()}</span>
                  <span>{r.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-4xl px-6 py-24 md:py-32">
        <div className="mb-12 text-center">
          <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// faq</div>
          <h2 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight text-gradient">Frequently asked.</h2>
        </div>
        <div className="rounded-2xl brutal-border bg-card overflow-hidden">
          {FAQ.map((f, i) => {
            const open = openFaq === i;
            return (
              <button key={i} onClick={() => setOpenFaq(open ? null : i)} className={`block w-full text-left border-b border-border last:border-b-0 p-6 transition-colors ${open ? "bg-secondary/60" : "hover:bg-secondary/30"}`}>
                <div className="flex items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-xs text-primary">0{i + 1}</span>
                    <span className="font-display text-base md:text-lg font-medium">{f.q}</span>
                  </div>
                  <span className={`font-display text-2xl transition-transform ${open ? "rotate-45 text-primary" : "text-muted-foreground"}`}>+</span>
                </div>
                {open && <p className="mt-4 pl-10 text-sm text-muted-foreground max-w-2xl">{f.a}</p>}
              </button>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-3xl brutal-border bg-card px-8 py-20 text-center glow-primary">
          <div aria-hidden className="absolute inset-0 grid-bg opacity-60" />
          <div className="relative">
            <div className="text-[11px] uppercase tracking-[0.3em] text-primary">// ready</div>
            <h2 className="mt-3 font-display text-5xl md:text-7xl font-semibold leading-[0.95] tracking-tight text-gradient">
              Ready to <span className="italic text-primary">beam?</span>
            </h2>
            <p className="mx-auto mt-6 max-w-md text-muted-foreground">Sign in with Discord. First bot deployed in under a minute.</p>
            <button onClick={openAuth} className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-8 py-4 text-sm font-semibold glow-primary transition-transform hover:scale-105">
              Continue with Discord →
            </button>
            <div className="mt-4 text-[11px] uppercase tracking-[0.25em] text-muted-foreground">No credit card · 24h free trial</div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mx-auto max-w-6xl px-6 py-10 flex flex-wrap items-center justify-between gap-4 text-xs uppercase tracking-widest text-muted-foreground border-t border-border">
        <div className="flex items-center gap-2">
          <Logo />
          <span>© 2026 LuauX</span>
        </div>
        <div className="flex gap-6">
          <a href="https://discord.gg/sHgh6kVBg3" target="_blank" rel="noopener noreferrer" className="hover:text-primary">Discord</a>
          <a href="#" className="hover:text-primary">Docs</a>
          <a href="#" className="hover:text-primary">Status</a>
          <a href="#" className="hover:text-primary">Terms</a>
        </div>
      </footer>

      {authOpen && (
        <AuthModal onClose={() => setAuthOpen(false)} onStart={startDiscord} me={me} />
      )}
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl brutal-border bg-card p-8 glow-primary"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 h-8 w-8 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground text-lg"
          aria-label="Close"
        >
          ×
        </button>

        <div className="flex flex-col items-center text-center">
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
              className={`h-20 w-20 rounded-2xl brutal-border bg-background p-2 ${loading ? "animate-pulse" : ""}`}
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
            <div className="mt-6 w-full rounded-xl brutal-border bg-secondary/40 p-4 flex items-center gap-3">
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
              className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#5865F2] text-white px-6 py-3 text-sm font-semibold transition-transform hover:scale-[1.02] disabled:opacity-70"
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