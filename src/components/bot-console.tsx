import { useEffect, useRef, useState } from "react";

export type ConsoleEntry = {
  ts: number;
  level: "info" | "warn" | "error" | "chat" | "bot" | "system";
  msg: string;
};

const LEVEL_COLORS: Record<string, string> = {
  info: "text-foreground/50",
  warn: "text-amber-400",
  error: "text-red-400",
  chat: "text-foreground/70",
  bot: "text-primary",
  system: "text-primary/70",
};

const LEVEL_PREFIX: Record<string, string> = {
  info: "[·]",
  warn: "[!]",
  error: "[×]",
  chat: "[<]",
  bot: "[>]",
  system: "[#]",
};

const LEVEL_GLOW: Record<string, string> = {
  warn: "drop-shadow(0 0 3px oklch(0.85 0.18 85 / 0.4))",
  error: "drop-shadow(0 0 3px oklch(0.6 0.22 25 / 0.4))",
  bot: "drop-shadow(0 0 4px oklch(0.79 0.16 85 / 0.5))",
  system: "drop-shadow(0 0 3px oklch(0.68 0.18 250 / 0.3))",
};

export function BotConsole({
  entries,
  maxHeight = 400,
  highlightBot = false,
}: {
  entries: ConsoleEntry[];
  maxHeight?: number;
  highlightBot?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused) return;
    const el = containerRef.current;
    if (!el) return;
    // Scroll only the console container — never the page
    el.scrollTop = el.scrollHeight;
  }, [entries.length, isPaused]);

  return (
    <div className="relative group/console rounded-xl overflow-hidden overscroll-contain">
      {/* CRT scanline overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-10 rounded-xl"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)",
        }}
      />

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/80 border-b border-primary/20 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-primary/70" />
          </div>
          <span className="text-[10px] font-mono text-muted-foreground/40 ml-2 uppercase tracking-widest">
            live console
          </span>
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground/30">
              {entries.length} entries
            </span>
          )}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="text-[10px] font-mono text-muted-foreground/50 hover:text-primary transition-colors px-1.5 py-0.5 rounded bg-secondary/30 hover:bg-secondary/60"
            title={isPaused ? "Resume auto-scroll" : "Pause auto-scroll"}
          >
            {isPaused ? "RESUME" : "PAUSE"}
          </button>
        </div>
      </div>

      {/* Console body — fixed height, scroll isolated from page */}
      <div
        ref={containerRef}
        className="font-mono text-xs overflow-y-auto overflow-x-hidden p-4 space-y-0 bg-black/90 relative overscroll-contain"
        style={{ height: maxHeight, maxHeight }}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Vignette */}
        <div
          className="pointer-events-none absolute inset-0 z-20"
          style={{
            boxShadow: "inset 0 0 60px rgba(0,0,0,0.5), inset 0 0 120px rgba(0,0,0,0.2)",
          }}
        />

        {entries.length === 0 ? (
          <div className="py-12 text-center relative z-30">
            <div className="text-primary/30 text-[11px] font-mono tracking-widest uppercase mb-2">
              Awaiting signal
            </div>
            <div className="flex justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-1 w-1 rounded-full bg-primary/40"
                  style={{
                    animation: `crt-flicker 1.5s infinite`,
                    animationDelay: `${i * 0.3}s`,
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          entries.map((entry, i) => (
            <div
              key={`${entry.ts}-${i}`}
              className={`flex gap-2 leading-relaxed relative z-30 transition-all duration-200 ${
                highlightBot && entry.level === "bot"
                  ? "bg-primary/10 -mx-4 px-4 border-l-2 border-primary/40"
                  : entry.level === "error"
                    ? "bg-red-500/5 -mx-4 px-4 border-l-2 border-red-500/30"
                    : entry.level === "warn"
                      ? "bg-amber-500/5 -mx-4 px-4 border-l-2 border-amber-500/20"
                      : ""
              }`}
            >
              <span className="text-muted-foreground/25 select-none shrink-0 w-[68px] text-right">
                {new Date(entry.ts).toLocaleTimeString("en-US", {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              <span
                className={`shrink-0 ${LEVEL_COLORS[entry.level] ?? "text-foreground/40"}`}
                style={
                  entry.level in LEVEL_GLOW
                    ? { filter: LEVEL_GLOW[entry.level] }
                    : undefined
                }
              >
                {LEVEL_PREFIX[entry.level] ?? "·"}
              </span>
              <span
                className={`${LEVEL_COLORS[entry.level] ?? "text-foreground/40"}`}
                style={
                  entry.level === "bot"
                    ? { filter: "drop-shadow(0 0 2px oklch(0.79 0.16 85 / 0.3))" }
                    : undefined
                }
              >
                {entry.msg}
              </span>
            </div>
          ))
        )}

        {/* Blinking cursor */}
        {entries.length > 0 && !isPaused && (
          <div className="flex items-center gap-2 relative z-30 pt-1">
            <span className="text-primary/60 animate-pulse">_</span>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Bottom glow bar */}
      <div className="h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
    </div>
  );
}
