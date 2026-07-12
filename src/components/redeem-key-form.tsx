import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound } from "lucide-react";
import { redeemLicenseKey } from "@/lib/luaux.functions";

const LABELS: Record<string, string> = {
  verification: "Verification Bot",
  "discord-spam": "Discord Spam",
  "discord-autoreply": "Discord Auto-Reply",
};

export function RedeemKeyForm({
  expectedPlugin,
  onSuccess,
  compact = false,
}: {
  expectedPlugin?: string;
  onSuccess?: () => void;
  compact?: boolean;
}) {
  const doRedeem = useServerFn(redeemLicenseKey);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex items-center gap-2 text-xs font-semibold">
        <KeyRound className="h-3.5 w-3.5 text-primary" />
        Redeem key
      </div>
      <div className={`flex gap-2 ${compact ? "flex-col sm:flex-row" : "flex-col"}`}>
        <input
          className="flex-1 rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setErr(null);
            setMsg(null);
          }}
          placeholder="LX-VB-XXXX-XXXX-XXXX"
        />
        <button
          type="button"
          disabled={busy || key.trim().length < 8}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            setMsg(null);
            try {
              const r = (await doRedeem({ data: { key: key.trim() } })) as {
                already?: boolean;
                plugin_id: string;
                expires_at: string;
              };
              if (expectedPlugin && r.plugin_id !== expectedPlugin) {
                setMsg(
                  `Key redeemed for ${LABELS[r.plugin_id] || r.plugin_id}. Open that plugin page to use it.`,
                );
              } else {
                setMsg(
                  r.already
                    ? "This key is already on your account."
                    : `${LABELS[r.plugin_id] || "Plugin"} activated until ${new Date(r.expires_at).toLocaleDateString()}.`,
                );
              }
              setKey("");
              onSuccess?.();
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Redeem failed");
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold disabled:opacity-50 shrink-0"
        >
          {busy ? "…" : "Redeem"}
        </button>
      </div>
      {msg && <div className="text-xs text-primary">{msg}</div>}
      {err && <div className="text-xs text-destructive">{err}</div>}
    </div>
  );
}
