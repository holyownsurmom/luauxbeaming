import { createLogger, updateJob } from "./api.js";
import { runDiscordAutoReplyBot } from "./autoreply.js";

export type DiscordJobConfig = {
  token: string;
  guildId: string;
  channelId: string;
  messages: string[];
  interval: number;
  deleteAfterSend: boolean;
  humanize: boolean;
  minDelay: number;
  maxDelay: number;
};

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const SUFFIXES = ["", " ", "  ", ".", "..", "...", "!", "?", " ~", " :)", " :D", " lol", " fr", " ngl"];

function variateMessage(msg: string): string {
  let result = msg.trim();
  // Light typo / spacing noise
  if (Math.random() < 0.22 && result.length > 8) {
    const idx = randomBetween(1, result.length - 2);
    const ch = result[idx];
    if (ch && /[a-z]/i.test(ch)) {
      result = result.slice(0, idx) + ch + ch + result.slice(idx + 1);
    }
  }
  if (Math.random() < 0.18) {
    result = result.replace(/\s+/g, () => (Math.random() < 0.25 ? "  " : " "));
  }
  if (Math.random() < 0.35) {
    result += pickRandom(SUFFIXES);
  }
  if (Math.random() < 0.08 && result.length > 4) {
    result = result.charAt(0).toLowerCase() + result.slice(1);
  }
  if (Math.random() < 0.06) {
    const words = result.split(" ");
    if (words.length > 1) {
      const i = randomBetween(0, words.length - 1);
      if (words[i].length > 2) words[i] = words[i].toLowerCase();
      result = words.join(" ");
    }
  }
  // Never send exact same string twice in a row if possible
  return result || msg;
}

const TYPING_SPEEDS = [40, 50, 60, 70, 80, 90, 100];

function typingDuration(msg: string): number {
  const cpm = pickRandom(TYPING_SPEEDS);
  const chars = msg.replace(/\s+/g, " ").length;
  const base = (chars / cpm) * 60 * 1000;
  return Math.max(2000, Math.min(base + randomBetween(-500, 1500), 14000));
}

type SendResult =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number; body: string; rateLimited?: boolean }
  | null;

async function sendWithRetry(
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
        let retryAfter = 30000;
        try {
          const parsed = JSON.parse(body);
          if (parsed.retry_after) retryAfter = parsed.retry_after * 1000 + 5000;
        } catch {
          /* parse failure, use default */
        }
        await sleep(retryAfter, signal);
        continue;
      }
      const body = await res.text();
      if (res.ok) return { ok: true, status: res.status, body };
      return { ok: false, status: res.status, body };
    } catch {
      if (attempt === maxRetries) return null;
      await sleep(2000 * (attempt + 1), signal);
    }
  }
  if (last429) return { ok: false, status: 429, body: last429.body, rateLimited: true };
  return null;
}

