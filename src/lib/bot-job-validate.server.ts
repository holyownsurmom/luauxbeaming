/** Shared validation for bot start API bodies (MC + Discord plugins). */

const MAX_MESSAGES = 50;
const MAX_MESSAGE_LEN = 2000;
const MAX_TOKEN_LEN = 512;
const MAX_CHANNEL_ID_LEN = 32;
const MAX_HOST_LEN = 253;
const MIN_DISCORD_INTERVAL_SEC = 300;
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
  let minDelay = clampInterval(body.minDelay, 900, MAX_INTERVAL_SEC, 900);
  let maxDelay = clampInterval(body.maxDelay, minDelay, MAX_INTERVAL_SEC, Math.max(minDelay + 300, 1800));
  if (maxDelay < minDelay) maxDelay = minDelay + 300;
  return {
    ok: true,
    config: {
      token,
      channelId,
      messages,
      interval,
      humanize: asBool(body.humanize, true),
      minDelay,
      maxDelay,
      deleteAfterSend: asBool(body.deleteAfterSend, false),
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
  let minDelay = clampInterval(body.minDelay, 10, MAX_INTERVAL_SEC, 15);
  let maxDelay = clampInterval(body.maxDelay, minDelay, MAX_INTERVAL_SEC, Math.max(minDelay + 5, 45));
  if (maxDelay < minDelay) maxDelay = minDelay + 5;
  return {
    ok: true,
    config: {
      token,
      messages,
      minDelay,
      maxDelay,
      typing: asBool(body.typing, true),
      autoAcceptFriends: asBool(body.autoAcceptFriends, false),
      ...(guildId ? { guildId } : {}),
      ...(channelId ? { channelId } : {}),
      ...(label ? { label } : {}),
      ...(matchMode ? { matchMode } : {}),
      ...(cooldownSec != null ? { cooldownSec } : {}),
    },
  };
}

export function validateMcLaunchFields(body: {
  serverHost?: unknown;
  serverPort?: unknown;
  messages?: unknown;
  interval?: unknown;
}): { ok: true; serverHost: string; serverPort: number; messages: string[]; interval: number } | {
  ok: false;
  error: string;
} {
  const serverHost = String(body.serverHost ?? "")
    .trim()
    .slice(0, MAX_HOST_LEN);
  if (!serverHost || /[\s<>]/.test(serverHost)) {
    return { ok: false, error: "Invalid serverHost" };
  }
  if (PRIVATE_HOST_RE.test(serverHost)) {
    return { ok: false, error: "private/reserved hosts not allowed" };
  }
  const port = Number(body.serverPort);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return { ok: false, error: "serverPort must be 1–65535" };
  }
  const messages = normalizeMessages(body.messages);
  if (!messages) return { ok: false, error: "At least one non-empty message required" };
  const interval = clampInterval(body.interval, MIN_MC_INTERVAL_SEC, MAX_INTERVAL_SEC, 30);
  return { ok: true, serverHost, serverPort: Math.floor(port), messages, interval };
}

export const MAX_CONCURRENT_DISCORD_JOBS = 3;
export const MAX_CONCURRENT_DISCORD_SPAM = 3;
export const MAX_CONCURRENT_DISCORD_AUTOREPLY = 3;
