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

  // ROOT CAUSE OF BANS: This feature uses Discord USER TOKENS (self-bots).
  // Discord actively detects and terminates accounts that use automation via user tokens.
  // Anti-ban v3: Much longer warmup, randomized delays, no startup fingerprinting calls.
  if (config.minDelay < 600) {
    config.minDelay = 600;
    config.maxDelay = Math.max(config.maxDelay, 1200);
  }

  const startedAt = Date.now();
  await log("system", "Initializing Discord user-token client (anti-ban mode v3)...");
  await updateJob(jobId, "running");

  let stopped = false;

  abortSignal.addEventListener(
    "abort",
    () => {
      stopped = true;
      log("system", "Stop signal received, shutting down...").catch(() => {});
    },
    { once: true },
  );

  // ANTI-BAN v3: Skip /users/@me and channel check — they fingerprint self-bots.
  // Just go straight to warmup, then start sending.
  const warmupMs = randomBetween(300000, 900000); // 5-15 min warmup
  await log("system", `Warmup phase: waiting ${(warmupMs / 60000).toFixed(1)}min before first message (simulating browsing)...`);
  await sleep(warmupMs);
  if (stopped) return;

  await log("system", `Starting message loop | humanize=${config.humanize} | anti-ban v3 active`);

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
    // Random "reading" pauses — pretend to browse before replying
    if (Math.random() < 0.15) {
      return randomBetween(120, 420) * 1000;
    }
    // Every 4-8 messages, take a longer break
    if (totalSent > 0 && totalSent % randomBetween(4, 8) === 0) {
      return randomBetween(300, 900) * 1000;
    }
    // Occasional medium pause
    if (Math.random() < 0.2) {
      return randomBetween(120, 360) * 1000;
    }
    // After 30 min runtime, longer breaks more often
    if (rt > 30 && Math.random() < 0.25) {
      return randomBetween(300, 1200) * 1000;
    }
    // Every 15-30 messages, long AFK
    if (sentCount > 0 && sentCount % randomBetween(15, 30) === 0) {
      return randomBetween(600, 2400) * 1000;
    }
    return 0;
  };

  const calculateDelay = (baseMin: number, baseMax: number, sendCount: number, rt: number): number => {
    let min = baseMin;
    let max = baseMax;
    // First few messages are extra slow
    if (sendCount < 2) {
      min = Math.max(min, 600);
      max = Math.max(max, 1200);
    } else if (sendCount < 5) {
      min = Math.max(min, 480);
      max = Math.max(max, 900);
    }
    // Slow down over time
    const slowdown = 1 + Math.min(rt / 60, 3);
    min *= slowdown;
    max *= slowdown;
    const delay = randomBetween(min * 1000, max * 1000);
    // Add big random jitter
    const jitter = randomBetween(-30000, 60000);
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

    // Human-like "typing" delay — longer and more variable
    const typingTime = randomBetween(3000, 8000);
    await sleep(typingTime);
    if (stopped) return;

    try {
      const res = await sendWithRetry(
        `https://discord.com/api/v9/channels/${config.channelId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: config.token,
            "Content-Type": "application/json",
          },
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

        if (config.deleteAfterSend) {
          const sent = await res.json();
          if (sent?.id) {
            setTimeout(
              () => {
                if (stopped) return;
                fetch(
                  `https://discord.com/api/v9/channels/${config.channelId}/messages/${sent.id}`,
                  {
                    method: "DELETE",
                    headers: { Authorization: config.token },
                  },
                ).catch((e) => {
                  log("error", `Delete failed: ${e.message}`).catch(() => {});
                });
              },
              randomBetween(5000, 15000),
            );
          }
        }

        // Editing messages is intentionally disabled.
        // Editing + sending is a very strong self-bot fingerprint and gets accounts terminated quickly.
      } else {
        failCount++;
        const body = await res.text();
        await log("error", `Send failed (${res.status}): ${body}`);

        if (res.status === 429) {
          consecutiveRateLimits++;
          failCount = Math.max(0, failCount - 3);

          let retryAfter = (30 + consecutiveRateLimits * 20 + randomBetween(0, 30)) * 1000;
          try {
            const parsed = JSON.parse(body);
            if (parsed.retry_after) {
              retryAfter = Math.ceil(parsed.retry_after * 1000) + randomBetween(10000, 20000);
            }
          } catch {
            /* parse failure, use computed value */
          }

          await log(
            "warn",
            `Rate limited (#${consecutiveRateLimits}). Waiting ${(retryAfter / 1000).toFixed(0)}s`,
          );
          await sleep(retryAfter);

          if (consecutiveRateLimits >= 2) {
            const longPause = randomBetween(900, 1800) * 1000;
            await log(
              "warn",
              `Multiple rate limits. Long pause: ${(longPause / 1000).toFixed(0)}s`,
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

        if (failCount > 10) {
          await log("error", "Too many failures, stopping");
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
