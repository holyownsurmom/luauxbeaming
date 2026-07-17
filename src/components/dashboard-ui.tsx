import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/** Consistent page shell spacing + enter animation */
export function PageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("space-y-4 animate-page-in max-w-5xl", className)}>{children}</div>;
}

/** Wider shell for bot tools (config + console) */
export function BotPageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-5 animate-page-in w-full max-w-[1400px]", className)}>
      {children}
    </div>
  );
}

/**
 * Two-column bot workspace: main controls + sticky side rail (console / jobs).
 * Stacks on mobile.
 */
export function BotWorkspace({
  main,
  side,
  className,
}: {
  main: ReactNode;
  side?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-5 lg:grid-cols-12 lg:items-start",
        className,
      )}
    >
      <div className="lg:col-span-7 xl:col-span-7 space-y-5 min-w-0">{main}</div>
      {side ? (
        <div className="lg:col-span-5 xl:col-span-5 space-y-5 min-w-0 lg:sticky lg:top-4 lg:self-start">
          {side}
        </div>
      ) : null}
    </div>
  );
}

/** Standard page title + description + optional actions */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="mt-2.5 text-sm font-semibold text-muted-foreground max-w-2xl leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 shrink-0 font-ui">{actions}</div>
      ) : null}
    </header>
  );
}

/** Unified card / panel surface */
export function Surface({
  children,
  className,
  padded = false,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card",
        "shadow-[0_1px_0_0_oklch(1_0_0_/_0.05)_inset,0_12px_40px_-24px_oklch(0_0_0_/_0.55)]",
        padded && "p-5 md:p-6",
        interactive &&
          "transition-all duration-200 hover:border-primary/30 hover:bg-card hover:-translate-y-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Empty / paywall / zero-data state */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-12 md:py-14",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-secondary/40 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <h3 className="font-display text-base font-semibold tracking-tight">{title}</h3>
      {description ? (
        <p className="mt-2 text-sm text-muted-foreground max-w-sm leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Error panel with retry */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-destructive/25 bg-destructive/5 px-5 py-8 text-center space-y-3",
        className,
      )}
    >
      <p className="text-sm font-medium text-destructive">{title}</p>
      {message ? (
        <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">{message}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const s = status.toLowerCase();
  const tone =
    s === "finished" || s === "confirmed" || s === "running" || s === "active" || s === "ok"
      ? "bg-primary/15 text-primary border-primary/20"
      : s === "failed" || s === "expired" || s === "refunded" || s === "error" || s === "token_expired"
        ? "bg-destructive/15 text-destructive border-destructive/20"
        : s === "paused" || s === "pending" || s === "waiting" || s === "stopping"
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
          : "bg-secondary/80 text-muted-foreground border-border/50";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest",
        tone,
        className,
      )}
    >
      {status}
    </span>
  );
}

/** Primary / secondary CTA pills used across dashboard */
export function DashButton({
  children,
  className,
  variant = "primary",
  size = "md",
  asChild,
  href,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  asChild?: boolean;
  href?: string;
}) {
  const sizes = {
    sm: "px-3 py-1.5 text-xs rounded-lg",
    md: "px-3.5 py-2 text-sm rounded-xl",
    lg: "px-5 py-2.5 text-sm rounded-xl",
  };
  const variants = {
    primary:
      "bg-primary text-primary-foreground hover:bg-primary/90 border border-transparent shadow-sm shadow-primary/15",
    secondary:
      "border border-border/70 bg-background/80 text-foreground hover:bg-secondary hover:border-border",
    ghost:
      "border border-transparent text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
    danger: "border border-destructive/40 text-destructive hover:bg-destructive/10",
  };
  const cls = cn(
    "inline-flex items-center justify-center gap-1.5 font-semibold transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    sizes[size],
    variants[variant],
    className,
  );

  if (href) {
    return (
      <Link to={href} className={cls}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" className={cls} {...props}>
      {children}
    </button>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-semibold",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "block text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-medium mb-1.5",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Shared control chrome for inputs/selects/textareas */
export const fieldControlClass =
  "w-full rounded-xl border border-border/70 bg-background/80 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/15 disabled:opacity-50";

export const fieldMonoClass = `${fieldControlClass} font-mono text-[13px]`;

/** Bot page header — clean product chrome */
export function BotPageHeader({
  title,
  description,
  badge,
  actions,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight">
            {title}
          </h1>
          {badge}
        </div>
        {description ? (
          <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
      ) : null}
    </header>
  );
}

/** Elevated bot section card */
export function BotPanel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border/60 bg-card/90 overflow-hidden",
        "shadow-[0_1px_0_0_oklch(1_0_0_/_0.04)_inset,0_12px_40px_-28px_oklch(0_0_0_/_0.5)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-border/50 bg-secondary/15">
        <div className="min-w-0">
          <div className="text-sm font-bold tracking-tight truncate">{title}</div>
          {subtitle ? (
            <div className="text-[11px] text-muted-foreground truncate mt-0.5 font-mono">
              {subtitle}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
      </div>
      <div className={cn("p-4 sm:p-5 space-y-3.5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function BotField({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
      {hint ? <span className="block text-[11px] text-muted-foreground leading-snug">{hint}</span> : null}
    </label>
  );
}

export function BotTabBar({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string; icon?: React.ComponentType<{ className?: string }> }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-secondary/30 border border-border/40">
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors",
              active
                ? "bg-background text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground border border-transparent",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function LicenseBar({
  isAdmin,
  expiresAt,
  licenseKey,
  onCopy,
  copied,
}: {
  isAdmin?: boolean;
  expiresAt?: string;
  licenseKey?: string;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm rounded-2xl border border-border/60 bg-card/80 px-4 py-3">
      <span className="inline-flex items-center gap-2 font-semibold">
        <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
        {isAdmin ? "Admin access" : "Licensed"}
        {!isAdmin && expiresAt
          ? ` · expires ${new Date(expiresAt).toLocaleDateString()}`
          : ""}
      </span>
      {!isAdmin && licenseKey ? (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <code className="truncate font-mono text-xs text-muted-foreground bg-secondary/40 px-2 py-1 rounded-md">
            {licenseKey}
          </code>
          {onCopy ? (
            <button
              type="button"
              onClick={onCopy}
              className="shrink-0 text-xs font-semibold text-primary hover:underline"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AdminBadge() {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider text-primary border border-primary/35 bg-primary/10 rounded-full px-2 py-0.5">
      admin
    </span>
  );
}
