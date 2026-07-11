import { useEffect, useRef } from "react";

export type ConsoleEntry = {
  ts: number;
  level: "info" | "warn" | "error" | "chat" | "bot" | "system";
  msg: string;
};

const LEVEL_COLORS: Record<string, string> = {
  info: "text-foreground/60",
  warn: "text-amber-400",
  error: "text-destructive",
  chat: "text-foreground/80",
  bot: "text-primary font-semibold",
  system: "text-blue-400",
};

const LEVEL_PREFIX: Record<string, string> = {
  info: "·",
  warn: "!",
  error: "×",
  chat: "<",
  bot: ">",
  system: "#",
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div
      className="rounded-xl brutal-border bg-black/60 font-mono text-xs overflow-y-auto p-4 space-y-0.5"
      style={{ maxHeight }}
    >
      {entries.length === 0 ? (
        <div className="text-muted-foreground/40 italic py-8 text-center">
          Waiting for output...
        </div>
      ) : (
        entries.map((entry, i) => (
          <div
            key={`${entry.ts}-${i}`}
            className={`flex gap-2 leading-relaxed ${
              highlightBot && entry.level === "bot" ? "bg-primary/10 -mx-4 px-4 rounded" : ""
            }`}
          >
            <span className="text-muted-foreground/30 select-none shrink-0 w-[72px]">
              {new Date(entry.ts).toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <span
              className={`shrink-0 w-3 text-center ${LEVEL_COLORS[entry.level] ?? "text-foreground/50"}`}
            >
              {LEVEL_PREFIX[entry.level] ?? "·"}
            </span>
            <span className={LEVEL_COLORS[entry.level] ?? "text-foreground/50"}>{entry.msg}</span>
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
