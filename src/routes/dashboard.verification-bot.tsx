import { createFileRoute, Link } from "@tanstack/react-router";
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

  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchKeys(), fetchProfile(), fetchSettings(), fetchSecuredAccounts()])
      .then(([k, p, s, accts]) => {
        setKeys(k as KeyRow[]);
        setIsAdmin((p as { isAdmin?: boolean }).isAdmin ?? false);
        setSecuredAccounts(accts as Array<Record<string, unknown>>);
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
  }, [fetchKeys, fetchProfile, fetchSettings, fetchSecuredAccounts]);

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
        data: {
          guild_id: guildId.trim(),
          verified_role_id: verifiedRoleId.trim(),
          channel_id: channelId.trim(),
          message_title: messageTitle.trim(),
          message_description: messageDescription.trim(),
          button_text: buttonText.trim(),
        },
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
            Discord verification plugin. License key auto-generated on purchase.
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
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground brutal-border px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 btn-premium"
          >
            Purchase — $10 in crypto
          </Link>
        </div>
      )}

      {/* Tabs — always visible for admins */}
      {isAdmin && (
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
              {/* Config form */}
              <div className="rounded-2xl brutal-border bg-card panel-accent">
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
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold disabled:opacity-50 btn-premium"
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

              <GuideStep num={1} icon={<Globe className="h-4 w-4 text-primary" />} title="Create a Discord Bot Application">
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Go to <strong className="text-foreground">discord.com/developers/applications</strong></li>
                  <li>Click <strong className="text-foreground">New Application</strong> in the top-right corner</li>
                  <li>Give it a name (e.g. <InlineCode>LuauX Verify</InlineCode>) and click <strong className="text-foreground">Create</strong></li>
                  <li>On the left sidebar, click <strong className="text-foreground">Bot</strong></li>
                  <li>Scroll down and enable these <strong className="text-foreground">Privileged Gateway Intents</strong>:</li>
                </ol>
                <div className="ml-4 mt-2 p-3 rounded-lg bg-background/60 brutal-border">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Check className="h-3 w-3 text-primary" />
                      <span className="text-foreground font-medium">Presence Intent</span>
                      <span className="text-muted-foreground">(optional, but recommended)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-3 w-3 text-primary" />
                      <span className="text-foreground font-medium">Server Members Intent</span>
                    </div>
                  </div>
                </div>
                <p>Click <strong className="text-foreground">Save Changes</strong> at the bottom.</p>
              </GuideStep>

              <GuideStep num={2} icon={<Key className="h-4 w-4 text-primary" />} title="Copy Your Bot Token">
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Still on the <strong className="text-foreground">Bot</strong> page, scroll to <strong className="text-foreground">Token</strong></li>
                  <li>Click <strong className="text-foreground">Reset Token</strong> if needed, then <strong className="text-foreground">Copy</strong></li>
                  <li>Save this token — you will need it for the Interaction Endpoint</li>
                </ol>
                <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <AlertTriangle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-[11px]">
                    <strong className="text-foreground">Never share your bot token.</strong> Anyone with it can fully control your bot.
                  </p>
                </div>
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

              <GuideStep num={7} icon={<Terminal className="h-4 w-4 text-primary" />} title="Set the Interaction Endpoint">
                <p>This is the most critical step — without it, clicking the verify button does nothing.</p>
                <ol className="list-decimal list-inside space-y-1.5 mt-2">
                  <li>Go back to <strong className="text-foreground">discord.com/developers/applications</strong></li>
                  <li>Select your bot application</li>
                  <li>On the left sidebar, click <strong className="text-foreground">General Information</strong></li>
                  <li>Find the <strong className="text-foreground">Interactions Endpoint URL</strong> field</li>
                  <li>Paste the following URL:</li>
                </ol>
                <div className="mt-3">
                  <CodeBlock>https://luauxbeaming.lovable.app/api/discord/interactions</CodeBlock>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 mt-3" start={6}>
                  <li>Click <strong className="text-foreground">Save Changes</strong></li>
                  <li>Discord will send a PING request to verify the endpoint works — this is handled automatically</li>
                </ol>
                <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <AlertTriangle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-[11px]">
                    <strong className="text-foreground">Endpoint must be HTTPS.</strong> Lovable provides this automatically.
                    If you see a validation error, make sure your site is deployed and the URL is exactly as shown above.
                  </p>
                </div>
              </GuideStep>

              <GuideStep num={8} icon={<ShieldCheck className="h-4 w-4 text-primary" />} title="Test the Verification Flow">
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
                    The verification license costs <strong className="text-foreground">$10/month</strong> and auto-delivers via Discord DM
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
                        {acc.mc_ssid && (
                          <div className="rounded-lg bg-background/60 brutal-border p-2.5 space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">SSID Token</span>
                            <code className="block text-foreground break-all text-[10px]">{acc.mc_ssid as string}</code>
                          </div>
                        )}
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
