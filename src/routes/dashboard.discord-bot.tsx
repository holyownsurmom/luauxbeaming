import { createFileRoute, Link } from "@tanstack/react-router";
import { Power, Shield, Zap, MessageSquare, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/dashboard/discord-bot")({
  head: () => ({ meta: [{ title: "Plugins — LuauX" }] }),
  component: DiscordBotPage,
});

const PLUGINS = [
  {
    to: "/dashboard/verification-bot",
    icon: Shield,
    title: "Verification Bot",
    desc: "Under work — not available for purchase right now.",
  },
  {
    to: "/dashboard/discord-spam",
    icon: Zap,
    title: "Discord Auto-Spam",
    desc: "Multi-token channel spammer with rotation, humanization & live console.",
  },
  {
    to: "/dashboard/discord-auto-reply",
    icon: MessageSquare,
    title: "Discord Auto-Reply",
    desc: "Hands-off DM auto-responder with DM & Friend modes.",
  },
];

function DiscordBotPage() {
  return (
    <div className="space-y-8 animate-page-in">
      <header>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Plugins</h1>
        <p className="mt-2 text-muted-foreground">
          Extend your setup with Discord automation tools. Purchase once, use forever.
        </p>
      </header>

      <div className="grid md:grid-cols-3 gap-4 stagger-cascade">
        {PLUGINS.map((p) => (
          <Link
            key={p.to}
            to={p.to}
            className="group relative rounded-2xl brutal-border bg-card/40 p-6 hover:bg-card/60 hover:-translate-y-1 transition-all duration-500 block overflow-hidden magnetic-hover holographic"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative">
              <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mb-4 group-hover:bg-primary/15 group-hover:shadow-[0_0_20px_oklch(0.79_0.16_85_/_0.15)] transition-all duration-500">
                <p.icon className="h-5 w-5 text-primary" />
              </div>
              <div className="font-semibold text-sm">{p.title}</div>
              <p className="mt-1.5 text-xs text-muted-foreground/60 leading-relaxed">{p.desc}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary group-hover:translate-x-1 transition-transform duration-300">
                Open plugin <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
