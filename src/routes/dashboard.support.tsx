import { createFileRoute } from "@tanstack/react-router";
import { LifeBuoy, MessageCircle, ExternalLink } from "lucide-react";

const DISCORD_INVITE = "https://discord.gg/n6nEcvwzYQ";

export const Route = createFileRoute("/dashboard/support")({
  head: () => ({ meta: [{ title: "Support — LuauX" }] }),
  component: SupportPage,
});

function SupportPage() {
  return (
    <div className="space-y-8 animate-page-in">
      <header className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center animate-border">
          <LifeBuoy className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-4xl font-semibold tracking-tight">Support</h1>
          <p className="mt-1 text-muted-foreground">
            Need help? Open a ticket in the LuauX Discord — our team lives there.
          </p>
        </div>
      </header>

      <div className="rounded-2xl brutal-border bg-card p-8 animated-border noise-texture relative overflow-hidden">
        <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-primary">
          <MessageCircle className="h-4 w-4" /> Official Discord
        </div>
        <h2 className="mt-3 font-display text-2xl font-semibold">Join the LuauX server</h2>
        <p className="mt-2 text-sm text-foreground/80 max-w-lg">
          Open a <span className="font-semibold text-foreground">#support</span> ticket, chat with
          staff, and get instant help from the community. Priority tickets are handled first for Pro
          and Enterprise users.
        </p>

        <a
          href={DISCORD_INVITE}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground brutal-border px-5 py-3 text-sm font-semibold hover:bg-primary/90 magnetic-hover"
        >
          Open Discord ticket
          <ExternalLink className="h-4 w-4" />
        </a>

        <div className="mt-4 text-xs text-muted-foreground break-all">{DISCORD_INVITE}</div>
      </div>
    </div>
  );
}
