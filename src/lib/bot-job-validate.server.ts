/** Shared validation for bot start API bodies (MC + Discord plugins). */

const MAX_MESSAGES = 50;
const MAX_MESSAGE_LEN = 2000;
const MAX_TOKEN_LEN = 512;
const MAX_CHANNEL_ID_LEN = 32;
const MAX_HOST_LEN = 253;
const MIN_DISCORD_INTERVAL_SEC = 600;
const MIN_MC_INTERVAL_SEC = 5;
const MAX_INTERVAL_SEC = 86_400;

/** Same private/reserved host block as /api/bots/mc/ping */
const PRIVATE_HOST_RE =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|localhost|::1|169\.254\.|metadata\.google)/i;

export type DiscordSpamBody = {
  token: string;
  channelId: string;
  messages: string[];
  interval: number;
  guildId?: string;
  label?: string;
  humanize: boolean;
  minDelay: number;
  maxDelay: number;
  deleteAfterSend: boolean;
};

export type DiscordAutoreplyBody = {
  token: string;
  messages: string[];
  guildId?: string;
  channelId?: string;
  label?: string;
  matchMode?: string;
  cooldownSec?: number;
  minDelay: number;
  maxDelay: number;
  typing: boolean;
  autoAcceptFriends: boolean;
};

export function clampInterval(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function normalizeMessages(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const m of raw.slice(0, MAX_MESSAGES)) {
    const s = String(m ?? "").trim().slice(0, MAX_MESSAGE_LEN);
    if (s) out.push(s);
  }
  return out.length ? out : null;
}

function parseToken(raw: unknown): string | null {
  const token = String(raw ?? "").trim();
  if (!token) return null;
  if (token.length > MAX_TOKEN_LEN) return null;
  return token;
}

function asBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return fallback;
}

export function validateDiscordSpamBody(body: Record<string, unknown>):
  | { ok: true; config: DiscordSpamBody }
  | { ok: false; error: string } {
  const token = parseToken(body.token);
  if (!token) {
    return {
      ok: false,
      error: !String(body.token ?? "").trim()
        ? "token required"
        : `token too long (max ${MAX_TOKEN_LEN})`,
    };
  }
  const channelId = String(body.channelId ?? "").trim().slice(0, MAX_CHANNEL_ID_LEN);
  const messages = normalizeMessages(body.messages);
  if (!channelId || !/^\d{5,32}$/.test(channelId)) {
    return { ok: false, error: "channelId must be a numeric Discord snowflake" };
  }
  if (!messages) return { ok: false, error: "At least one non-empty message required" };
  const interval = clampInterval(
    body.interval,
    MIN_DISCORD_INTERVAL_SEC,
    MAX_INTERVAL_SEC,
    MIN_DISCORD_INTERVAL_SEC,
  );
  const guildId =
    body.guildId != null ? String(body.guildId).trim().slice(0, MAX_CHANNEL_ID_LEN) : undefined;
  const label = body.label != null ? String(body.label).trim().slice(0, 64) : undefined;
  let minDelay = clampInterval(body.minDelay, 1800, MAX_INTERVAL_SEC, 1800);
  let maxDelay = clampInterval(body.maxDelay, minDelay, MAX_INTERVAL_SEC, Math.max(minDelay + 900, 3600));
  if (maxDelay < minDelay) maxDelay = minDelay + 600;
  return {
    ok: true,
    config: {
      token,
      channelId,
      messages,
      interval,
      humanize: true,
      minDelay,
      maxDelay,
      deleteAfterSend: false,
      ...(guildId ? { guildId } : {}),
      ...(label ? { label } : {}),
    },
  };
}

