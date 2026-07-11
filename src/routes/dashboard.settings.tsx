import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  User,
  CreditCard,
  Clock,
  Bell,
  Palette,
  Languages,
  Sparkles,
  ChevronDown,
  ShieldCheck,
  Sun,
  Moon,
} from "lucide-react";
import { getMyProfile } from "@/lib/luaux.functions";
import { useSettings } from "@/lib/settings-context";

export const Route = createFileRoute("/dashboard/settings")({
  head: () => ({ meta: [{ title: "Settings — LuauX" }] }),
  component: SettingsPage,
});

type Tab =
  "profile" | "subscription" | "bot-hours" | "notifications" | "appearance" | "language" | "admin";

const ACCOUNT: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "subscription", label: "Subscription", icon: CreditCard },
  { id: "bot-hours", label: "Bot hours & keys", icon: Clock },
];
const WORKSPACE: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "language", label: "Language & currency", icon: Languages },
  { id: "admin", label: "Admin", icon: ShieldCheck },
];

function SettingsPage() {
  const fetchProfile = useServerFn(getMyProfile);
  const s = useSettings();
  const [data, setData] = useState<{
    profile: {
      discord_id: string;
      username: string;
      global_name: string | null;
      email: string | null;
      avatar_url: string | null;
      bot_hours_remaining: number;
      active_plan_id: string | null;
    } | null;
    plan: { name: string } | null;
    active: boolean;
  } | null>(null);
  const [tab, setTab] = useState<Tab>("language");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPw, setAdminPw] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile()
      .then((r) => {
        const d = r as {
          profile: {
            discord_id: string;
            username: string;
            global_name: string | null;
            email: string | null;
            avatar_url: string | null;
            bot_hours_remaining: number;
            active_plan_id: string | null;
          } | null;
          plan: { name: string } | null;
          active: boolean;
          isAdmin?: boolean;
        };
        setData({ profile: d.profile, plan: d.plan, active: d.active });
        setIsAdmin(d.isAdmin ?? false);
      })
      .catch(() => setData({ profile: null, plan: null, active: false }));
  }, [fetchProfile]);

  const displayName = data?.profile?.global_name || data?.profile?.username || "…";
  const handle = data?.profile?.username || "";
  const hours = Number(data?.profile?.bot_hours_remaining ?? 0);
  const planLabel = data?.active ? (data?.plan?.name ?? "Active plan") : "No plan";
  const planActive = !!data?.active;

  const ACCOUNT_LABELS: Record<string, string> = {
    profile: s.t("profile"),
    subscription: s.t("subscription"),
    "bot-hours": s.t("bot_hours"),
  };
  const WORKSPACE_LABELS: Record<string, string> = {
    notifications: s.t("notifications"),
    appearance: s.t("appearance"),
    language: s.t("language_currency"),
    admin: "Admin",
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl font-semibold tracking-tight">{s.t("settings")}</h1>
        <p className="mt-2 text-muted-foreground">{s.t("settings_sub")}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
        {/* Left column */}
        <div className="space-y-4">
          <div className="rounded-2xl brutal-border bg-card/60 p-4">
            <div className="flex items-center gap-3">
              {data?.profile?.avatar_url ? (
                <img
                  src={data.profile.avatar_url}
                  alt=""
                  className="h-11 w-11 rounded-full brutal-border"
                />
              ) : (
                <div className="h-11 w-11 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-bold">
                  {displayName[0]?.toUpperCase() || "?"}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{displayName}</div>
                <div className="text-[11px] text-muted-foreground truncate">@{handle}</div>
              </div>
            </div>
            <div
              className={`mt-3 flex items-center justify-center gap-1.5 rounded-lg brutal-border py-1.5 text-[11px] ${
                planActive ? "bg-primary/10 text-primary" : "bg-primary/5 text-primary/90"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {planLabel}
            </div>
            <div className="mt-2 flex items-center justify-center gap-1.5 rounded-lg brutal-border bg-secondary/30 py-1.5 text-[11px] text-foreground/80">
              <Clock className="h-3.5 w-3.5" />
              {hours.toFixed(1)}h bot hours
            </div>
          </div>

          <div>
            <div className="px-2 mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              {s.t("account")}
            </div>
            <div className="space-y-1">
              {ACCOUNT.map((it) => (
                <SideItem
                  key={it.id}
                  it={it}
                  label={ACCOUNT_LABELS[it.id] ?? it.label}
                  active={tab === it.id}
                  onClick={() => setTab(it.id)}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="px-2 mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              {s.t("workspace")}
            </div>
            <div className="space-y-1">
              {WORKSPACE.map((it) => (
                <SideItem
                  key={it.id}
                  it={it}
                  label={WORKSPACE_LABELS[it.id] ?? it.label}
                  active={tab === it.id}
                  onClick={() => setTab(it.id)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="rounded-2xl brutal-border bg-card/60 p-6 min-h-[400px]">
          {tab === "profile" && (
            <Panel title={s.t("profile")} subtitle="Your Discord identity used across LuauX.">
              <Field label="Display name" value={displayName} />
              <Field label="Username" value={`@${handle}`} />
              <Field label="Email" value={data?.profile?.email ?? "—"} />
              <Field label="Discord ID" value={data?.profile?.discord_id ?? "—"} mono />
            </Panel>
          )}

          {tab === "subscription" && (
            <Panel title={s.t("subscription")} subtitle="Your current plan and renewal status.">
              <div className="rounded-xl brutal-border bg-background/40 p-4 flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Current plan
                  </div>
                  <div className="mt-1 font-display text-2xl font-semibold">{planLabel}</div>
                </div>
                <a
                  href="/dashboard/purchase"
                  className="rounded-lg brutal-border bg-primary/15 text-primary px-4 py-2 text-sm hover:bg-primary/25"
                >
                  {planActive ? "Change plan" : "Upgrade"}
                </a>
              </div>
            </Panel>
          )}

          {tab === "bot-hours" && (
            <Panel title={s.t("bot_hours")} subtitle="Remaining runtime and API access.">
              <Field label="Bot hours remaining" value={`${hours.toFixed(1)}h`} />
              <Field label="API key" value="Generated per plan — visit Bots to view" />
            </Panel>
          )}

          {tab === "notifications" && (
            <Panel title={s.t("notifications")} subtitle="Choose what LuauX pings you about.">
              <Toggle
                label="Deploy events"
                hint="Bot starts, stops and crash reports."
                checked={s.notifyDeploys}
                onChange={(v) => s.set("notifyDeploys", v)}
              />
              <Toggle
                label="Payments"
                hint="Invoice confirmations and receipts."
                checked={s.notifyPayments}
                onChange={(v) => s.set("notifyPayments", v)}
              />
              <Toggle
                label="Discord DMs"
                hint="Let the LuauX bot forward Discord DMs it receives on your behalf."
                checked={s.notifyDiscord}
                onChange={(v) => s.set("notifyDiscord", v)}
              />
              <Toggle
                label="Read my Discord DMs"
                hint="Allow the LuauX bot to read your Discord DMs so it can auto-reply, log conversations and trigger plugins."
                checked={s.botDmReading}
                onChange={(v) => s.set("botDmReading", v)}
              />
              <p className="text-[11px] text-muted-foreground pt-2">
                Preferences are saved to your browser. The Discord bot only reads DMs when this is
                on.
              </p>
            </Panel>
          )}

          {tab === "appearance" && (
            <Panel title={s.t("appearance")} subtitle="Customize the look and feel of LuauX.">
              {/* Mode toggle */}
              <div className="rounded-xl brutal-border bg-background/40 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {s.mode === "dark" ? <Moon className="h-4 w-4 text-primary" /> : <Sun className="h-4 w-4 text-primary" />}
                  {s.t("mode")}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{s.t("mode_hint")}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => s.set("mode", "dark")}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-semibold transition-all duration-300 border ${
                      s.mode === "dark"
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-card/60 text-foreground/60 border-border/40 hover:border-primary/20 hover:text-foreground/80"
                    }`}
                  >
                    <Moon className="h-3.5 w-3.5" />
                    {s.t("dark")}
                  </button>
                  <button
                    onClick={() => s.set("mode", "light")}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-semibold transition-all duration-300 border ${
                      s.mode === "light"
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-card/60 text-foreground/60 border-border/40 hover:border-primary/20 hover:text-foreground/80"
                    }`}
                  >
                    <Sun className="h-3.5 w-3.5" />
                    {s.t("light")}
                  </button>
                </div>
              </div>

              {/* Theme picker */}
              <div className="rounded-xl brutal-border bg-background/40 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Palette className="h-4 w-4 text-primary" />
                  {s.t("theme")}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{s.t("theme_hint")}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => s.set("theme", "gold")}
                    className={`flex-1 flex items-center gap-3 rounded-xl py-3 px-4 text-xs font-semibold transition-all duration-300 border ${
                      s.theme === "gold"
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-card/60 text-foreground/60 border-border/40 hover:border-primary/20 hover:text-foreground/80"
                    }`}
                  >
                    <span
                      className="h-8 w-8 rounded-lg shrink-0 border border-border/40"
                      style={{ backgroundColor: "oklch(0.79 0.16 85)" }}
                    />
                    <div className="text-left">
                      <div>{s.t("gold")}</div>
                      <div className="text-[10px] text-muted-foreground font-normal mt-0.5">Premium gold accents</div>
                    </div>
                  </button>
                  <button
                    onClick={() => s.set("theme", "blue")}
                    className={`flex-1 flex items-center gap-3 rounded-xl py-3 px-4 text-xs font-semibold transition-all duration-300 border ${
                      s.theme === "blue"
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-card/60 text-foreground/60 border-border/40 hover:border-primary/20 hover:text-foreground/80"
                    }`}
                  >
                    <span
                      className="h-8 w-8 rounded-lg shrink-0 border border-border/40"
                      style={{ backgroundColor: "oklch(0.55 0.2 250)" }}
                    />
                    <div className="text-left">
                      <div>{s.t("blue")}</div>
                      <div className="text-[10px] text-muted-foreground font-normal mt-0.5">Royal blue accents</div>
                    </div>
                  </button>
                </div>
              </div>
            </Panel>
          )}

          {tab === "language" && (
            <Panel
              title={s.t("language_currency")}
              subtitle="Set your preferred language and pricing display."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl brutal-border bg-background/40 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Languages className="h-4 w-4 text-primary" /> {s.t("language")}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{s.t("language_hint")}</p>
                  <Select
                    value={s.language}
                    onChange={(v) => s.set("language", v as typeof s.language)}
                    options={[
                      { value: "en", label: "🇬🇧  English" },
                      { value: "es", label: "🇪🇸  Español" },
                      { value: "fr", label: "🇫🇷  Français" },
                      { value: "de", label: "🇩🇪  Deutsch" },
                      { value: "pt", label: "🇧🇷  Português" },
                    ]}
                  />
                </div>
                <div className="rounded-xl brutal-border bg-background/40 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <CreditCard className="h-4 w-4 text-primary" /> {s.t("currency")}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{s.t("currency_hint")}</p>
                  <Select
                    value={s.currency}
                    onChange={(v) => s.set("currency", v as typeof s.currency)}
                    options={[
                      { value: "usd", label: "$  US Dollar" },
                      { value: "eur", label: "€  Euro" },
                      { value: "gbp", label: "£  British Pound" },
                      { value: "cad", label: "$  Canadian Dollar" },
                      { value: "aud", label: "$  Australian Dollar" },
                    ]}
                  />
                </div>
              </div>
            </Panel>
          )}

          {tab === "admin" && (
            <Panel title="Admin Access" subtitle="Enter the admin password to unlock all features.">
              {isAdmin ? (
                <div className="rounded-xl bg-primary/10 brutal-border px-4 py-3 text-sm text-primary">
                  <ShieldCheck className="h-4 w-4 inline mr-1" />
                  Admin mode active. All features unlocked.
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="text-xs space-y-1">
                    <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                      Admin Password
                    </span>
                    <input
                      type="password"
                      className="w-full rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
                      value={adminPw}
                      onChange={(e) => {
                        setAdminPw(e.target.value);
                        setAdminError(null);
                      }}
                      placeholder="Enter admin password"
                    />
                  </label>
                  {adminError && <div className="text-xs text-destructive">{adminError}</div>}
                  <button
                    onClick={async () => {
                      setAdminLoading(true);
                      setAdminError(null);
                      try {
                        const res = await fetch("/api/admin/login", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ password: adminPw }),
                        });
                        if (!res.ok) {
                          const d = await res.json();
                          throw new Error(d.error || "Wrong password");
                        }
                        setIsAdmin(true);
                        setAdminPw("");
                      } catch (e) {
                        setAdminError(e instanceof Error ? e.message : "Failed");
                      } finally {
                        setAdminLoading(false);
                      }
                    }}
                    disabled={adminLoading || !adminPw.trim()}
                    className="rounded-lg bg-primary text-primary-foreground px-5 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    {adminLoading ? "Checking..." : "Unlock Admin"}
                  </button>
                </div>
              )}
            </Panel>
          )}

          {tab === "admin" && isAdmin && <BlacklistPanel />}
        </div>
      </div>
    </div>
  );
}

function BlacklistPanel() {
  const [users, setUsers] = useState<{ discord_id: string; reason: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [blDiscordId, setBlDiscordId] = useState("");
  const [blReason, setBlReason] = useState("");
  const [blLoading, setBlLoading] = useState(false);
  const [blError, setBlError] = useState<string | null>(null);

  const loadBlacklist = async () => {
    try {
      const res = await fetch("/api/admin/blacklist");
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBlacklist();
  }, []);

  const addBlacklist = async () => {
    setBlLoading(true);
    setBlError(null);
    try {
      const res = await fetch("/api/admin/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discord_id: blDiscordId.trim(), reason: blReason.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed");
      }
      setBlDiscordId("");
      setBlReason("");
      await loadBlacklist();
    } catch (e) {
      setBlError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBlLoading(false);
    }
  };

  const removeBlacklist = async (discordId: string) => {
    try {
      await fetch("/api/admin/blacklist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discord_id: discordId }),
      });
      await loadBlacklist();
    } catch {
      /* ignore */
    }
  };

  return (
    <Panel title="User Blacklist" subtitle="Block specific Discord accounts from logging in.">
      <div className="space-y-4">
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 rounded-lg bg-background brutal-border px-3 py-2 text-sm font-mono"
            placeholder="Discord ID"
            value={blDiscordId}
            onChange={(e) => { setBlDiscordId(e.target.value); setBlError(null); }}
          />
          <input
            type="text"
            className="flex-1 rounded-lg bg-background brutal-border px-3 py-2 text-sm"
            placeholder="Reason (optional)"
            value={blReason}
            onChange={(e) => setBlReason(e.target.value)}
          />
          <button
            onClick={addBlacklist}
            disabled={blLoading || !blDiscordId.trim()}
            className="rounded-lg bg-destructive text-destructive-foreground px-4 py-2 text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
          >
            {blLoading ? "Adding..." : "Blacklist"}
          </button>
        </div>
        {blError && <div className="text-xs text-destructive">{blError}</div>}

        {loading ? (
          <div className="text-xs text-muted-foreground">Loading...</div>
        ) : users.length === 0 ? (
          <div className="text-xs text-muted-foreground">No blacklisted users.</div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.discord_id} className="flex items-center justify-between rounded-lg bg-secondary/30 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono">{u.discord_id}</div>
                  {u.reason && <div className="text-xs text-muted-foreground">{u.reason}</div>}
                </div>
                <button
                  onClick={() => removeBlacklist(u.discord_id)}
                  className="rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive px-2 py-1 text-xs ml-3 shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function SideItem({
  it,
  label,
  active,
  onClick,
}: {
  it: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> };
  label?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-primary/15 text-primary brutal-border"
          : "text-foreground/80 hover:bg-secondary/40 hover:text-foreground"
      }`}
    >
      <it.icon className="h-4 w-4" />
      <span>{label ?? it.label}</span>
    </button>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl brutal-border bg-background/40 p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="rounded-xl brutal-border bg-background/40 p-4 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        aria-label={label}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full brutal-border transition-colors ${
          checked ? "bg-primary" : "bg-secondary/60"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-background shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-[2px]"
          }`}
        />
      </button>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative mt-3">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg brutal-border bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
    </div>
  );
}
