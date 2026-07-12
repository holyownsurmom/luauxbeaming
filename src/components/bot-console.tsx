import { useEffect, useRef, useState } from "react";

export type ConsoleEntry = {
  ts: number;
  level: "info" | "warn" | "error" | "chat" | "bot" | "system";
  msg: string;
};

type Tag = {
  label: string;
  className: string;
};

function classifyEntry(level: string, msg: string): Tag {
  const m = msg.toLowerCase();

  if (level === "chat" || m.startsWith("<") || m.includes("[whisper]")) {
    return { label: "CHAT", className: "bg-cyan-500/20 text-cyan-300 border-cyan-400/40" };
  }
  if (level === "bot" || m.startsWith(">") || m.includes("broadcast") || m.includes("sent")) {
    return { label: "SEND", className: "bg-sky-500/20 text-sky-300 border-sky-400/40" };
  }
  if (
    m.includes("logged in") ||
    m.includes("spawned") ||
    m.includes("connecting") ||
    m.includes("authenticated")
  ) {
    return { label: "JOIN", className: "bg-amber-400/20 text-amber-300 border-amber-400/50" };
  }
  if (
    m.includes("paused") ||
    m.includes("afk") ||
    m.includes("idle") ||
    m.includes("waiting") ||
    m.includes("break")
  ) {
    return { label: "AFK", className: "bg-zinc-500/25 text-zinc-300 border-zinc-400/30" };
  }
  if (m.includes("ms_auth") || m.includes("microsoft") || m.includes("auth") || m.includes("token")) {
    return { label: "AUTH", className: "bg-violet-500/20 text-violet-300 border-violet-400/40" };
  }
  if (level === "error" || m.includes("kicked") || m.includes("failed")) {
    return { label: "ERR", className: "bg-red-500/20 text-red-300 border-red-400/40" };
  }
  if (level === "warn" || m.includes("reconnect")) {
    return { label: "WARN", className: "bg-orange-500/20 text-orange-300 border-orange-400/40" };
  }
  if (level === "system" || m.includes("webhook") || m.includes("hook") || m.includes("resumed")) {
    return { label: "HOOK", className: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/40" };
  }
  return { label: "LOG", className: "bg-zinc-600/30 text-zinc-300 border-zinc-500/40" };
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function entriesToText(entries: ConsoleEntry[]): string {
  return entries
    .map((e) => {
      const t = formatTime(e.ts);
      const tag = classifyEntry(e.level, e.msg).label;
      return `${t} [${tag}] ${e.msg}`;
    })
    .join("\n");
}

export function BotConsole({
  entries,
  maxHeight = 400,
  highlightBot = false,
  title = "LUAUX@RUNNER ~ TAIL -F BOT.LOG",
  botPaused = false,
  onTogglePause,
  pauseDisabled = false,
}: {
  entries: ConsoleEntry[];
  maxHeight?: number;
  highlightBot?: boolean;
  title?: string;
  /** When provided with onTogglePause, PAUSE controls the bot message loop */
  botPaused?: boolean;
  onTogglePause?: () => void;
  pauseDisabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollPaused, setScrollPaused] = useState(false);
  const [copied, setCopied] = useState(false);

  // Auto-scroll only when not scroll-paused and not bot-paused view preference
  useEffect(() => {
    if (scrollPaused) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length, scrollPaused]);

  const copyLog = async () => {
    const text = entriesToText(entries);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const pauseLabel = onTogglePause ? (botPaused ? "RESUME BOT" : "PAUSE BOT") : scrollPaused ? "RESUME" : "PAUSE";
  const pauseTitle = onTogglePause
    ? botPaused
      ? "Resume bot messages (stay online)"
      : "Pause bot messages (stay online)"
    : scrollPaused
      ? "Resume auto-scroll"
      : "Pause auto-scroll";

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-amber-500/35 bg-black"
      style={{ boxShadow: "0 0 0 1px rgba(245,158,11,0.25), 0 0 28px rgba(245,158,11,0.12)" }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-amber-500/20 bg-zinc-950/95 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex gap-1.5 shrink-0">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-200/70 truncate">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {entries.length > 0 && (
            <span className="text-[10px] font-mono text-zinc-500">{entries.length}</span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-mono ${
              botPaused
                ? "border-amber-400/50 bg-amber-400/15 text-amber-200"
                : "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${botPaused ? "bg-amber-400" : "bg-emerald-400 animate-pulse"}`}
            />
            {botPaused ? "paused" : "live"}
          </span>
          <button
            type="button"
            onClick={copyLog}
            disabled={entries.length === 0}
            className="text-[10px] font-mono text-zinc-400 hover:text-amber-300 transition-colors px-1.5 py-0.5 rounded border border-zinc-700/60 hover:border-amber-500/30 disabled:opacity-40"
            title="Copy full log to clipboard"
          >
            {copied ? "COPIED" : "COPY LOG"}
          </button>
          {onTogglePause ? (
            <button
              type="button"
              onClick={onTogglePause}
              disabled={pauseDisabled}
              className={`text-[10px] font-mono transition-colors px-1.5 py-0.5 rounded border disabled:opacity-40 ${
                botPaused
                  ? "text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10"
                  : "text-amber-300 border-amber-500/40 hover:bg-amber-500/10"
              }`}
              title={pauseTitle}
            >
              {pauseLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setScrollPaused(!scrollPaused)}
              className="text-[10px] font-mono text-zinc-500 hover:text-amber-300 transition-colors px-1.5 py-0.5 rounded border border-zinc-700/60 hover:border-amber-500/30"
              title={pauseTitle}
            >
              {pauseLabel}
            </button>
          )}
          {/* Always allow scroll freeze when bot pause is used */}
          {onTogglePause && (
            <button
              type="button"
              onClick={() => setScrollPaused(!scrollPaused)}
              className="text-[10px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded border border-zinc-800"
              title={scrollPaused ? "Resume auto-scroll" : "Freeze auto-scroll"}
            >
              {scrollPaused ? "SCROLL ON" : "SCROLL OFF"}
            </button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="font-mono text-[12px] leading-6 overflow-y-auto overflow-x-hidden px-3 py-3 bg-black overscroll-contain"
        style={{ height: maxHeight, maxHeight }}
        onWheel={(e) => e.stopPropagation()}
      >
        {entries.length === 0 ? (
          <div className="py-14 text-center">
            <div className="text-amber-500/40 text-[11px] tracking-[0.25em] uppercase mb-2">
              awaiting signal
            </div>
            <div className="flex justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-1 w-1 rounded-full bg-amber-400/50 animate-pulse"
                  style={{ animationDelay: `${i * 0.25}s` }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            {entries.map((entry, i) => {
              const tag = classifyEntry(entry.level, entry.msg);
              const isBot = highlightBot && entry.level === "bot";
              return (
                <div
                  key={`${entry.ts}-${i}`}
                  className={`flex items-start gap-2 ${isBot ? "bg-sky-500/5 -mx-1 px-1 rounded" : ""}`}
                >
                  <span className="text-zinc-600 shrink-0 w-[58px] tabular-nums select-none">
                    {formatTime(entry.ts)}
                  </span>
                  <span
                    className={`shrink-0 inline-flex items-center justify-center min-w-[42px] px-1.5 rounded-full border text-[9px] font-bold tracking-wide ${tag.className}`}
                  >
                    {tag.label}
                  </span>
                  <span
                    className={`min-w-0 break-words ${
                      entry.level === "error"
                        ? "text-red-300/90"
                        : entry.level === "warn"
                          ? "text-amber-200/90"
                          : entry.level === "bot"
                            ? "text-sky-200/90"
                            : entry.level === "chat"
                              ? "text-cyan-100/85"
                              : "text-zinc-200/85"
                    }`}
                  >
                    {entry.msg}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 mt-2 pt-1 text-amber-400/90">
          <span className="text-amber-500/80">&gt;</span>
          <span
            className="inline-block h-3.5 w-2.5 bg-amber-400"
            style={{ animation: "console-blink 1.1s step-end infinite" }}
          />
        </div>
      </div>

      <style>{`
        @keyframes console-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
