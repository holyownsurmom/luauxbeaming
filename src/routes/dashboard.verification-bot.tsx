import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Copy, Check, Clock, Settings, Save, RefreshCw } from "lucide-react";
import {
  getVerificationKeys,
  getMyProfile,
  getVerificationSettings,
  saveVerificationSettings,
} from "@/lib/luaux.functions";

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
  const fetchProfile = useServerFn(getMyProfile);
  const fetchSettings = useServerFn(getVerificationSettings);
  const saveSettings = useServerFn(saveVerificationSettings);

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  // Settings state
  const [guildId, setGuildId] = useState("");
  const [verifiedRoleId, setVerifiedRoleId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [messageTitle, setMessageTitle] = useState("Verification Required");
  const [messageDescription, setMessageDescription] = useState(
    "Click the button below to verify your account and gain access to the server.",
  );
  const [buttonText, setButtonText] = useState("Verify");

  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchKeys(), fetchProfile(), fetchSettings()])
      .then(([k, p, s]) => {
        setKeys(k as KeyRow[]);
        setIsAdmin((p as { isAdmin?: boolean }).isAdmin ?? false);
        if (s) {
          const settings = s as {
            guild_id: string;
            verified_role_id: string;
            channel_id: string;
            message_title: string;
            message_description: string;
            button_text: string;
          };
          setGuildId(settings.guild_id);
          setVerifiedRoleId(settings.verified_role_id);
          setChannelId(settings.channel_id);
          setMessageTitle(settings.message_title);
          setMessageDescription(settings.message_description);
          setButtonText(settings.button_text);
        }
      })
      .finally(() => setLoading(false));
  }, [fetchKeys, fetchProfile, fetchSettings]);

  const activeKey = isAdmin
    ? { key: "ADMIN", expires_at: "2099-12-31", created_at: "" }
    : keys.find((k) => new Date(k.expires_at).getTime() > Date.now());

  const copy = async (v: string) => {
    await navigator.clipboard.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!guildId.trim()) {
      setSaving(false);
      return setErrorMsg("Guild ID is required");
    }
    if (!verifiedRoleId.trim()) {
      setSaving(false);
      return setErrorMsg("Verified Role ID is required");
    }
    if (!channelId.trim()) {
      setSaving(false);
      return setErrorMsg("Channel ID is required");
    }

    try {
      await saveSettings({
        guild_id: guildId.trim(),
        verified_role_id: verifiedRoleId.trim(),
        channel_id: channelId.trim(),
        message_title: messageTitle.trim(),
        message_description: messageDescription.trim(),
        button_text: buttonText.trim(),
      } as {
        guild_id: string;
        verified_role_id: string;
        channel_id: string;
        message_title: string;
        message_description: string;
        button_text: string;
      });
      setSuccessMsg("Settings saved and verification button posted successfully!");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save verification settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      <header className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Verification Bot
            {isAdmin && (
              <span className="ml-3 inline-flex items-center rounded-full bg-primary/15 text-primary px-2.5 py-0.5 text-xs font-semibold brutal-border">
                ADMIN
              </span>
            )}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Discord verification plugin. License key auto-generated on purchase.
          </p>
        </div>
      </header>

      {activeKey ? (
        <div className="space-y-6">
          {/* Active license card */}
          <div className="rounded-2xl brutal-border bg-card p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
                <Check className="h-3.5 w-3.5" /> Active license
              </div>
              {!isAdmin && (
                <span className="text-xs text-muted-foreground">
                  Expires {new Date(activeKey.expires_at).toLocaleString()}
                </span>
              )}
            </div>
            {!isAdmin && (
              <div className="mt-3 flex items-center gap-3">
                <code className="flex-1 rounded-lg bg-secondary/40 px-4 py-3 font-mono text-lg tracking-wider">
                  {activeKey.key}
                </code>
                <button
                  onClick={() => copy(activeKey.key)}
                  className="rounded-lg brutal-border bg-secondary/40 hover:bg-secondary px-4 py-3 text-xs font-semibold flex items-center gap-2"
                >
                  {copied === activeKey.key ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied === activeKey.key ? "Copied" : "Copy"}
                </button>
              </div>
            )}
            {isAdmin && (
              <div className="mt-2 text-xs text-muted-foreground font-semibold">
                Admin mode -- payment checks bypassed.
              </div>
            )}
          </div>

          {/* Config form */}
          <div className="rounded-2xl brutal-border bg-card">
            <div className="p-5 border-b border-border/60 flex items-center gap-3 bg-secondary/15">
              <Settings className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-sm">Bot Configuration</h3>
                <p className="text-xs text-muted-foreground">
                  Set up verification for your Discord server.
                </p>
              </div>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                    Discord Server ID (Guild ID)
                  </span>
                  <input
                    className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                    value={guildId}
                    onChange={(e) => setGuildId(e.target.value)}
                    placeholder="123456789012345678"
                  />
                  <span className="text-[10px] text-muted-foreground block">
                    Right-click server icon and select Copy Server ID
                  </span>
                </label>

                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                    Verified Role ID
                  </span>
                  <input
                    className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                    value={verifiedRoleId}
                    onChange={(e) => setVerifiedRoleId(e.target.value)}
                    placeholder="888888888888888888"
                  />
                  <span className="text-[10px] text-muted-foreground block">
                    Role to assign when verified. Make sure the bot's role is above this role.
                  </span>
                </label>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                    Verification Channel ID
                  </span>
                  <input
                    className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    placeholder="222222222222222222"
                  />
                  <span className="text-[10px] text-muted-foreground block">
                    Channel where the verification button will be posted.
                  </span>
                </label>

                <label className="text-xs space-y-1">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                    Button Text
                  </span>
                  <input
                    className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm"
                    value={buttonText}
                    onChange={(e) => setButtonText(e.target.value)}
                    placeholder="Verify"
                  />
                </label>
              </div>

              <label className="text-xs space-y-1 block">
                <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                  Message Embed Title
                </span>
                <input
                  className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm"
                  value={messageTitle}
                  onChange={(e) => setMessageTitle(e.target.value)}
                  placeholder="Verification Required"
                />
              </label>

              <label className="text-xs space-y-1 block">
                <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                  Message Embed Description
                </span>
                <textarea
                  className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm resize-none"
                  rows={3}
                  value={messageDescription}
                  onChange={(e) => setMessageDescription(e.target.value)}
                  placeholder="Click the button below to verify..."
                />
              </label>

              {successMsg && <div className="text-xs text-primary font-semibold">{successMsg}</div>}
              {errorMsg && <div className="text-xs text-destructive font-semibold">{errorMsg}</div>}

              <button
                type="submit"
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold disabled:opacity-50"
              >
                {saving ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? "Saving & Posting..." : "Save & Post Verification Button"}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl brutal-border bg-card p-6">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            No active license
          </div>
          <p className="mt-2 text-sm text-foreground/80">
            Purchase the Verification Bot plugin to get a fresh key valid for 30 days. The LuauX
            Discord bot will DM the key to you the instant your payment gets 2 confirmations.
          </p>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="font-display text-4xl font-semibold text-gradient">$10</span>
            <span className="text-sm text-muted-foreground">/ month</span>
          </div>
          <ul className="mt-4 space-y-1.5 text-sm text-foreground/80">
            <li className="flex gap-2">
              <Check className="h-4 w-4 text-primary" /> Auto-generated license key
            </li>
            <li className="flex gap-2">
              <Check className="h-4 w-4 text-primary" /> Delivered via Discord DM
            </li>
            <li className="flex gap-2">
              <Check className="h-4 w-4 text-primary" /> 30 days of access, renew anytime
            </li>
          </ul>
          <Link
            to="/dashboard/purchase"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground brutal-border px-5 py-2.5 text-sm font-semibold hover:bg-primary/90"
          >
            Purchase — $10 in crypto
          </Link>
        </div>
      )}
    </div>
  );
}
