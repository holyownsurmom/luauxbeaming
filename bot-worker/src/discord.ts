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
  if (config.humanize && config.minDelay >= config.maxDelay) {
    config.maxDelay = config.minDelay + 1;
  }
  if (config.minDelay < 8) config.minDelay = 8;
  if (config.maxDelay < config.minDelay + 2) config.maxDelay = config.minDelay + 2;

  const startedAt = Date.now();
  await log("system", "Initializing Discord user-token client (anti-ban mode)...");
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

  let me: { id: string; username: string } | null = null;
  try {
    const meRes = await fetch("https://discord.com/api/v9/users/@me", {
      headers: { Authorization: config.token },
    });
    if (!meRes.ok) {
      const t = await meRes.text();
      await log("error", `Token invalid (${meRes.status}): ${t}`);
      await updateJob(jobId, "error", "Invalid token");
      return;
    }
    me = await meRes.json();
    await log("info", `Logged in as ${me!.username} (${me!.id})`);
  } catch (e) {
    await log("error", `Token check failed: ${e instanceof Error ? e.message : String(e)}`);
    await updateJob(jobId, "error", "Token check failed");
    return;
  }

  try {
    const chRes = await fetch(`https://discord.com/api/v9/channels/${config.channelId}`, {
      headers: { Authorization: config.token },
    });
    if (!chRes.ok) {
      const t = await chRes.text();
      await log("error", `Cannot access channel (${chRes.status}): ${t}`);
      await updateJob(jobId, "error", "Channel not accessible");
      return;
    }
    const ch = await chRes.json();
    await log("info", `Target: #${ch.name || config.channelId}`);
  } catch (e) {
    await log("error", `Channel fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    await updateJob(jobId, "error", "Channel check failed");
    return;
  }

  const msgCount = config.messages.length;
  await log(
    "system",
    `Spamming ${msgCount} message(s) | humanize=${config.humanize} | cooldowns active`,
  );

  let msgIndex = 0;
  let sentCount = 0;
  let failCount = 0;
  let consecutiveRateLimits = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  abortSignal.addEventListener(
    "abort",
    () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = null;
    },
    { once: true },
  );

  const sendTyping = async (channelId: string, token: string): Promise<void> => {
    try {
      await fetch(`https://discord.com/api/v9/channels/${channelId}/typing`, {
        method: "POST",
        headers: { Authorization: token },
      });
    } catch {
      /* typing failures are non-critical */
    }
  };

  const updatePresence = async (status: string, token: string): Promise<void> => {
    try {
      await fetch("https://discord.com/api/v9/users/@me/status", {
        method: "PATCH",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status,
          custom_status: { text: "" },
        }),
      });
    } catch {
      /* presence failures are non-critical */
    }
  };

  const calculateCooldown = (totalSent: number): number => {
    if (totalSent > 0 && totalSent % randomBetween(8, 15) === 0) {
      return randomBetween(120, 300) * 1000;
    }
    if (Math.random() < 0.1) {
      return randomBetween(45, 120) * 1000;
    }
    return 0;
  };

  const calculateDelay = (baseMin: number, baseMax: number, sendCount: number): number => {
    let min = baseMin;
    let max = baseMax;
    if (sendCount < 3) {
      min = Math.max(min, 15);
      max = Math.max(max, 30);
    } else if (sendCount < 8) {
      min = Math.max(min, 10);
      max = Math.max(max, 22);
    }
    const delay = randomBetween(min * 1000, max * 1000);
    const jitter = randomBetween(-2000, 3000);
    return Math.max(min * 1000, delay + jitter);
  };

  const sendNext = async () => {
    if (stopped) return;

    const cooldown = calculateCooldown(sentCount);
    if (cooldown > 0) {
      await log(
        "system",
        `Cooldown pause: ${(cooldown / 1000).toFixed(0)}s (sent ${sentCount} msgs)`,
      );
      await sleep(cooldown);
      if (stopped) return;
      if (Math.random() < 0.4) {
        await updatePresence("idle", config.token);
        await sleep(randomBetween(8000, 25000));
        await updatePresence("online", config.token);
        if (stopped) return;
      }
    }

    const baseMsg = config.messages[msgIndex % config.messages.length];
    const msg = config.humanize ? variateMessage(baseMsg) : baseMsg;
    msgIndex++;

    const typingTime = config.humanize ? typingDuration(msg) : randomBetween(2000, 4000);
    await sendTyping(config.channelId, config.token);
    await log("info", `Typing... (${(typingTime / 1000).toFixed(1)}s)`);
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
              randomBetween(3000, 8000),
            );
          }
        }

        if (Math.random() < 0.12 && sentCount > 2) {
          try {
            await sleep(randomBetween(1000, 3000));
            const recentRes = await fetch(
              `https://discord.com/api/v9/channels/${config.channelId}/messages?limit=1`,
              { headers: { Authorization: config.token } },
            );
            if (recentRes.ok) {
              const msgs = await recentRes.json();
              const lastMsg = msgs?.[0];
              if (lastMsg?.author?.id === me?.id && lastMsg?.content) {
                const editedContent = variateMessage(baseMsg);
                if (editedContent !== lastMsg.content) {
                  await fetch(
                    `https://discord.com/api/v9/channels/${config.channelId}/messages/${lastMsg.id}`,
                    {
                      method: "PATCH",
                      headers: {
                        Authorization: config.token,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({ content: editedContent }),
                    },
                  ).catch(() => {});
                  await log("info", `Edited last message`);
                }
              }
            }
          } catch {
            /* edit failures are non-critical */
          }
        }
      } else {
        failCount++;
        const body = await res.text();
        await log("error", `Send failed (${res.status}): ${body}`);

        if (res.status === 429) {
          consecutiveRateLimits++;
          failCount = Math.max(0, failCount - 3);

          let retryAfter = (20 + consecutiveRateLimits * 15 + randomBetween(0, 20)) * 1000;
          try {
            const parsed = JSON.parse(body);
            if (parsed.retry_after) {
              retryAfter = Math.ceil(parsed.retry_after * 1000) + randomBetween(5000, 15000);
            }
          } catch {
            /* parse failure, use computed value */
          }

          await log(
            "warn",
            `Rate limited (#${consecutiveRateLimits}). Waiting ${(retryAfter / 1000).toFixed(0)}s`,
          );
          await sleep(retryAfter);

          if (consecutiveRateLimits >= 3) {
            const longPause = randomBetween(600, 900) * 1000;
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
      ? calculateDelay(config.minDelay, config.maxDelay, sentCount)
      : config.interval * 1000 + randomBetween(0, 3000);

    await log("info", `Next message in ${(runtime / 1000).toFixed(1)}s`);

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
  }, 300000);

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
