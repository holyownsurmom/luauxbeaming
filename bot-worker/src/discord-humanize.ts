/** Shared anti-ban helpers for Discord user-token jobs (v7). */

export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const SUFFIXES = [
  "",
  " ",
  "  ",
  ".",
  "..",
  "...",
  "!",
  "?",
  " ~",
  " :)",
  " :D",
  " lol",
  " fr",
  " ngl",
  " haha",
  " tbh",
  " idk",
  " tho",
  " lowkey",
  " 💀",
  " 😭",
  " 🔥",
];

const EMOJI_NOISE = ["", " 💀", " 😭", " 🔥", " 👀", " 💯", " 🤡", " 🙏", " 😂", " ✨", " 🤝"];

const FILLERS = ["uh ", "um ", "like ", "bro ", "yo ", "ok ", "wait "];

/** Multi-pass human-like message mutation (v7 — more natural, less spammy) */
export function variateMessage(msg: string): string {
  let result = msg.trim();
  if (!result) return msg;

  // Rare leading filler
  if (Math.random() < 0.08 && result.length > 4) {
    result = pickRandom(FILLERS) + result.charAt(0).toLowerCase() + result.slice(1);
  }

  // Double-char typo (light)
  if (Math.random() < 0.18 && result.length > 8) {
    const idx = randomBetween(1, result.length - 2);
    const ch = result[idx];
    if (ch && /[a-z]/i.test(ch)) {
      result = result.slice(0, idx) + ch + ch + result.slice(idx + 1);
    }
  }

  // Drop a letter occasionally
  if (Math.random() < 0.1 && result.length > 10) {
    const idx = randomBetween(2, result.length - 2);
    if (/[a-z]/i.test(result[idx])) {
      result = result.slice(0, idx) + result.slice(idx + 1);
    }
  }

  // Spacing noise
  if (Math.random() < 0.14) {
    result = result.replace(/\s+/g, () => (Math.random() < 0.22 ? "  " : " "));
  }

  // Random word lowercase
  if (Math.random() < 0.12) {
    const words = result.split(" ");
    if (words.length > 1) {
      const i = randomBetween(0, words.length - 1);
      if (words[i].length > 2) words[i] = words[i].toLowerCase();
      result = words.join(" ");
    }
  }

  // First letter lowercase
  if (Math.random() < 0.14 && result.length > 3) {
    result = result.charAt(0).toLowerCase() + result.slice(1);
  }

  // Trailing suffix / emoji (avoid stacking too many)
  if (Math.random() < 0.34) result += pickRandom(SUFFIXES);
  else if (Math.random() < 0.1) result += pickRandom(EMOJI_NOISE);

  // Rare mid-sentence ellipsis
  if (Math.random() < 0.07 && result.includes(" ")) {
    result = result.replace(/\s/, Math.random() < 0.5 ? " ... " : " ");
  }

  // Soft length cap — huge walls of text look automated
  if (result.length > 280) result = result.slice(0, 277) + "...";

  return result || msg;
}

