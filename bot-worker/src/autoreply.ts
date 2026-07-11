import WebSocket from "ws";
import { createLogger, updateJob } from "./api.js";

export type AutoReplyJobConfig = {
  token: string;
  messages: string[];
  minDelay: number;
  maxDelay: number;
  typing: boolean;
  autoAcceptFriends: boolean;
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

const SUFFIXES = ["", " ", "  ", ".", "...", "!", " ~"];

function variateMessage(msg: string): string {
  if (Math.random() < 0.35) {
    return msg + pickRandom(SUFFIXES);
  }
  return msg;
}

const TYPING_SPEEDS = [40, 50, 60, 70, 80, 90, 100];

function typingDuration(msg: string): number {
  const cpm = pickRandom(TYPING_SPEEDS);
  const chars = msg.replace(/\s+/g, " ").length;
  const base = (chars / cpm) * 60 * 1000;
  return Math.max(1500, Math.min(base + randomBetween(-500, 1500), 10000));
}

export async function runDiscordAutoReplyBot(
  jobId: string,
  discordId: string,
  config: AutoReplyJobConfig,
  abortSignal: AbortSignal,
): Promise<void> {
  const log = createLogger(jobId, discordId);

  if (!config.token) {
    await log("error", "Missing token");
    await updateJob(jobId, "error", "Missing token");
    return;
  }
  if (!config.messages?.length) {
    await log("error", "No reply messages configured");
    await updateJob(jobId, "error", "No reply messages configured");
    return;
  }

  if (config.minDelay < 5) config.minDelay = 5;

  await log("system", "Initializing Discord Auto-Reply Gateway client (anti-ban mode)...");
  await updateJob(jobId, "running");

  let ws: WebSocket | null = null;
  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let selfUserId: string | null = null;
  let lastSequence: number | null = null;
  let sessionId: string | null = null;
  let replyCount = 0;
  let recentReplyTimes: number[] = [];

  const sendPayload = (op: number, d: unknown) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op, d }));
    }
  };

  const startHeartbeat = (intervalMs: number) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (stopped) return;
      sendPayload(1, lastSequence);
    }, intervalMs);
  };

  const shouldThrottle = (): boolean => {
    const now = Date.now();
    recentReplyTimes = recentReplyTimes.filter((t) => now - t < 60000);
    if (recentReplyTimes.length >= 5) return true;
    return false;
  };

  const connectGateway = () => {
    if (stopped) return;

    ws = new WebSocket("wss://gateway.discord.gg/?v=9&encoding=json");

    ws.on("open", () => {
      log("info", "Connected to Discord Gateway WebSocket").catch(() => {});
    });

    ws.on("message", async (data: string) => {
      if (stopped) return;
      try {
        const payload = JSON.parse(data);
        const { op, t, d, s } = payload;

        if (s !== undefined) {
          lastSequence = s;
        }

        if (op === 10) {
          const heartbeatInterval = d.heartbeat_interval;
          startHeartbeat(heartbeatInterval);

          if (sessionId && lastSequence) {
            sendPayload(6, {
              token: config.token,
              session_id: sessionId,
              seq: lastSequence,
            });
          } else {
            sendPayload(2, {
              token: config.token,
              capabilities: 125,
              properties: {
                os: "windows",
                browser: "Chrome",
                device: "",
              },
              presence: {
                status: "online",
                since: 0,
                activities: [],
                afk: false,
              },
              compress: false,
            });
          }
        }

        if (op === 9) {
          sessionId = null;
          lastSequence = null;
          log("warn", "Invalid gateway session, re-identifying...").catch(() => {});
          await sleep(randomBetween(2000, 5000));
          ws?.close();
        }

        if (op === 0) {
          if (t === "READY") {
            selfUserId = d.user.id;
            sessionId = d.session_id;
            await log("info", `Gateway ready! Running as user ${d.user.username}`);
          }

          if (t === "RESUMED") {
            await log("info", "Gateway session resumed successfully");
          }

          if (t === "MESSAGE_CREATE") {
            if (!d.guild_id && d.author.id !== selfUserId && !d.author.bot) {
              const channelId = d.channel_id;
              const authorTag = `@${d.author.username}`;
              await log("chat", `DM from ${authorTag}: "${d.content}"`);

              if (shouldThrottle()) {
                await log("info", "Throttled (5+ replies in 60s), skipping this message");
                return;
              }

              const reply = variateMessage(
                config.messages[Math.floor(Math.random() * config.messages.length)],
              );

              let delay = randomBetween(config.minDelay * 1000, config.maxDelay * 1000);
              if (replyCount < 3) {
                delay = randomBetween(8000, 20000);
              } else if (Math.random() < 0.12) {
                delay = randomBetween(30000, 90000);
                await log("info", `Long random pause: ${(delay / 1000).toFixed(0)}s`);
              }

              if (config.typing) {
                const typingTime = typingDuration(reply);
                try {
                  await fetch(`https://discord.com/api/v9/channels/${channelId}/typing`, {
                    method: "POST",
                    headers: { Authorization: config.token },
                  });
                } catch {
                  /* ignore */
                }
                await log(
                  "info",
                  `Typing simulation... replying in ${(typingTime / 1000).toFixed(1)}s`,
                );
                await sleep(typingTime);
                if (stopped) return;
              } else {
                await log("info", `Replying in ${(delay / 1000).toFixed(1)}s`);
                await sleep(delay);
                if (stopped) return;
              }

              try {
                const res = await fetch(
                  `https://discord.com/api/v9/channels/${channelId}/messages`,
                  {
                    method: "POST",
                    headers: {
                      Authorization: config.token,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ content: reply }),
                  },
                );
                if (res.ok) {
                  replyCount++;
                  recentReplyTimes.push(Date.now());
                  await log("bot", `Sent auto-reply to ${authorTag}: "${reply}"`);
                } else if (res.status === 429) {
                  const body = await res.text();
                  let retryAfter = 30000;
                  try {
                    const parsed = JSON.parse(body);
                    if (parsed.retry_after) retryAfter = parsed.retry_after * 1000 + 5000;
                  } catch {
                    /* ignore */
                  }
                  await log("warn", `Rate limited on reply. Waiting ${(retryAfter / 1000).toFixed(0)}s`);
                  await sleep(retryAfter);
                } else {
                  const text = await res.text();
                  await log("error", `Failed to send auto-reply: ${text}`);
                }
              } catch (e) {
                await log(
                  "error",
                  `Error sending auto-reply: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
          }

          if (t === "RELATIONSHIP_ADD" && config.autoAcceptFriends) {
            if (d.type === 3) {
              const targetUser = `@${d.user.username}`;
              await log("info", `Received incoming friend request from ${targetUser}`);

              await sleep(randomBetween(2000, 8000));

              try {
                const res = await fetch(
                  `https://discord.com/api/v9/users/@me/relationships/${d.id}`,
                  {
                    method: "PUT",
                    headers: {
                      Authorization: config.token,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({}),
                  },
                );
                if (res.ok) {
                  await log("info", `Auto-accepted friend request from ${targetUser}`);
                } else {
                  const text = await res.text();
                  await log("error", `Failed to accept friend request: ${text}`);
                }
              } catch (e) {
                await log(
                  "error",
                  `Error accepting friend request: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
          }
        }
      } catch (err) {
        log("error", `Gateway message handling error: ${err}`).catch(() => {});
      }
    });

    ws.on("close", async (code: number, reason: Buffer) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (stopped) return;

      const reconnectDelay = code === 4004 || code === 4010 || code === 4011 || code === 4012
        ? -1
        : randomBetween(5000, 12000);

      if (reconnectDelay === -1) {
        log("error", `Fatal gateway close (code ${code}), not reconnecting`).catch(() => {});
        await updateJob(jobId, "error", `Gateway closed: ${code}`);
        stopped = true;
        return;
      }

      log(
        "warn",
        `Gateway closed (code ${code}). Reconnecting in ${(reconnectDelay / 1000).toFixed(0)}s...`,
      ).catch(() => {});
      await sleep(reconnectDelay);
      connectGateway();
    });

    ws.on("error", (err: Error) => {
      log("error", `Gateway WebSocket error: ${err.message}`).catch(() => {});
    });
  };

  connectGateway();

  abortSignal.addEventListener(
    "abort",
    () => {
      stopped = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (ws) ws.close();
      log("system", "Auto-Reply client stopped.").catch(() => {});
    },
    { once: true },
  );

  return new Promise((resolve) => {
    const checkAbort = setInterval(() => {
      if (abortSignal.aborted || stopped) {
        clearInterval(checkAbort);
        resolve();
      }
    }, 1000);
  });
}
