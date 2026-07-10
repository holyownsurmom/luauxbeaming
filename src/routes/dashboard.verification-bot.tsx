import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Copy, Check, Clock } from "lucide-react";
import { getVerificationKeys } from "@/lib/luaux.functions";

export const Route = createFileRoute("/dashboard/verification-bot")({
  head: () => ({ meta: [{ title: "Verification Bot — LuauX" }] }),
  component: VerificationBotPage,
});

type KeyRow = {
  id: string;
  key: string;
  expires_at: string;
  created_at: string;
  delivered: boolean;
};

function VerificationBotPage() {
  const fetchKeys = useServerFn(getVerificationKeys);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetchKeys()
      .then((d) => setKeys(d as KeyRow[]))
      .finally(() => setLoading(false));
  }, [fetchKeys]);

  const activeKey = keys.find((k) => new Date(k.expires_at).getTime() > Date.now());

  const copy = async (v: string) => {
    await navigator.clipboard.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-8">
      <header className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-4xl font-semibold tracking-tight">Verification Bot</h1>
          <p className="mt-1 text-muted-foreground">
            Discord verification plugin. $10/month — key auto-generated and DM'd to you by the LuauX bot on purchase.
          </p>
        </div>
      </header>

      {activeKey ? (
        <div className="rounded-2xl brutal-border bg-card p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
            <Check className="h-3.5 w-3.5" /> Active license
          </div>
          <div className="mt-3 flex items-center gap-3">
            <code className="flex-1 rounded-lg bg-secondary/40 px-4 py-3 font-mono text-lg tracking-wider">
              {activeKey.key}
            </code>
            <button
              onClick={() => copy(activeKey.key)}
              className="rounded-lg brutal-border bg-secondary/40 hover:bg-secondary px-4 py-3 text-xs font-semibold flex items-center gap-2"
            >
              {copied === activeKey.key ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied === activeKey.key ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Expires {new Date(activeKey.expires_at).toLocaleString()}
            {!activeKey.delivered && <span className="ml-2 text-amber-400">DM pending — check with the bot</span>}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl brutal-border bg-card p-6">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">No active license</div>
          <p className="mt-2 text-sm text-foreground/80">
            Purchase the Verification Bot plugin to get a fresh key valid for 30 days. The LuauX Discord bot will DM the key to
            you the instant your payment gets 2 confirmations.
          </p>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="font-display text-4xl font-semibold text-gradient">$10</span>
            <span className="text-sm text-muted-foreground">/ month</span>
          </div>
          <ul className="mt-4 space-y-1.5 text-sm text-foreground/80">
            <li className="flex gap-2"><Check className="h-4 w-4 text-primary" /> Auto-generated license key</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-primary" /> Delivered via Discord DM</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-primary" /> 30 days of access, renew anytime</li>
          </ul>
          <Link
            to="/dashboard/purchase"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground brutal-border px-5 py-2.5 text-sm font-semibold hover:bg-primary/90"
          >
            Purchase — $10 in crypto
          </Link>
        </div>
      )}

      {loading ? null : keys.length > 1 && (
        <div className="rounded-2xl brutal-border bg-card p-6">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Key history</div>
          <div className="space-y-2">
            {keys.map((k) => {
              const active = new Date(k.expires_at).getTime() > Date.now();
              return (
                <div key={k.id} className="flex items-center gap-3 rounded-lg bg-secondary/30 px-3 py-2 text-sm">
                  <code className="flex-1 font-mono">{k.key}</code>
                  <span className={`text-[10px] uppercase tracking-widest ${active ? "text-primary" : "text-muted-foreground"}`}>
                    {active ? "Active" : "Expired"}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(k.expires_at).toLocaleDateString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}