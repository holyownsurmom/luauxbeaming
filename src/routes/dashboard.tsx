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
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 rounded-lg bg-primary/20 border border-primary/30 animate-pulse" />
          <div className="text-muted-foreground text-xs uppercase tracking-widest">Loading dashboard…</div>
        </div>
      </div>
    );
  }

  const displayName = me.global_name || me.username;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-border/40 flex flex-col sticky top-0 h-screen" style={{ background: "oklch(0.04 0.005 80 / 0.8)" }}>
        {/* Logo */}
        <div className="p-5 flex items-center gap-3">
          <div className="relative">
            <img
              src={luauxLogo}
              alt=""
              className="h-9 w-9 rounded-xl border border-border/60 bg-background p-1"
            />
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background" />
          </div>
          <div>
            <span className="font-display text-base font-bold text-gradient-gold tracking-wide">LuauX</span>
            <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">Fleet Control</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-6 overflow-y-auto">
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
                      className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
                        active
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "text-foreground/60 hover:bg-primary/5 hover:text-foreground/90 border border-transparent"
                      }`}
                    >
                      <it.icon className={`h-4 w-4 ${active ? "text-primary" : ""}`} />
                      <span className={active ? "font-medium" : ""}>{it.label}</span>
                      {active && (
                        <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-border/40">
          <div className="flex items-center gap-2.5 rounded-xl bg-card/60 border border-border/40 p-2.5">
            {me.avatar ? (
              <img src={me.avatar} alt="" className="h-9 w-9 rounded-lg border border-border/40" />
            ) : (
              <div className="h-9 w-9 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                {displayName[0]?.toUpperCase()}
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
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-card/60 border border-border/40 hover:bg-primary/5 hover:border-primary/20 hover:text-primary py-2 text-xs transition-all duration-200"
            >
              <Settings className="h-3.5 w-3.5" /> Settings
            </Link>
            <button
              onClick={signOut}
              className="rounded-xl bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 hover:border-destructive/30 text-destructive px-3 py-2 transition-all duration-200"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
