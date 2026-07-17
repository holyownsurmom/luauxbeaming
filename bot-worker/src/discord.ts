import { createLogger, updateJob } from "./api.js";
import { runDiscordAutoReplyBot } from "./autoreply.js";
import {
  circadianMultiplier,
  createSessionBrowser,
  humanNonce,
  messageFingerprint,
  overRollingLimit,
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

  // Anti-ban v7: stable browser fingerprint, harder floors, rolling limits, less heat
  const minDelaySec = (() => {
    const n = Number(config.minDelay);
    // Floor raised: sub-20min channel spam is a ban magnet
    if (!Number.isFinite(n) || n < 1200) return 1800;
    return Math.min(86_400, Math.floor(n));
  })();
  const maxDelaySec = (() => {
    const n = Number(config.maxDelay);
    const floor = minDelaySec + 600;
    if (!Number.isFinite(n) || n < floor) return Math.max(floor, 3600);
    return Math.min(86_400, Math.floor(n));
  })();
  const intervalSec = (() => {
    const n = Number(config.interval);
    if (!Number.isFinite(n) || n < 600) return 900;
    return Math.min(86_400, Math.floor(n));
  })();
  config.minDelay = minDelaySec;
  config.maxDelay = maxDelaySec;
  config.interval = intervalSec;
  config.humanize = true; // always on

  const startedAt = Date.now();
  await log("system", "Initializing Discord user-token client (anti-ban mode v7)...");
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
  const SESSION_MSG_CAP = randomBetween(3, 7);
  const DAILY_MSG_SOFT_CAP = randomBetween(8, 16);
  const sessionBrowser = createSessionBrowser();
  const apiHeaders = sessionBrowser.headers(
    config.token,
    `https://discord.com/channels/${config.guildId || "@me"}/${config.channelId}`,
  );
  const recentSendStamps: number[] = [];
  const recentFingerprints: string[] = [];

  abortSignal.addEventListener(
    "abort",
    () => {
      stopped = true;
      log("system", "Stop signal received, shutting down...").catch(() => {});
    },
    { once: true },
  );

  await log(
    "system",
    `Message loop started | session cap ~${SESSION_MSG_CAP} | soft daily ~${DAILY_MSG_SOFT_CAP} | anti-ban v7`,
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
    if (q > 0 && Math.random() < 0.85) return q;

    // Rolling hard limit: max 2 channel messages / 45 min
    if (overRollingLimit(recentSendStamps, 45 * 60_000, 2)) {
      return randomBetween(20 * 60, 55 * 60) * 1000;
    }

    // Micro "reading" pauses
    if (Math.random() < 0.38) {
      return randomBetween(360, 1200) * 1000;
    }
    if (totalSent > 0 && msgsSinceMediumBreak >= mediumBreakEvery) {
      msgsSinceMediumBreak = 0;
      mediumBreakEvery = randomBetween(2, 3);
      return randomBetween(900, 2700) * 1000;
    }
    if (Math.random() < 0.3) {
      return randomBetween(420, 960) * 1000;
    }
    if (rt > 10 && Math.random() < 0.42) {
      return randomBetween(1200, 3000) * 1000;
    }
    if (sentCount > 0 && msgsSinceLongAfk >= longAfkEvery) {
      msgsSinceLongAfk = 0;
      longAfkEvery = randomBetween(3, 6);
      return randomBetween(1800, 5400) * 1000;
    }
    // Random "went offline" window
    if (sentCount >= 2 && Math.random() < 0.12) {
      return randomBetween(50 * 60, 150 * 60) * 1000;
    }
    return 0;
  };

  const calculateDelay = (
    baseMin: number,
    baseMax: number,
    sendCount: number,
    rt: number,
  ): number => {
    let min = Math.max(baseMin, 1800);
    let max = Math.max(baseMax, min + 900);

    if (sendCount < 2) {
      min = Math.max(min, 2100);
      max = Math.max(max, 4200);
    } else if (sendCount < 4) {
      min = Math.max(min, 1800);
      max = Math.max(max, 3600);
    }

    // Runtime fatigue + circadian
    const slowdown = (1 + Math.min(rt / 28, 6)) * circadianMultiplier();
    min *= slowdown;
    max *= slowdown;

    const delay = randomBetween(min * 1000, max * 1000);
    // Asymmetric jitter — prefer slower, not faster
    const jitter = randomBetween(-45_000, 420_000);
    return Math.max(min * 1000 * 0.9, delay + jitter);
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
    // Avoid near-duplicate content (ban signal)
    let fp = messageFingerprint(msg);
    let tries = 0;
    while (
      tries < 4 &&
      (msg === lastSentText || recentFingerprints.includes(fp)) &&
      config.messages.length > 0
    ) {
      msg = variateMessage(baseMsg) + pickRandom([" ", ".", " ~", " 💀", ""]);
      fp = messageFingerprint(msg);
      tries++;
    }

    // Think time only — never call typing API on spam path
    const think = typingDurationMs(msg, 8000, 28_000) + randomBetween(3000, 16_000);
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
            nonce: humanNonce(),
            tts: false,
            flags: 0,
          }),
        },
        1, // fewer retries on spam = less hammering when limited
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
        recentSendStamps.push(Date.now());
        recentFingerprints.push(fp);
        if (recentFingerprints.length > 12) recentFingerprints.shift();
        consecutiveRateLimits = 0;
        failCount = Math.max(0, failCount - 1);
        await log("bot", `> ${msg}`);

        if (config.deleteAfterSend) {
          await log("warn", "deleteAfterSend ignored (anti-ban v7: deletes fingerprint accounts)");
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

          let retryAfter = (180 + consecutiveRateLimits * 120 + randomBetween(0, 120)) * 1000;
          try {
            const parsed = JSON.parse(res.body);
            if (parsed.retry_after) {
              retryAfter = Math.ceil(parsed.retry_after * 1000) + randomBetween(60_000, 180_000);
            }
            if (parsed.global || res.global) {
              retryAfter = Math.max(retryAfter, randomBetween(15 * 60_000, 40 * 60_000));
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
            // Protect account — end session instead of grinding through RL
            await log(
              "warn",
              "Repeated rate limits — ending session early to protect token (anti-ban v7)",
            );
            await markCompleted();
            return;
          }
        }

        if (res.status === 401 || res.status === 403) {
          await log("error", "Token revoked or access denied. Stopping.");
          await markError("Token invalid or banned");
          return;
        }

        if (failCount > 3) {
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

    // After a few channel messages, force a long break
    if (consecutiveSameChannel >= randomBetween(2, 4) && Math.random() < 0.7) {
      consecutiveSameChannel = 0;
      const channelBreak = randomBetween(35 * 60, 95 * 60) * 1000;
      await log(
        "system",
        `Channel fatigue break: ${(channelBreak / 60000).toFixed(0)}min (anti-ban v7)`,
      );
      await sleep(channelBreak, abortSignal);
      if (stopped) return;
    }

    const runtime = calculateDelay(
      Math.max(minDelaySec, 1800),
      Math.max(maxDelaySec, minDelaySec + 900),
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
