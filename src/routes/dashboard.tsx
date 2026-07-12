import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback } from "react";
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
  ChevronRight,
  Menu,
  X,
  Sun,
  Moon,
  Search,
  Command,
} from "lucide-react";
import luauxLogo from "@/assets/luaux-logo.png";
import { useSettings } from "@/lib/settings-context";

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
      { to: "/dashboard/support", icon: LifeBuoy, label: "Support" },
    ],
  },
];

function SidebarContent({
  me,
  path,
  onNavigate,
  onSignOut,
  isMobile = false,
  onClose,
}: {
  me: Me;
  path: string;
  onSignOut: () => void;
  onNavigate: () => void;
  isMobile?: boolean;
  onClose?: () => void;
}) {
  const displayName = me.global_name || me.username;

  return (
    <div className="h-full flex flex-col relative">
      {/* Ambient glow effects */}
      <div className="absolute top-0 right-0 w-px h-40 bg-gradient-to-b from-primary/30 via-primary/10 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-48 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-primary/3 to-transparent pointer-events-none" />

      {/* Logo + close button */}
      <div className="p-5 flex items-center gap-3 relative shrink-0">
        <div className="relative">
          <img
            src={luauxLogo}
            alt=""
            className="h-10 w-10 rounded-xl border border-border/60 bg-background p-1"
          />
          <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background">
            <div className="absolute inset-0 rounded-full bg-primary animate-ping opacity-50" />
          </div>
        </div>
        <div className="flex-1">
          <span className="font-display text-base font-bold text-gradient-gold tracking-wide">
            LuauX
          </span>
          <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
            Bot Control
          </div>
        </div>
        {isMobile && onClose && (
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg bg-secondary/60 hover:bg-secondary flex items-center justify-center transition-colors"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-5 overflow-y-auto relative scrollbar-thin">
        {NAV.map((sec, si) => (
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
                    onClick={() => {
                      onNavigate();
                      onClose?.();
                    }}
                    className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-300 relative group/item ${
                      active
                        ? "bg-primary/10 text-primary border border-primary/25 shadow-[0_0_20px_oklch(0.79_0.16_85_/_0.08)]"
                        : "text-foreground/60 hover:bg-primary/5 hover:text-foreground/90 border border-transparent"
                    }`}
                  >
                    {active && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full bg-primary shadow-[0_0_12px_oklch(0.79_0.16_85_/_0.6)] animate-glow-pulse-ring" />
                    )}
                    <it.icon
                      className={`h-4 w-4 transition-all duration-300 ${
                        active
                          ? "text-primary drop-shadow-[0_0_6px_oklch(0.79_0.16_85_/_0.5)]"
                          : "text-muted-foreground/60 group-hover/item:text-primary/70 group-hover/item:drop-shadow-[0_0_4px_oklch(0.79_0.16_85_/_0.3)]"
                      }`}
                    />
                    <span className={active ? "font-semibold" : ""}>{it.label}</span>
                    {active && (
                      <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_oklch(0.79_0.16_85_/_0.7)] animate-status-pulse" />
                    )}
                    {!active && (
                      <ChevronRight className="ml-auto h-3 w-3 opacity-0 group-hover/item:opacity-100 transition-all duration-300 text-primary/50 group-hover/item:translate-x-0.5" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User section */}
      <div className="p-3 border-t border-border/40 relative shrink-0">
        <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent" />
        <div className="flex items-center gap-2.5 rounded-xl bg-card/60 border border-border/40 p-2.5 hover:border-primary/15 transition-colors duration-300">
          {me.avatar ? (
            <div className="relative shrink-0">
              <img src={me.avatar} alt="" className="h-9 w-9 rounded-lg border border-border/40" />
              <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary border border-background" />
            </div>
          ) : (
            <div className="relative shrink-0">
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
            onClick={() => {
              onNavigate();
              onClose?.();
            }}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-card/60 border border-border/40 hover:bg-primary/5 hover:border-primary/20 hover:text-primary py-2 text-xs transition-all duration-300"
          >
            <Settings className="h-3.5 w-3.5" /> Settings
          </Link>
          <button
            onClick={() => {
              onSignOut();
              onClose?.();
            }}
            className="rounded-xl bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 hover:border-destructive/30 text-destructive px-3 py-2 transition-all duration-300 hover:shadow-[0_0_12px_oklch(0.65_0.24_25_/_0.2)]"
            aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function DashboardLayout() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
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

  const openSidebar = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setSidebarOpen(true);
  }, []);

  const closeSidebar = useCallback(() => {
    hoverTimeout.current = setTimeout(() => setSidebarOpen(false), 300);
  }, []);

  const keepOpen = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (loading || !me) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-fade-in-scale">
          <div className="relative">
            <div className="h-12 w-12 rounded-xl bg-primary/20 border border-primary/30 animate-pulse" />
            <div className="absolute inset-[-4px] rounded-xl border border-primary/10 animate-ping opacity-30" />
          </div>
          <div className="text-muted-foreground text-xs uppercase tracking-widest">Loading workspace...</div>
        </div>
      </div>
    );
  }

  const handleSignOut = signOut;
  const noop = () => {};

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-[60] md:hidden h-10 w-10 rounded-xl bg-card/90 backdrop-blur-sm border border-border/60 flex items-center justify-center shadow-lg hover:bg-card transition-colors"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5 text-foreground/80" />
      </button>

      {/* Top bar — mode toggle + search trigger */}
      <TopBar onOpenSearch={() => setSearchOpen(true)} />

      {/* Mobile sheet overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-[280px] bg-card border-r border-border shadow-2xl animate-slide-in-left overflow-hidden">
            <SidebarContent
              me={me}
              path={path}
              onNavigate={noop}
              onSignOut={handleSignOut}
              isMobile
              onClose={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Desktop hover sidebar */}
      <div
        className="fixed left-0 top-0 bottom-0 z-50 w-[3px] hover:w-[6px] transition-all duration-500 cursor-pointer group/trigger hidden md:block"
        onMouseEnter={openSidebar}
        style={{
          background: sidebarOpen
            ? "linear-gradient(180deg, color-mix(in oklch, var(--primary) 60%, transparent), color-mix(in oklch, var(--primary) 20%, transparent), color-mix(in oklch, var(--primary) 60%, transparent))"
            : "linear-gradient(180deg, color-mix(in oklch, var(--primary) 30%, transparent), color-mix(in oklch, var(--primary) 10%, transparent), color-mix(in oklch, var(--primary) 30%, transparent))",
          boxShadow: sidebarOpen
            ? "0 0 20px color-mix(in oklch, var(--primary) 30%, transparent)"
            : "0 0 8px color-mix(in oklch, var(--primary) 15%, transparent)",
        }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-primary/40 group-hover/trigger:bg-primary/80 transition-all duration-300" />
      </div>

      {/* Desktop sidebar panel */}
      <div
        ref={sidebarRef}
        className="fixed left-0 top-0 bottom-0 z-40 hidden md:flex"
        onMouseEnter={keepOpen}
        onMouseLeave={closeSidebar}
        style={{
          pointerEvents: sidebarOpen ? "auto" : "none",
        }}
      >
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-500"
          style={{
            opacity: sidebarOpen ? 1 : 0,
            pointerEvents: sidebarOpen ? "auto" : "none",
          }}
          onClick={closeSidebar}
        />
        <div
          className="relative h-full flex flex-col transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{
            width: sidebarOpen ? 280 : 0,
            opacity: sidebarOpen ? 1 : 0,
            transform: sidebarOpen ? "translateX(0)" : "translateX(-20px)",
            background: "var(--card)",
            borderRight: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          <SidebarContent me={me} path={path} onNavigate={noop} onSignOut={handleSignOut} />
        </div>
      </div>

      {/* Main content */}
      <main className="min-h-screen relative noise-texture">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-primary/4 rounded-full blur-[150px] pointer-events-none animate-glow-breathe" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-primary/3 rounded-full blur-[120px] pointer-events-none opacity-40" />
        <div className="max-w-6xl mx-auto p-4 md:p-8 pt-16 md:pt-8 relative">
          <Outlet />
        </div>
      </main>

      {/* Command palette */}
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} path={path} />
    </div>
  );
}

function TopBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const s = useSettings();

  return (
    <div className="fixed top-0 right-0 z-[55] flex items-center gap-2 p-4 md:hidden">
      <button
        onClick={onOpenSearch}
        className="h-10 w-10 rounded-xl bg-card/90 backdrop-blur-sm border border-border/60 flex items-center justify-center shadow-lg hover:bg-card transition-colors"
        aria-label="Search"
      >
        <Search className="h-4 w-4 text-foreground/60" />
      </button>
      <button
        onClick={() => s.set("mode", s.mode === "dark" ? "light" : "dark")}
        className="h-10 w-10 rounded-xl bg-card/90 backdrop-blur-sm border border-border/60 flex items-center justify-center shadow-lg hover:bg-card transition-colors"
        aria-label="Toggle mode"
      >
        {s.mode === "dark" ? (
          <Sun className="h-4 w-4 text-foreground/60" />
        ) : (
          <Moon className="h-4 w-4 text-foreground/60" />
        )}
      </button>
    </div>
  );
}

const CMD_ITEMS = [
  ...NAV.flatMap((sec) => sec.items.map((it) => ({ ...it, section: sec.section }))),
  { to: "/dashboard/settings", icon: Settings, label: "Settings", section: "Account" },
];

function CommandPalette({
  open,
  onClose,
  path,
}: {
  open: boolean;
  onClose: () => void;
  path: string;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = CMD_ITEMS.filter((it) =>
    it.label.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const go = useCallback(
    (to: string) => {
      navigate({ to });
      onClose();
    },
    [navigate, onClose],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % Math.max(filtered.length, 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1));
      }
      if (e.key === "Enter" && filtered[selectedIdx]) {
        go(filtered[selectedIdx].to);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filtered, selectedIdx, go]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl bg-card border border-border/60 shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Navigate..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
            ESC
          </kbd>
        </div>
        <div className="max-h-72 overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground/50">No results</div>
          )}
          {filtered.map((it, i) => {
            const active = it.to === "/dashboard" ? path === "/dashboard" : path.startsWith(it.to);
            return (
              <button
                key={it.to}
                onClick={() => go(it.to)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  i === selectedIdx ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-muted/50"
                }`}
              >
                <it.icon className="h-4 w-4 shrink-0" />
                <span>{it.label}</span>
                {active && (
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-primary/60 font-semibold">current</span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground/40">{it.section}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border/40 text-[10px] text-muted-foreground/40">
          <span className="flex items-center gap-1"><Command className="h-3 w-3" />K</span>
          <span>Navigate</span>
          <span className="flex items-center gap-0.5">↑↓ select</span>
          <span className="flex items-center gap-0.5">↵ open</span>
        </div>
      </div>
    </div>
  );
}
