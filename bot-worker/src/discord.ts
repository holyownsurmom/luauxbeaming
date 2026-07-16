import { createLogger, updateJob } from "./api.js";
import { runDiscordAutoReplyBot } from "./autoreply.js";
import {
  browserHeaders,
  circadianMultiplier,
  pickRandom,
  quietHoursExtraMs,
  randomBetween,
  sendWithRetry,
  shuffleArray,
  sleep,
  typingDurationMs,
  variateMessage,
} from "./discord-humanize.js";

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

  // Anti-ban v6: shared humanize, quiet hours, circadian, richer variation, hard floors
  const minDelaySec = (() => {
    const n = Number(config.minDelay);
    if (!Number.isFinite(n) || n < 900) return 1200;
    return Math.min(86_400, Math.floor(n));
  })();
  const maxDelaySec = (() => {
    const n = Number(config.maxDelay);
    const floor = minDelaySec + 300;
    if (!Number.isFinite(n) || n < floor) return Math.max(floor, 2400);
    return Math.min(86_400, Math.floor(n));
  })();
  const intervalSec = (() => {
    const n = Number(config.interval);
    if (!Number.isFinite(n) || n < 300) return 600;
    return Math.min(86_400, Math.floor(n));
  })();
  config.minDelay = minDelaySec;
  config.maxDelay = maxDelaySec;
  config.interval = intervalSec;
  config.humanize = true; // always on

  const startedAt = Date.now();
  await log("system", "Initializing Discord user-token client (anti-ban mode v6)...");
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

  // Short sessions = less heat
  const SESSION_MSG_CAP = randomBetween(4, 10);
  const DAILY_MSG_SOFT_CAP = randomBetween(12, 22);
  const apiHeaders = browserHeaders(
    config.token,
    `https://discord.com/channels/${config.guildId || "@me"}/${config.channelId}`,
  );

  abortSignal.addEventListener(
    "abort",
    () => {
      stopped = true;
      log("system", "Stop signal received, shutting down...").catch(() => {});
    },
    { once: true },
  );

  // Quiet-hours gate before warmup
  const quietExtra = quietHoursExtraMs();
  if (quietExtra > 0) {
    await log(
      "system",
      `Quiet hours — sleeping extra ${(quietExtra / 60000).toFixed(0)}min before warmup (anti-ban v6)`,
    );
    await sleep(quietExtra, abortSignal);
    if (stopped || abortSignal.aborted) return;
  }

  // Warmup 12–35 min (slightly less extreme than v5 but still human)
  const warmupMs = randomBetween(720_000, 2_100_000);
  await log(
    "system",
    `Warmup: ${(warmupMs / 60000).toFixed(1)}min idle before first message (anti-ban v6)...`,
  );
  await sleep(warmupMs, abortSignal);
  if (stopped || abortSignal.aborted) return;

  await log(
    "system",
    `Message loop started | session cap ~${SESSION_MSG_CAP} | soft daily ~${DAILY_MSG_SOFT_CAP} | anti-ban v6`,
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
  let longAfkEvery = randomBetween(4, 8);
  let lastSentText = "";
  let consecutiveSameChannel = 0;

  abortSignal.addEventListener(
    "abort",
    () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = null;
    },
    { once: true },
  );

  const runtimeMinutes = () => (Date.now() - startedAt) / 60000;

  const calculateCooldown = (totalSent: number, rt: number): number => {
    // Quiet hours mid-session → long pause
    const q = quietHoursExtraMs();
    if (q > 0 && Math.random() < 0.7) return q;

    // Micro "reading" pauses
    if (Math.random() < 0.32) {
      return randomBetween(240, 840) * 1000;
    }
    if (totalSent > 0 && msgsSinceMediumBreak >= mediumBreakEvery) {
      msgsSinceMediumBreak = 0;
      mediumBreakEvery = randomBetween(2, 4);
      return randomBetween(720, 2100) * 1000;
    }
    if (Math.random() < 0.25) {
      return randomBetween(300, 780) * 1000;
    }
    if (rt > 12 && Math.random() < 0.38) {
      return randomBetween(900, 2400) * 1000;
    }
    if (sentCount > 0 && msgsSinceLongAfk >= longAfkEvery) {
      msgsSinceLongAfk = 0;
      longAfkEvery = randomBetween(4, 8);
      return randomBetween(1500, 4200) * 1000;
    }
    // Random "went offline" window
    if (sentCount >= 3 && Math.random() < 0.08) {
      return randomBetween(45 * 60, 120 * 60) * 1000;
    }
    return 0;
  };

  const calculateDelay = (
    baseMin: number,
    baseMax: number,
    sendCount: number,
    rt: number,
  ): number => {
    let min = Math.max(baseMin, 1200);
    let max = Math.max(baseMax, min + 600);

    if (sendCount < 2) {
      min = Math.max(min, 1500);
      max = Math.max(max, 3000);
    } else if (sendCount < 4) {
      min = Math.max(min, 1350);
      max = Math.max(max, 2400);
    }

    // Runtime fatigue + circadian
    const slowdown = (1 + Math.min(rt / 35, 5)) * circadianMultiplier();
    min *= slowdown;
    max *= slowdown;

    const delay = randomBetween(min * 1000, max * 1000);
    const jitter = randomBetween(-75_000, 280_000);
    return Math.max(min * 1000 * 0.85, delay + jitter);
  };

  const sendNext = async () => {
    if (stopped) return;

    const rt = runtimeMinutes();

    if (sentCount >= DAILY_MSG_SOFT_CAP) {
      await log(
        "system",
        `Soft daily cap (${DAILY_MSG_SOFT_CAP}) reached. Stopping session to protect account.`,
      );
      await markCompleted();
      return;
    }

    const cooldown = calculateCooldown(sentCount, rt);
    if (cooldown > 0) {
      await log(
        "system",
        `Cooldown: ${(cooldown / 1000).toFixed(0)}s (sent ${sentCount}, runtime ${rt.toFixed(0)}min)`,
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
    let msg = variateMessage(baseMsg);
    if (msg === lastSentText && config.messages.length > 1) {
      msg = variateMessage(baseMsg) + pickRandom([" ", ".", " ~", " 💀"]);
    }

    // Think time only — never call typing API on spam path
    const think = typingDurationMs(msg, 6000, 22_000) + randomBetween(2000, 12_000);
    await sleep(think, abortSignal);
    if (stopped) return;

    if (sentCount >= SESSION_MSG_CAP) {
      await log(
        "system",
        `Session cap (${SESSION_MSG_CAP}). Stop. Wait hours before restarting this account.`,
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
            nonce: String(Date.now() + randomBetween(1000, 99999)),
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
        consecutiveSameChannel++;
        msgsSinceMediumBreak++;
        msgsSinceLongAfk++;
        lastSentText = msg;
        consecutiveRateLimits = 0;
        failCount = Math.max(0, failCount - 1);
        await log("bot", `> ${msg}`);

        if (config.deleteAfterSend) {
          await log("warn", "deleteAfterSend ignored (anti-ban v6: deletes fingerprint accounts)");
        }
      } else {
        failCount++;
        await log("error", `Send failed (${res.status}): ${res.body.slice(0, 300)}`);

        if (res.captcha) {
          await log(
            "error",
            "Captcha required — account flagged. Switch alt token. Not a LuauX bug.",
          );
          await markError("Discord captcha-required (account flagged)");
          return;
        }

        if (res.status === 429 || res.rateLimited) {
          consecutiveRateLimits++;
          failCount = Math.max(0, failCount - 3);

          let retryAfter = (120 + consecutiveRateLimits * 90 + randomBetween(0, 90)) * 1000;
          try {
            const parsed = JSON.parse(res.body);
            if (parsed.retry_after) {
              retryAfter = Math.ceil(parsed.retry_after * 1000) + randomBetween(45_000, 120_000);
            }
          } catch {
            /* keep computed */
          }

          await log(
            "warn",
            `Rate limited (#${consecutiveRateLimits}). Cool-down ${(retryAfter / 1000).toFixed(0)}s`,
          );
          await sleep(retryAfter, abortSignal);
          if (consecutiveRateLimits >= 2) {
            const longPause = randomBetween(2400, 4800) * 1000;
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

        if (failCount > 4) {
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

    // After several consecutive channel messages, force a long break
    if (consecutiveSameChannel >= randomBetween(3, 6) && Math.random() < 0.55) {
      consecutiveSameChannel = 0;
      const channelBreak = randomBetween(25 * 60, 70 * 60) * 1000;
      await log(
        "system",
        `Channel fatigue break: ${(channelBreak / 60000).toFixed(0)}min (anti-ban v6)`,
      );
      await sleep(channelBreak, abortSignal);
      if (stopped) return;
    }

    const runtime = calculateDelay(
      Math.max(minDelaySec, 1200),
      Math.max(maxDelaySec, minDelaySec + 600),
      sentCount,
      rt,
    );

    await log(
      "info",
      `Next message in ${(runtime / 1000).toFixed(1)}s | runtime ${rt.toFixed(0)}min | sent ${sentCount}`,
    );

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
  }, 180_000);

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
