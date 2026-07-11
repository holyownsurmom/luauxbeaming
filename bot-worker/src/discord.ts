import { createLogger, updateJob } from "./api.js";
import { runDiscordAutoReplyBot, type AutoReplyJobConfig } from "./autoreply.js";

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
  return Math.max(1500, Math.min(base + randomBetween(-500, 1500), 12000));
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
      config as unknown as AutoReplyJobConfig,
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
  if (config.minDelay < 5) config.minDelay = 5;

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
      /* ignore */
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
      /* ignore */
    }
  };

  const calculateCooldown = (totalSent: number): number => {
    if (totalSent > 0 && totalSent % randomBetween(8, 15) === 0) {
      const cooldown = randomBetween(90, 240) * 1000;
      return cooldown;
    }
    if (Math.random() < 0.08) {
      return randomBetween(30, 90) * 1000;
    }
    return 0;
  };

  const calculateDelay = (baseMin: number, baseMax: number, sendCount: number): number => {
    let min = baseMin;
    let max = baseMax;
    if (sendCount < 3) {
      min = Math.max(min, 12);
      max = Math.max(max, 25);
    } else if (sendCount < 8) {
      min = Math.max(min, 8);
      max = Math.max(max, 18);
    }
    const delay = randomBetween(min * 1000, max * 1000);
    const jitter = randomBetween(-1500, 2000);
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
        await sleep(randomBetween(5000, 15000));
        await updatePresence("online", config.token);
        if (stopped) return;
      }
    }

    const baseMsg = config.messages[msgIndex % config.messages.length];
    const msg = config.humanize ? variateMessage(baseMsg) : baseMsg;
    msgIndex++;

    const typingTime = config.humanize ? typingDuration(msg) : randomBetween(1500, 3000);
    await sendTyping(config.channelId, config.token);
    await log("info", `Typing... (${(typingTime / 1000).toFixed(1)}s)`);
    await sleep(typingTime);
    if (stopped) return;

    try {
      const res = await fetch(
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

      if (res.ok) {
        sentCount++;
        consecutiveRateLimits = 0;
        failCount = Math.max(0, failCount - 1);
        await log("bot", `> ${msg}`);

        if (config.deleteAfterSend) {
          const sent = await res.json();
          if (sent?.id) {
            setTimeout(
              () => {
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
              randomBetween(2000, 5000),
            );
          }
        }

        if (Math.random() < 0.15 && sentCount > 2) {
          try {
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
            /* ignore edit errors */
          }
        }
      } else {
        failCount++;
        const body = await res.text();
        await log("error", `Send failed (${res.status}): ${body}`);

        if (res.status === 429) {
          consecutiveRateLimits++;
          failCount = Math.max(0, failCount - 3);

          let retryAfter = (15 + consecutiveRateLimits * 10 + randomBetween(0, 15)) * 1000;
          try {
            const parsed = JSON.parse(body);
            if (parsed.retry_after) {
              retryAfter = Math.ceil(parsed.retry_after * 1000) + randomBetween(3000, 8000);
            }
          } catch {
            /* ignore parse errors */
          }

          await log(
            "warn",
            `Rate limited (#${consecutiveRateLimits}). Waiting ${(retryAfter / 1000).toFixed(0)}s`,
          );
          await sleep(retryAfter);

          if (consecutiveRateLimits >= 3) {
            const longPause = randomBetween(300, 600) * 1000;
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

        if (failCount > 15) {
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
      : config.interval * 1000 + randomBetween(-500, 1500);

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