export async function runDiscordBot(
  jobId: string,
  discordId: string,
  config: DiscordJobConfig & { subType?: string },
  abortSignal: AbortSignal,
): Promise<void> {
  if (config.subType === "autoreply") {
    return runDiscordAutoReplyBot(
      jobId,
      discordId,
      config as unknown as import("./autoreply.js").AutoReplyJobConfig,
      abortSignal,
    );
  }

  const log = createLogger(jobId, discordId);

  if (!config.token) {
    await log("error", "Missing token");
    await updateJob(jobId, "error", "Missing token");
    return;
  }
  if (!config.channelId) {
    await log("error", "Missing channelId");
    await updateJob(jobId, "error", "Missing channelId");
    return;
  }
  if (!config.messages?.length) {
    await log("error", "No messages configured");
    await updateJob(jobId, "error", "No messages configured");
    return;
  }

  // ROOT CAUSE OF BANS: Discord USER TOKENS (self-bots) violate ToS.
  // Anti-ban v4: longer warmup, browser-like headers, min 15–45 min gaps, session caps.
  // Defensive defaults — never allow NaN timers from missing config fields
  const minDelaySec = (() => {
    const n = Number(config.minDelay);
    if (!Number.isFinite(n) || n < 900) return 900;
    return Math.min(86_400, Math.floor(n));
  })();
  const maxDelaySec = (() => {
    const n = Number(config.maxDelay);
    const floor = minDelaySec + 300;
    if (!Number.isFinite(n) || n < floor) return Math.max(floor, 1800);
    return Math.min(86_400, Math.floor(n));
  })();
  const intervalSec = (() => {
    const n = Number(config.interval);
    if (!Number.isFinite(n) || n < 300) return 300;
    return Math.min(86_400, Math.floor(n));
  })();
  const humanize = config.humanize !== false;
  config.minDelay = minDelaySec;
  config.maxDelay = maxDelaySec;
  config.interval = intervalSec;
  config.humanize = humanize;

  const startedAt = Date.now();
  await log("system", "Initializing Discord user-token client (anti-ban mode v4)...");
  await updateJob(jobId, "running");

  let stopped = false;
  let terminalWritten = false;
  const markError = async (msg: string) => {
    if (terminalWritten) return;
    terminalWritten = true;
    await updateJob(jobId, "error", msg);
    stopped = true;
  };
  const markCompleted = async () => {
    if (terminalWritten) return;
    terminalWritten = true;
    await updateJob(jobId, "completed");
    stopped = true;
  };
  const SESSION_MSG_CAP = randomBetween(5, 12); // short sessions reduce ban heat
  const chromeBuild = pickRandom(["131.0.0.0", "132.0.0.0", "133.0.0.0", "134.0.0.0"]);
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBuild} Safari/537.36`;
  const superProps = Buffer.from(
    JSON.stringify({
      os: "Windows",
      browser: "Chrome",
      device: "",
      system_locale: "en-US",
      browser_user_agent: userAgent,
      browser_version: chromeBuild,
      os_version: "10",
      referrer: "",
      referring_domain: "",
      referrer_current: "",
      referring_domain_current: "",
      release_channel: "stable",
      client_build_number: pickRandom([350000, 352000, 354000, 356000]),
      client_event_source: null,
    }),
  ).toString("base64");
  const apiHeaders: Record<string, string> = {
    Authorization: config.token,
    "Content-Type": "application/json",
    "User-Agent": userAgent,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://discord.com",
    Referer: `https://discord.com/channels/${config.guildId || "@me"}/${config.channelId}`,
    "X-Discord-Locale": "en-US",
    "X-Discord-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
    "X-Super-Properties": superProps,
    "X-Debug-Options": "bugReporterEnabled",
  };

  abortSignal.addEventListener(
    "abort",
    () => {
      stopped = true;
      log("system", "Stop signal received, shutting down...").catch(() => {});
    },
    { once: true },
  );

  // ANTI-BAN v5: no /users/@me fingerprint; long idle warmup; short sessions
  const warmupMs = randomBetween(900_000, 2_400_000); // 15–40 min
  await log(
    "system",
    `Warmup: ${(warmupMs / 60000).toFixed(1)}min idle before first message (anti-ban v5)...`,
  );
  await sleep(warmupMs, abortSignal);
  if (stopped || abortSignal.aborted) return;

  await log(
    "system",
    `Message loop started | humanize=${config.humanize} | session cap ~${SESSION_MSG_CAP} msgs | anti-ban v5`,
  );

  let sentCount = 0;
  let failCount = 0;
  let consecutiveRateLimits = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let messageOrder = shuffleArray(config.messages.map((_, i) => i));
  let shufflePosition = 0;
  let msgsSinceMediumBreak = 0;
  let msgsSinceLongAfk = 0;
  let mediumBreakEvery = randomBetween(2, 4);
  let longAfkEvery = randomBetween(5, 9);
  let lastSentText = "";

  abortSignal.addEventListener(
    "abort",
    () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = null;
    },
    { once: true },
  );

  // WARNING: Using user tokens (self-bots) to send messages violates Discord ToS.
  // To minimize detection, we send the absolute minimum API calls.
  // NO typing indicators, NO presence updates, NO edits, NO extra requests for spam.
  const sendTyping = async (_channelId: string, _token: string): Promise<void> => {
    // Disabled for spam to reduce ban risk. Do not enable.
    return;
  };

  const runtimeMinutes = () => (Date.now() - startedAt) / 60000;

  const calculateCooldown = (totalSent: number, rt: number): number => {
    // Frequent "reading" / tab-away pauses
    if (Math.random() < 0.35) {
      return randomBetween(300, 900) * 1000;
    }
    // Counter-based medium break (not broken % random)
    if (totalSent > 0 && msgsSinceMediumBreak >= mediumBreakEvery) {
      msgsSinceMediumBreak = 0;
      mediumBreakEvery = randomBetween(2, 4);
      return randomBetween(900, 2400) * 1000;
    }
    // Occasional medium pause
    if (Math.random() < 0.28) {
      return randomBetween(360, 900) * 1000;
    }
    // After 15 min, longer breaks more often
    if (rt > 15 && Math.random() < 0.4) {
      return randomBetween(900, 2700) * 1000;
    }
    // Counter-based long AFK
    if (sentCount > 0 && msgsSinceLongAfk >= longAfkEvery) {
      msgsSinceLongAfk = 0;
      longAfkEvery = randomBetween(5, 9);
      return randomBetween(1800, 4800) * 1000;
    }
    return 0;
  };

  const calculateDelay = (baseMin: number, baseMax: number, sendCount: number, rt: number): number => {
    // Always enforce slow floors even if humanize is off in config
    let min = Math.max(baseMin, 1200); // 20 min floor
    let max = Math.max(baseMax, min + 600);
    // First messages extremely slow
    if (sendCount < 2) {
      min = Math.max(min, 1800);
      max = Math.max(max, 3600);
    } else if (sendCount < 5) {
      min = Math.max(min, 1500);
      max = Math.max(max, 2700);
    }
    // Slow down hard over time
    const slowdown = 1 + Math.min(rt / 30, 6);
    min *= slowdown;
    max *= slowdown;
    const delay = randomBetween(min * 1000, max * 1000);
    const jitter = randomBetween(-90_000, 240_000);
    return Math.max(min * 1000, delay + jitter);
  };

  const sendNext = async () => {
    if (stopped) return;

    const rt = runtimeMinutes();

    const cooldown = calculateCooldown(sentCount, rt);
    if (cooldown > 0) {
      await log(
        "system",
        `Cooldown pause: ${(cooldown / 1000).toFixed(0)}s (sent ${sentCount} msgs, runtime ${rt.toFixed(0)}min)`,
      );
      await sleep(cooldown, abortSignal);
      if (stopped) return;
    }

    if (shufflePosition >= messageOrder.length) {
      messageOrder = shuffleArray(config.messages.map((_, i) => i));
      shufflePosition = 0;
    }
    const baseMsg = config.messages[messageOrder[shufflePosition] % config.messages.length];
    shufflePosition++;
    let msg = config.humanize ? variateMessage(baseMsg) : variateMessage(baseMsg);
    // Avoid identical consecutive sends
    if (msg === lastSentText && config.messages.length > 1) {
      msg = variateMessage(baseMsg) + pickRandom([" ", ".", " ~"]);
    }

    // Human-like think + type delay (no typing API — that fingerprints selfbots)
    const typingTime = randomBetween(8000, 28000) + Math.min(msg.length * randomBetween(50, 110), 18000);
    await sleep(typingTime, abortSignal);
    if (stopped) return;

    // Session cap: end job after few messages to avoid spam pattern
    if (sentCount >= SESSION_MSG_CAP) {
      await log(
        "system",
        `Session message cap reached (${SESSION_MSG_CAP}). Stopping to reduce ban risk. Wait hours before restarting on this account.`,
      );
      await markCompleted();
      return;
    }

    try {
      const res = await sendWithRetry(
        `https://discord.com/api/v9/channels/${config.channelId}/messages`,
        {
          method: "POST",
          headers: apiHeaders,
          body: JSON.stringify({
            content: msg,
            nonce: String(Date.now() + randomBetween(1000, 9999)),
            tts: false,
            flags: 0,
          }),
        },
        2,
        abortSignal,
      );

      if (!res) {
        failCount++;
        await log("error", "Send failed: network error after retries");
      } else if (res.ok) {
        sentCount++;
        msgsSinceMediumBreak++;
        msgsSinceLongAfk++;
        lastSentText = msg;
        consecutiveRateLimits = 0;
        failCount = Math.max(0, failCount - 1);
        await log("bot", `> ${msg}`);

        // Never auto-delete — delete spam is a huge ban signal
        if (config.deleteAfterSend) {
          await log("warn", "deleteAfterSend ignored (anti-ban v4: deletes fingerprint accounts)");
        }
      } else {
        failCount++;
        await log("error", `Send failed (${res.status}): ${res.body.slice(0, 300)}`);

        if (res.status === 429 || res.rateLimited) {
          consecutiveRateLimits++;
          failCount = Math.max(0, failCount - 3);

          let retryAfter = (90 + consecutiveRateLimits * 60 + randomBetween(0, 60)) * 1000;
          try {
            const parsed = JSON.parse(res.body);
            if (parsed.retry_after) {
              retryAfter = Math.ceil(parsed.retry_after * 1000) + randomBetween(30_000, 90_000);
            }
          } catch {
            /* parse failure, use computed value */
          }

          await log(
            "warn",
            `Rate limited (#${consecutiveRateLimits}). Cool-down ${(retryAfter / 1000).toFixed(0)}s`,
          );
          await sleep(retryAfter, abortSignal);
          if (consecutiveRateLimits >= 2) {
            const longPause = randomBetween(1800, 3600) * 1000;
            await log(
              "warn",
              `Repeated rate limits. Extra cool-down: ${(longPause / 1000).toFixed(0)}s`,
            );
            await sleep(longPause, abortSignal);
            consecutiveRateLimits = 0;
          }
        }

        if (res.status === 401 || res.status === 403) {
          await log("error", "Token revoked or access denied. Stopping.");
          await markError("Token invalid or banned");
          return;
        }

        if (failCount > 5) {
          await log("error", "Too many failures, stopping to protect account");
          await markError("Too many send failures");
          return;
        }
      }
    } catch (e) {
      failCount++;
      await log("error", `Send error: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (stopped) return;

    // Always use slow humanized delays — fixed interval is a ban magnet
    const runtime = calculateDelay(
      Math.max(minDelaySec, 1200),
      Math.max(maxDelaySec, minDelaySec + 600),
      sentCount,
      rt,
    );

    await log("info", `Next message in ${(runtime / 1000).toFixed(1)}s | runtime ${rt.toFixed(0)}min | sent ${sentCount}`);

    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      sendNext();
    }, runtime);
  };

  sendNext();

  const runtimeLog = setInterval(() => {
    if (!stopped) {
      const botMinutes = Math.floor((Date.now() - startedAt) / 60000);
      log(
        "info",
        `Runtime: ${botMinutes}m | Sent: ${sentCount} | Failed: ${failCount} | Rate-limits: ${consecutiveRateLimits}`,
      ).catch(() => {});
    }
  }, 120000);

  abortSignal.addEventListener("abort", () => clearInterval(runtimeLog), { once: true });

  return new Promise((resolve) => {
    const checkAbort = setInterval(() => {
      if (abortSignal.aborted || stopped) {
        clearInterval(checkAbort);
        if (pendingTimer) clearTimeout(pendingTimer);
        clearInterval(runtimeLog);
        resolve();
      }
    }, 1000);
  });
}
