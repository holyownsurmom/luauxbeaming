import { createFileRoute } from "@tanstack/react-router";
import { ShieldOff } from "lucide-react";

export const Route = createFileRoute("/account-banned")({
  head: () => ({ meta: [{ title: "Account Banned — LuauX" }] }),
  component: AccountBannedPage,
});

function AccountBannedPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="relative mx-auto w-20 h-20">
          <div className="absolute inset-0 rounded-2xl bg-destructive/10 border border-destructive/20" />
          <div className="absolute inset-0 flex items-center justify-center">
            <ShieldOff className="h-10 w-10 text-destructive" />
          </div>
          <div className="absolute inset-[-6px] rounded-2xl border border-destructive/10 animate-ping opacity-20" />
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-display font-bold text-foreground">Account Banned</h1>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
            Your account has been banned from this platform. If you believe this is an error,
            contact support.
          </p>
        </div>

        <a
          href="https://discord.gg/n6nEcvwzYQ"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Contact Support
        </a>
      </div>
    </div>
  );
}
