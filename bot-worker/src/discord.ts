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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

const SUFFIXES = ["", " ", "  ", ".", "..", "...", "!", "!!", "?", " ~", " :)", " :D"];

function variateMessage(msg: string): string {
  let result = msg;
  if (Math.random() < 0.3) {
    result += pickRandom(SUFFIXES);
  }
  if (Math.random() < 0.08 && result.length > 10) {
    const idx = randomBetween(1, result.length - 2);
    const ch = result[idx];
    if (ch) {
      result = result.slice(0, idx) + ch + ch + result.slice(idx + 1);
    }
  }
  if (Math.random() < 0.05) {
    const words = result.split(" ");
    if (words.length > 1) {
      const i = randomBetween(0, words.length - 1);
      words[i] = words[i].toUpperCase();
      result = words.join(" ");
    }
  }
  return result;
}

const TYPING_SPEEDS = [40, 50, 60, 70, 80, 90, 100];

function typingDuration(msg: string): number {
  const cpm = pickRandom(TYPING_SPEEDS);
  const chars = msg.replace(/\s+/g, " ").length;
  const base = (chars / cpm) * 60 * 1000;
  return Math.max(2000, Math.min(base + randomBetween(-500, 1500), 14000));
}

async function sendWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2,
): Promise<Response | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const body = await res.text();
        let retryAfter = 30000;
        try {
          const parsed = JSON.parse(body);
          if (parsed.retry_after) retryAfter = parsed.retry_after * 1000 + 5000;
        } catch {
          /* parse failure, use default */
        }
        await sleep(retryAfter);
        continue;
      }
      return res;
    } catch {
      if (attempt === maxRetries) return null;
      await sleep(2000 * (attempt + 1));
    }
  }
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
  if (config.minDelay < 900) {
    config.minDelay = 900;
    config.maxDelay = Math.max(config.maxDelay, 1800);
  }

  const startedAt = Date.now();
  await log("system", "Initializing Discord user-token client (anti-ban mode v4)...");
  await updateJob(jobId, "running");

  let stopped = false;
  const SESSION_MSG_CAP = randomBetween(8, 18); // stop session after this many msgs
  const chromeBuild = pickRandom(["131.0.0.0", "132.0.0.0", "133.0.0.0", "134.0.0.0"]);
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBuild} Safari/537.36`;
  const apiHeaders: Record<string, string> = {
    Authorization: config.token,
    "Content-Type": "application/json",
    "User-Agent": userAgent,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://discord.com",
    Referer: "https://discord.com/channels/@me",
    "X-Discord-Locale": "en-US",
    "X-Discord-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
  };

  abortSignal.addEventListener(
    "abort",
    () => {
      stopped = true;
      log("system", "Stop signal received, shutting down...").catch(() => {});
    },
    { once: true },
  );

  // ANTI-BAN v4: no /users/@me fingerprint; long idle warmup
  const warmupMs = randomBetween(600_000, 1_800_000); // 10–30 min
  await log(
    "system",
    `Warmup: ${(warmupMs / 60000).toFixed(1)}min idle before first message (anti-ban v4)...`,
  );
  await sleep(warmupMs);
  if (stopped) return;

  await log(
    "system",
    `Message loop started | humanize=${config.humanize} | session cap ~${SESSION_MSG_CAP} msgs | anti-ban v4`,
  );

  let sentCount = 0;
  let failCount = 0;
  let consecutiveRateLimits = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let messageOrder = shuffleArray(config.messages.map((_, i) => i));
  let shufflePosition = 0;

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
    if (Math.random() < 0.28) {
      return randomBetween(180, 720) * 1000;
    }
    // Every 2–5 messages, longer break
    if (totalSent > 0 && totalSent % randomBetween(2, 5) === 0) {
      return randomBetween(600, 1800) * 1000;
    }
    // Occasional medium pause
    if (Math.random() < 0.3) {
      return randomBetween(240, 600) * 1000;
    }
    // After 20 min, longer breaks more often
    if (rt > 20 && Math.random() < 0.35) {
      return randomBetween(600, 2400) * 1000;
    }
    // Every 6–12 messages, long AFK
    if (sentCount > 0 && sentCount % randomBetween(6, 12) === 0) {
      return randomBetween(1200, 3600) * 1000;
    }
    return 0;
  };

  const calculateDelay = (baseMin: number, baseMax: number, sendCount: number, rt: number): number => {
    let min = Math.max(baseMin, 900);
    let max = Math.max(baseMax, min + 300);
    // First messages extremely slow
    if (sendCount < 2) {
      min = Math.max(min, 1200);
      max = Math.max(max, 2400);
    } else if (sendCount < 5) {
      min = Math.max(min, 1000);
      max = Math.max(max, 1800);
    }
    // Slow down hard over time
    const slowdown = 1 + Math.min(rt / 40, 5);
    min *= slowdown;
    max *= slowdown;
    const delay = randomBetween(min * 1000, max * 1000);
    const jitter = randomBetween(-60_000, 180_000);
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
      await sleep(cooldown);
      if (stopped) return;
    }

    if (sentCount > 0 && sentCount % randomBetween(20, 40) === 0) {
      const longPause = randomBetween(1200, 3600) * 1000;
      await log("system", `Long AFK pause: ${(longPause / 1000).toFixed(0)}s (simulating offline)`);
      await sleep(longPause);
      if (stopped) return;
    }

    if (shufflePosition >= messageOrder.length) {
      messageOrder = shuffleArray(config.messages.map((_, i) => i));
      shufflePosition = 0;
    }
    const baseMsg = config.messages[messageOrder[shufflePosition] % config.messages.length];
    shufflePosition++;
    const msg = config.humanize ? variateMessage(baseMsg) : baseMsg;

    // Human-like think + type delay (no typing API — that fingerprints selfbots)
    const typingTime = randomBetween(5000, 18000) + Math.min(msg.length * randomBetween(40, 90), 12000);
    await sleep(typingTime);
    if (stopped) return;

    // Session cap: end job after few messages to avoid spam pattern
    if (sentCount >= SESSION_MSG_CAP) {
      await log(
        "system",
        `Session message cap reached (${SESSION_MSG_CAP}). Stopping to reduce ban risk. Restart later for another short session.`,
      );
      await updateJob(jobId, "completed");
      stopped = true;
      return;
    }

    try {
      const res = await sendWithRetry(
        `https://discord.com/api/v9/channels/${config.channelId}/messages`,
        {
          method: "POST",
          headers: apiHeaders,
          body: JSON.stringify({ content: msg }),
        },
      );

      if (!res) {
        failCount++;
        await log("error", "Send failed: network error after retries");
      } else if (res.ok) {
        sentCount++;
        consecutiveRateLimits = 0;
        failCount = Math.max(0, failCount - 1);
        await log("bot", `> ${msg}`);

        // Never auto-delete — delete spam is a huge ban signal
        if (config.deleteAfterSend) {
          await log("warn", "deleteAfterSend ignored (anti-ban v4: deletes fingerprint accounts)");
        }
      } else {
        failCount++;
        const body = await res.text();
        await log("error", `Send failed (${res.status}): ${body}`);

        if (res.status === 429) {
          consecutiveRateLimits++;
          failCount = Math.max(0, failCount - 3);

          let retryAfter = (90 + consecutiveRateLimits * 60 + randomBetween(0, 60)) * 1000;
          try {
            const parsed = JSON.parse(body);
            if (parsed.retry_after) {
              retryAfter = Math.ceil(parsed.retry_after * 1000) + randomBetween(30_000, 90_000);
            }
          } catch {
            /* parse failure, use computed value */
          }

          await log(
            "warn",
            `Rate limited (#${consecutiveRateLimits}). Waiting ${(retryAfter / 1000).toFixed(0)}s`,
          );
          await sleep(retryAfter);

          if (consecutiveRateLimits >= 1) {
            const longPause = randomBetween(1800, 3600) * 1000;
            await log(
              "warn",
              `Rate limit hit. Cool-down: ${(longPause / 1000).toFixed(0)}s then continue carefully`,
            );
            await sleep(longPause);
            consecutiveRateLimits = 0;
          }
        }

        if (res.status === 401 || res.status === 403) {
          await log("error", "Token revoked or access denied. Stopping.");
          await updateJob(jobId, "error", "Token invalid or banned");
          stopped = true;
          return;
        }

        if (failCount > 5) {
          await log("error", "Too many failures, stopping to protect account");
          await updateJob(jobId, "error", "Too many send failures");
          stopped = true;
          return;
        }
      }
    } catch (e) {
      failCount++;
      await log("error", `Send error: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (stopped) return;

    const runtime = config.humanize
      ? calculateDelay(config.minDelay, config.maxDelay, sentCount, rt)
      : config.interval * 1000 + randomBetween(0, 5000);

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
