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
  return <div className={cn("space-y-6 animate-page-in", className)}>{children}</div>;
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
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
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
        "rounded-2xl border border-border/50 bg-card/70 backdrop-blur-sm",
        "shadow-[0_1px_0_0_oklch(1_0_0_/_0.04)_inset]",
        padded && "p-5 md:p-6",
        interactive &&
          "transition-colors duration-200 hover:border-primary/25 hover:bg-card/90",
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
    sm: "px-3.5 py-1.5 text-[11px]",
    md: "px-5 py-2.5 text-xs",
    lg: "px-6 py-3 text-xs",
  };
  const variants = {
    primary:
      "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 border border-transparent",
    secondary:
      "border border-border/60 bg-card/80 text-foreground hover:bg-primary/5 hover:border-primary/25 hover:text-primary",
    ghost: "border border-transparent text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
    danger:
      "border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15",
  };
  const cls = cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
  "w-full rounded-xl border border-border/60 bg-background/80 px-3.5 py-2.5 text-sm transition-colors placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:border-primary/40 disabled:opacity-50";
