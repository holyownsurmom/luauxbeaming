import { EventEmitter } from "node:events";

export type BotType = "mc" | "discord";

export type BotStatus = "idle" | "connecting" | "running" | "stopping" | "error";

export type LogEntry = {
  ts: number;
  level: "info" | "warn" | "error" | "chat" | "bot" | "system";
  msg: string;
  botId: string;
};

export type BotInstance = {
  id: string;
  type: BotType;
  userId: string;
  label: string;
  status: BotStatus;
  config: Record<string, unknown>;
  startedAt: number | null;
  error: string | null;
  logs: LogEntry[];
  runtime: unknown;
};

const MAX_LOGS = 500;
const MAX_LISTENERS = 200;

class BotManager extends EventEmitter {
  private instances = new Map<string, BotInstance>();
  private logSubscribers = new Map<string, Set<(entry: LogEntry) => void>>();

  private globalSubscribers = new Set<(entry: LogEntry) => void>();

  create(id: string, type: BotType, userId: string, label: string, config: Record<string, unknown>): BotInstance {
    const existing = this.instances.get(id);
    if (existing) {
      if (existing.status === "running" || existing.status === "connecting") {
        throw new Error("Bot is already running");
      }
    }
    const bot: BotInstance = {
      id,
      type,
      userId,
      label,
      status: "idle",
      config,
      startedAt: null,
      error: null,
      logs: [],
      runtime: null,
    };
    this.instances.set(id, bot);
    return bot;
  }

  get(id: string): BotInstance | undefined {
    return this.instances.get(id);
  }

  getAll(userId: string): BotInstance[] {
    return Array.from(this.instances.values()).filter((b) => b.userId === userId);
  }

  getAllActive(): BotInstance[] {
    return Array.from(this.instances.values()).filter((b) => b.status === "running" || b.status === "connecting");
  }

  setStatus(id: string, status: BotStatus, error?: string) {
    const bot = this.instances.get(id);
    if (!bot) return;
    bot.status = status;
    if (error) bot.error = error;
    if (status === "running" && !bot.startedAt) bot.startedAt = Date.now();
    this.emit("status", { id, status, error });
  }

  log(id: string, level: LogEntry["level"], msg: string) {
    const bot = this.instances.get(id);
    if (!bot) return;
    const entry: LogEntry = { ts: Date.now(), level, msg, botId: id };
    bot.logs.push(entry);
    if (bot.logs.length > MAX_LOGS) bot.logs.shift();
    const botSubs = this.logSubscribers.get(id);
    if (botSubs) {
      for (const fn of botSubs) {
        try { fn(entry); } catch {}
      }
    }
    for (const fn of this.globalSubscribers) {
      try { fn(entry); } catch {}
    }
  }

  setRuntime(id: string, runtime: unknown) {
    const bot = this.instances.get(id);
    if (bot) bot.runtime = runtime;
  }

  getRuntime<T = unknown>(id: string): T | undefined {
    return this.instances.get(id)?.runtime as T | undefined;
  }

  async stop(id: string): Promise<boolean> {
    const bot = this.instances.get(id);
    if (!bot) return false;
    if (bot.status !== "running" && bot.status !== "connecting") return false;
    bot.status = "stopping";
    this.log(id, "system", "Stopping bot...");
    try {
      if (bot.type === "mc") {
        const runtime = bot.runtime as { end?: () => void; quit?: () => void } | null;
        if (runtime?.end) runtime.end();
        else if (runtime?.quit) runtime.quit();
      } else if (bot.type === "discord") {
        const runtime = bot.runtime as { destroy?: () => Promise<void> } | null;
        if (runtime?.destroy) await runtime.destroy();
      }
    } catch (e) {
      this.log(id, "error", `Stop error: ${e instanceof Error ? e.message : String(e)}`);
    }
    bot.status = "idle";
    bot.runtime = null;
    bot.startedAt = null;
    this.log(id, "system", "Bot stopped");
    return true;
  }

  async stopAll(userId?: string): Promise<number> {
    let count = 0;
    for (const [id, bot] of this.instances) {
      if (userId && bot.userId !== userId) continue;
      if (bot.status === "running" || bot.status === "connecting") {
        if (await this.stop(id)) count++;
      }
    }
    return count;
  }

  remove(id: string): boolean {
    return this.instances.delete(id);
  }

  subscribe(id: string, fn: (entry: LogEntry) => void): () => void {
    if (!this.logSubscribers.has(id)) this.logSubscribers.set(id, new Set());
    const set = this.logSubscribers.get(id)!;
    if (set.size >= MAX_LISTENERS) {
      const first = set.values().next().value;
      if (first) set.delete(first);
    }
    set.add(fn);
    return () => { set.delete(fn); if (set.size === 0) this.logSubscribers.delete(id); };
  }

  subscribeGlobal(fn: (entry: LogEntry) => void): () => void {
    this.globalSubscribers.add(fn);
    if (this.globalSubscribers.size >= MAX_LISTENERS) {
      const first = this.globalSubscribers.values().next().value;
      if (first) this.globalSubscribers.delete(first);
    }
    return () => { this.globalSubscribers.delete(fn); };
  }

  getLogs(id: string, since?: number): LogEntry[] {
    const bot = this.instances.get(id);
    if (!bot) return [];
    if (since) return bot.logs.filter((l) => l.ts > since);
    return bot.logs;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __botManager: BotManager | undefined;
}

const manager = globalThis.__botManager ?? new BotManager();
if (!globalThis.__botManager) globalThis.__botManager = manager;

export const botManager = manager;
