import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutGrid,
  Bot,
  Power,
  ScrollText,
  Zap,
  MessageSquare,
  ShieldCheck,
  ShoppingCart,
  Receipt,
  LifeBuoy,
  Settings,
  LogOut,
} from "lucide-react";
import luauxLogo from "@/assets/luaux-logo.png";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — LuauX" }] }),
  component: DashboardLayout,
});

export type Me = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

const NAV: {
  section: string;
  items: { to: string; icon: React.ComponentType<{ className?: string }>; label: string }[];
}[] = [
  {
    section: "Core",
    items: [
      { to: "/dashboard", icon: LayoutGrid, label: "Overview" },
      { to: "/dashboard/bots", icon: Bot, label: "MC Auto-Message" },
      { to: "/dashboard/logs", icon: ScrollText, label: "Logs" },
    ],
  },
  {
    section: "Plugins",
    items: [
      { to: "/dashboard/discord-bot", icon: Power, label: "Plugins" },
      { to: "/dashboard/discord-spam", icon: Zap, label: "Discord Auto-Spam" },
      { to: "/dashboard/discord-auto-reply", icon: MessageSquare, label: "Discord Auto-Reply" },
      { to: "/dashboard/verification-bot", icon: ShieldCheck, label: "Verification Bot" },
    ],
  },
  {
    section: "Account",
    items: [
      { to: "/dashboard/purchase", icon: ShoppingCart, label: "Purchase" },
      { to: "/dashboard/billing", icon: Receipt, label: "Billing" },
      { to: "/dashboard/support", icon: LifeBuoy, label: "Support Tickets" },
    ],
  },
];

function DashboardLayout() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) navigate({ to: "/" });
        else setMe(d.user);
      })
      .catch(() => navigate({ to: "/" }))
      .finally(() => setLoading(false));
  }, [navigate]);

  const signOut = async () => {
    await fetch("/api/discord/logout", { method: "POST" });
    navigate({ to: "/" });
  };

  if (loading || !me) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-fade-in-scale">
          <div className="relative">
            <div className="h-12 w-12 rounded-xl bg-primary/20 border border-primary/30 animate-pulse" />
            <div className="absolute inset-[-4px] rounded-xl border border-primary/10 animate-ping opacity-30" />
          </div>
          <div className="text-muted-foreground text-xs uppercase tracking-widest">Loading fleet…</div>
        </div>
      </div>
    );
  }

  const displayName = me.global_name || me.username;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside
        className="w-64 shrink-0 flex flex-col sticky top-0 h-screen relative overflow-hidden"
        style={{
          background: "linear-gradient(180deg, oklch(0.03 0 0 / 0.98) 0%, oklch(0.02 0 0) 100%)",
          borderRight: "1px solid oklch(0.14 0 0 / 0.5)",
        }}
      >
        {/* Sidebar glow */}
        <div className="absolute top-0 right-0 w-px h-32 bg-gradient-to-b from-primary/20 via-primary/5 to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-40 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />

        {/* Logo */}
        <div className="p-5 flex items-center gap-3 relative">
          <div className="relative">
            <img
              src={luauxLogo}
              alt=""
              className="h-9 w-9 rounded-xl border border-border/60 bg-background p-1"
            />
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background">
              <div className="absolute inset-0 rounded-full bg-primary animate-ping opacity-50" />
            </div>
          </div>
          <div>
            <span className="font-display text-base font-bold text-gradient-gold tracking-wide">LuauX</span>
            <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">Fleet Control</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-6 overflow-y-auto relative">
          {NAV.map((sec) => (
            <div key={sec.section}>
              <div className="px-3 mb-2 text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50 font-semibold">
                {sec.section}
              </div>
              <div className="space-y-0.5">
                {sec.items.map((it) => {
                  const active =
                    it.to === "/dashboard" ? path === "/dashboard" : path.startsWith(it.to);
                  return (
                    <Link
                      key={it.to}
                      to={it.to}
                      className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-300 relative group ${
                        active
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "text-foreground/60 hover:bg-primary/5 hover:text-foreground/90 border border-transparent"
                      }`}
                    >
                      {/* Active glow */}
                      {active && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-primary shadow-[0_0_8px_oklch(0.79_0.16_85_/_0.5)]" />
                      )}
                      <it.icon className={`h-4 w-4 transition-colors duration-300 ${active ? "text-primary" : "group-hover:text-primary/70"}`} />
                      <span className={active ? "font-medium" : ""}>{it.label}</span>
                      {active && (
                        <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_oklch(0.79_0.16_85_/_0.6)]" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-border/40 relative">
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent" />
          <div className="flex items-center gap-2.5 rounded-xl bg-card/60 border border-border/40 p-2.5 hover:border-primary/15 transition-colors duration-300">
            {me.avatar ? (
              <div className="relative">
                <img src={me.avatar} alt="" className="h-9 w-9 rounded-lg border border-border/40" />
                <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary border border-background" />
              </div>
            ) : (
              <div className="relative">
                <div className="h-9 w-9 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                  {displayName[0]?.toUpperCase()}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary border border-background" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">{displayName}</div>
              <div className="text-[10px] text-muted-foreground/60 truncate">@{me.username}</div>
            </div>
          </div>
          <div className="mt-2 flex gap-1.5">
            <Link
              to="/dashboard/settings"
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-card/60 border border-border/40 hover:bg-primary/5 hover:border-primary/20 hover:text-primary py-2 text-xs transition-all duration-300"
            >
              <Settings className="h-3.5 w-3.5" /> Settings
            </Link>
            <button
              onClick={signOut}
              className="rounded-xl bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 hover:border-destructive/30 text-destructive px-3 py-2 transition-all duration-300 hover:shadow-[0_0_12px_oklch(0.65_0.24_25_/_0.2)]"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 relative">
        {/* Top ambient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-primary/3 rounded-full blur-[100px] pointer-events-none" />
        <div className="max-w-6xl mx-auto p-8 relative">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