/** Rough uniqueness key so we don't re-send near-identical lines */
export function messageFingerprint(msg: string): string {
  return msg
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const CHROME_BUILDS = [
  "131.0.6778.109",
  "132.0.6834.83",
  "133.0.6943.98",
  "134.0.6998.88",
  "135.0.7049.95",
  "136.0.7103.93",
  "137.0.7151.69",
];

const CLIENT_BUILDS = [352000, 354000, 356000, 358000, 360000, 362000, 364000, 366000];

const LOCALES = ["en-US", "en-GB", "en-US", "en-US", "en-CA"];

/** Stable fingerprint for the whole job (do not regenerate per request) */
export function createSessionBrowser(): {
  headers: (token: string, referer?: string) => Record<string, string>;
  userAgent: string;
} {
  const chromeBuild = pickRandom(CHROME_BUILDS);
  const locale = pickRandom(LOCALES);
  const osVersion = pickRandom(["10", "10", "11"]);
  const clientBuild = pickRandom(CLIENT_BUILDS);
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBuild} Safari/537.36`;
  const superProps = Buffer.from(
    JSON.stringify({
      os: "Windows",
      browser: "Chrome",
      device: "",
      system_locale: locale,
      browser_user_agent: userAgent,
      browser_version: chromeBuild,
      os_version: osVersion,
      referrer: "",
      referring_domain: "",
      referrer_current: "",
      referring_domain_current: "",
      release_channel: "stable",
      client_build_number: clientBuild,
      client_event_source: null,
    }),
  ).toString("base64");

  return {
    userAgent,
    headers(token: string, referer?: string) {
      return {
        Authorization: token,
        "Content-Type": "application/json",
        "User-Agent": userAgent,
        Accept: "*/*",
        "Accept-Language": `${locale},${locale.split("-")[0]};q=0.9`,
        Origin: "https://discord.com",
        Referer: referer || "https://discord.com/channels/@me",
        "X-Discord-Locale": locale,
        "X-Discord-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
        "X-Super-Properties": superProps,
        "X-Debug-Options": "bugReporterEnabled",
      };
    },
  };
}

/** @deprecated prefer createSessionBrowser() for stable fingerprints */
export function browserHeaders(token: string, referer?: string): Record<string, string> {
  return createSessionBrowser().headers(token, referer);
}

/** Quiet hours with soft random edges (v7) */
export function isQuietHours(now = new Date()): boolean {
  const h = now.getHours() + now.getMinutes() / 60;
  // Core sleep ~0:30–7:30 local, soft edges
  const start = 0.5 + Math.random() * 0.8;
  const end = 7.0 + Math.random() * 0.9;
  return h >= start && h < end;
}

export function quietHoursExtraMs(): number {
  if (!isQuietHours()) return 0;
  // Stay "asleep" 25–110 min
  return randomBetween(25 * 60_000, 110 * 60_000);
}

export function typingDurationMs(msg: string, min = 2000, max = 14000): number {
  // Humans type ~35–90 CPM with pauses
  const cpm = pickRandom([35, 42, 48, 55, 62, 70, 82, 95]);
  const chars = msg.replace(/\s+/g, " ").length;
  const base = (chars / cpm) * 60 * 1000;
  // Think pause before typing
  const think = randomBetween(400, 2800);
  return Math.max(min, Math.min(base + think + randomBetween(-800, 2200), max));
}

export type SendResult =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number; body: string; rateLimited?: boolean; captcha?: boolean; global?: boolean }
  | null;

export async function sendWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2,
  signal?: AbortSignal,
): Promise<SendResult> {
  let last429: { status: number; body: string; global?: boolean } | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) return null;
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const body = await res.text();
        let retryAfter = 60_000;
        let global = false;
        try {
          const parsed = JSON.parse(body);
          if (parsed.retry_after) {
            retryAfter = parsed.retry_after * 1000 + randomBetween(12_000, 45_000);
          }
          if (parsed.global) global = true;
        } catch {
          /* default */
        }
        // Global RL → much longer cool-down
        if (global) retryAfter = Math.max(retryAfter, randomBetween(180_000, 420_000));
        last429 = { status: 429, body, global };
        await sleep(retryAfter, signal);
        continue;
      }
      const body = await res.text();
      if (res.ok) return { ok: true, status: res.status, body };
      const captcha = res.status === 400 && /captcha/i.test(body);
      return { ok: false, status: res.status, body, captcha };
    } catch {
      if (attempt === maxRetries) return null;
      await sleep(randomBetween(2000, 6000) * (attempt + 1), signal);
    }
  }
  if (last429) {
    return {
      ok: false,
      status: 429,
      body: last429.body,
      rateLimited: true,
      global: last429.global,
    };
  }
  return null;
}

/** Circadian slowdown multiplier (night slower) */
export function circadianMultiplier(now = new Date()): number {
  const h = now.getHours();
  if (h >= 1 && h < 7) return randomBetween(22, 42) / 10; // 2.2–4.2x
  if (h >= 7 && h < 10) return randomBetween(13, 20) / 10;
  if (h >= 22 || h < 1) return randomBetween(16, 26) / 10;
  // Lunch / work dips
  if (h >= 12 && h < 14) return randomBetween(12, 18) / 10;
  return randomBetween(10, 14) / 10;
}

/** Human-ish nonce (snowflake-ish random) */
export function humanNonce(): string {
  return String(Date.now() - randomBetween(0, 40) + randomBetween(1000, 999_999));
}

/**
 * Rolling window guard — true if over limit.
 * @param stamps recent action timestamps (mutated: prunes old)
 */
export function overRollingLimit(
  stamps: number[],
  windowMs: number,
  maxInWindow: number,
): boolean {
  const now = Date.now();
  const kept = stamps.filter((t) => now - t < windowMs);
  stamps.length = 0;
  stamps.push(...kept);
  return kept.length >= maxInWindow;
}
