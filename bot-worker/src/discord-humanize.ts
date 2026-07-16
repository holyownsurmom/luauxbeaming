/** Shared anti-ban helpers for Discord user-token jobs (v6). */

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
  " 💀",
  " 😭",
  " 🔥",
];

const EMOJI_NOISE = ["", " 💀", " 😭", " 🔥", " 👀", " 💯", " 🤡", " 🙏", " 😂"];

/** Multi-pass human-like message mutation */
export function variateMessage(msg: string): string {
  let result = msg.trim();
  if (!result) return msg;

  // Double-char typo
  if (Math.random() < 0.2 && result.length > 8) {
    const idx = randomBetween(1, result.length - 2);
    const ch = result[idx];
    if (ch && /[a-z]/i.test(ch)) {
      result = result.slice(0, idx) + ch + ch + result.slice(idx + 1);
    }
  }
  // Missing space / double space
  if (Math.random() < 0.16) {
    result = result.replace(/\s+/g, () => (Math.random() < 0.28 ? "  " : " "));
  }
  // Random word lowercase
  if (Math.random() < 0.1) {
    const words = result.split(" ");
    if (words.length > 1) {
      const i = randomBetween(0, words.length - 1);
      if (words[i].length > 2) words[i] = words[i].toLowerCase();
      result = words.join(" ");
    }
  }
  // First letter lowercase
  if (Math.random() < 0.1 && result.length > 3) {
    result = result.charAt(0).toLowerCase() + result.slice(1);
  }
  // Trailing suffix / emoji
  if (Math.random() < 0.38) result += pickRandom(SUFFIXES);
  else if (Math.random() < 0.12) result += pickRandom(EMOJI_NOISE);

  // Rare mid-sentence ellipsis stretch
  if (Math.random() < 0.06 && result.includes(" ")) {
    result = result.replace(/\s/, Math.random() < 0.5 ? " ... " : " ");
  }

  return result || msg;
}

const CHROME_BUILDS = [
  "131.0.6778.109",
  "132.0.6834.83",
  "133.0.6943.98",
  "134.0.6998.88",
  "135.0.7049.95",
  "136.0.7103.93",
];

const CLIENT_BUILDS = [352000, 354000, 356000, 358000, 360000, 362000, 364000];

const LOCALES = ["en-US", "en-GB", "en-US", "en-US"];

export function browserHeaders(token: string, referer?: string): Record<string, string> {
  const chromeBuild = pickRandom(CHROME_BUILDS);
  const locale = pickRandom(LOCALES);
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBuild} Safari/537.36`;
  const superProps = Buffer.from(
    JSON.stringify({
      os: "Windows",
      browser: "Chrome",
      device: "",
      system_locale: locale,
      browser_user_agent: userAgent,
      browser_version: chromeBuild,
      os_version: pickRandom(["10", "10", "11"]),
      referrer: "",
      referring_domain: "",
      referrer_current: "",
      referring_domain_current: "",
      release_channel: "stable",
      client_build_number: pickRandom(CLIENT_BUILDS),
      client_event_source: null,
    }),
  ).toString("base64");

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
}

/** Local hour 0–23 — quiet hours (sleep) window */
export function isQuietHours(now = new Date()): boolean {
  const h = now.getHours();
  // Default sleep window ~1am–7am local (randomized edges)
  const start = 1;
  const end = 7;
  return h >= start && h < end;
}

/** Extra delay if in quiet hours (long offline simulation) */
export function quietHoursExtraMs(): number {
  if (!isQuietHours()) return 0;
  // Stay "asleep" 20–90 min when quiet
  return randomBetween(20 * 60_000, 90 * 60_000);
}

export function typingDurationMs(msg: string, min = 2000, max = 14000): number {
  const cpm = pickRandom([38, 48, 55, 62, 72, 85, 95]);
  const chars = msg.replace(/\s+/g, " ").length;
  const base = (chars / cpm) * 60 * 1000;
  return Math.max(min, Math.min(base + randomBetween(-600, 1800), max));
}

export type SendResult =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number; body: string; rateLimited?: boolean; captcha?: boolean }
  | null;

export async function sendWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2,
  signal?: AbortSignal,
): Promise<SendResult> {
  let last429: { status: number; body: string } | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) return null;
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const body = await res.text();
        last429 = { status: 429, body };
        let retryAfter = 45_000;
        try {
          const parsed = JSON.parse(body);
          if (parsed.retry_after) retryAfter = parsed.retry_after * 1000 + randomBetween(8_000, 25_000);
        } catch {
          /* default */
        }
        await sleep(retryAfter, signal);
        continue;
      }
      const body = await res.text();
      if (res.ok) return { ok: true, status: res.status, body };
      const captcha = res.status === 400 && /captcha/i.test(body);
      return { ok: false, status: res.status, body, captcha };
    } catch {
      if (attempt === maxRetries) return null;
      await sleep(randomBetween(1500, 4000) * (attempt + 1), signal);
    }
  }
  if (last429) return { ok: false, status: 429, body: last429.body, rateLimited: true };
  return null;
}

/** Circadian slowdown multiplier (night slower) */
export function circadianMultiplier(now = new Date()): number {
  const h = now.getHours();
  if (h >= 1 && h < 7) return randomBetween(18, 35) / 10; // 1.8–3.5x
  if (h >= 7 && h < 10) return randomBetween(12, 18) / 10;
  if (h >= 22 || h < 1) return randomBetween(14, 22) / 10;
  return randomBetween(10, 13) / 10;
}