export function validateDiscordAutoreplyBody(body: Record<string, unknown>):
  | { ok: true; config: DiscordAutoreplyBody }
  | { ok: false; error: string } {
  const token = parseToken(body.token);
  if (!token) {
    return {
      ok: false,
      error: !String(body.token ?? "").trim()
        ? "token required"
        : `token too long (max ${MAX_TOKEN_LEN})`,
    };
  }
  const messages = normalizeMessages(body.messages);
  if (!messages) return { ok: false, error: "At least one non-empty message required" };
  const guildId =
    body.guildId != null ? String(body.guildId).trim().slice(0, MAX_CHANNEL_ID_LEN) : undefined;
  const channelId =
    body.channelId != null
      ? String(body.channelId).trim().slice(0, MAX_CHANNEL_ID_LEN)
      : undefined;
  const label = body.label != null ? String(body.label).trim().slice(0, 64) : undefined;
  const matchMode = body.matchMode != null ? String(body.matchMode).trim().slice(0, 32) : undefined;
  const cooldownSec =
    body.cooldownSec != null
      ? clampInterval(body.cooldownSec, 0, MAX_INTERVAL_SEC, 0)
      : undefined;
  let minDelay = clampInterval(body.minDelay, 40, MAX_INTERVAL_SEC, 60);
  let maxDelay = clampInterval(body.maxDelay, minDelay, MAX_INTERVAL_SEC, Math.max(minDelay + 40, 180));
  if (maxDelay < minDelay) maxDelay = minDelay + 20;
  return {
    ok: true,
    config: {
      token,
      messages,
      minDelay,
      maxDelay,
      typing: false,
      autoAcceptFriends: asBool(body.autoAcceptFriends, false),
      ...(guildId ? { guildId } : {}),
      ...(channelId ? { channelId } : {}),
      ...(label ? { label } : {}),
      ...(matchMode ? { matchMode } : {}),
      ...(cooldownSec != null ? { cooldownSec } : {}),
    },
  };
}

/** Parse `host`, `host:port`, or `https://host/…` into host + port (default 25565). */
export function parseMcAddress(raw: string): { host: string; port: number } {
  let s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .trim();
  // host:port (IPv4 / hostname only — not bare IPv6)
  const m = s.match(/^([^:\[\]]+):(\d{1,5})$/);
  if (m) {
    const p = Number(m[2]);
    if (Number.isFinite(p) && p >= 1 && p <= 65535) {
      return { host: m[1].slice(0, MAX_HOST_LEN), port: Math.floor(p) };
    }
  }
  s = s.replace(/^\[|\]$/g, "").slice(0, MAX_HOST_LEN);
  return { host: s, port: 25565 };
}

export function validateMcLaunchFields(body: {
  serverHost?: unknown;
  serverPort?: unknown;
  messages?: unknown;
  interval?: unknown;
  autoReply?: unknown;
  autoReplyMessages?: unknown;
  autoReplyCmd?: unknown;
  autoReplyCooldownSec?: unknown;
}):
  | {
      ok: true;
      serverHost: string;
      serverPort: number;
      messages: string[];
      interval: number;
      autoReply: boolean;
      autoReplyMessages?: string[];
      autoReplyCmd: "r" | "reply";
      autoReplyCooldownSec: number;
    }
  | {
      ok: false;
      error: string;
    } {
  const parsed = parseMcAddress(String(body.serverHost ?? ""));
  const serverHost = parsed.host;
  if (!serverHost || /[\s<>]/.test(serverHost)) {
    return { ok: false, error: "Invalid serverHost" };
  }
  if (PRIVATE_HOST_RE.test(serverHost)) {
    return { ok: false, error: "private/reserved hosts not allowed" };
  }
  // Port is always default 25565 unless host was pasted as host:port; body.serverPort ignored (no port UI).
  const serverPort = parsed.port;
  const messages = normalizeMessages(body.messages);
  if (!messages) return { ok: false, error: "At least one non-empty message required" };
  const interval = clampInterval(body.interval, MIN_MC_INTERVAL_SEC, MAX_INTERVAL_SEC, 30);
  const autoReply = body.autoReply === true || body.autoReply === "true" || body.autoReply === 1;
  const autoReplyMessages = normalizeMessages(body.autoReplyMessages) || undefined;
  const cmdRaw = String(body.autoReplyCmd ?? "r")
    .trim()
    .toLowerCase();
  const autoReplyCmd: "r" | "reply" = cmdRaw === "reply" ? "reply" : "r";
  const cool = Number(body.autoReplyCooldownSec);
  const autoReplyCooldownSec = Number.isFinite(cool)
    ? Math.max(3, Math.min(120, Math.floor(cool)))
    : 8;
  return {
    ok: true,
    serverHost,
    serverPort,
    messages,
    interval,
    autoReply,
    ...(autoReplyMessages ? { autoReplyMessages } : {}),
    autoReplyCmd,
    autoReplyCooldownSec,
  };
}

export const MAX_CONCURRENT_DISCORD_JOBS = 3;
export const MAX_CONCURRENT_DISCORD_SPAM = 3;
export const MAX_CONCURRENT_DISCORD_AUTOREPLY = 3;
