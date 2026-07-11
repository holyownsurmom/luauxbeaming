import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
    desc: "Discord server verification with auto-role assignment. $10/mo.",
    status: "plugin" as const,
  },
  {
    to: "/dashboard/discord-spam",
    icon: Zap,
    title: "Discord Auto-Spam",
    desc: "Multi-token channel spammer with rotation, humanization & live console.",
    status: "plugin" as const,
  },
  {
    to: "/dashboard/discord-auto-reply",
    icon: MessageSquare,
    title: "Discord Auto-Reply",
    desc: "Hands-off DM auto-responder with DM & Friend modes.",
    status: "plugin" as const,
  },
];

function DiscordBotPage() {
  return (
    <div className="space-y-8">
      <header className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center">
          <Power className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-4xl font-semibold tracking-tight">Plugins</h1>
          <p className="mt-1 text-muted-foreground">
            Extend your setup with Discord automation tools. Purchase once, use forever.
          </p>
        </div>
      </header>

      <div className="grid md:grid-cols-1 gap-4">
        {PLUGINS.map((p) => (
          <Link
            key={p.to}
            to={p.to}
            className="rounded-2xl brutal-border bg-card p-6 hover:bg-card/80 transition-colors flex items-center gap-5"
          >
            <div className="h-12 w-12 shrink-0 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center">
              <p.icon className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-display text-xl font-semibold">{p.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{p.desc}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
