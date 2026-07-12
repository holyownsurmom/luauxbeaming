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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
  return Math.max(2000, Math.min(base + randomBetween(-500, 2000), 12000));
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

  if (config.minDelay < 10) config.minDelay = 10;

  await log("system", "Initializing Discord Auto-Reply Gateway client (anti-ban mode v2)...");
  await updateJob(jobId, "running");

  let ws: WebSocket | null = null;
  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatAcked = true;
  let selfUserId: string | null = null;
  let lastSequence: number | null = null;
  let sessionId: string | null = null;
  let replyCount = 0;
  let recentReplyTimes: number[] = [];
  let reconnectAttempts = 0;
  let missedReplies = 0;
  let longAwayUntil = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let dmQueue: Promise<void> = Promise.resolve();
  const MAX_RECONNECT = 15;

  const cleanup = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        /* ignore close errors */
      }
      ws = null;
    }
  };

  const sendPayload = (op: number, d: unknown) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op, d }));
    }
  };

  const startHeartbeat = (intervalMs: number) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatAcked = true;
    const jitter = randomBetween(-2000, 2000);
    heartbeatTimer = setInterval(() => {
      if (stopped) return;
      if (!heartbeatAcked) {
        log("warn", "Heartbeat not ACKed, reconnecting...").catch(() => {});
        cleanup();
        scheduleReconnect();
        return;
      }
      heartbeatAcked = false;
      sendPayload(1, lastSequence);
    }, Math.max(10000, intervalMs + jitter));
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    if (reconnectAttempts >= MAX_RECONNECT) {
      log("error", "Max gateway reconnect attempts reached").catch(() => {});
      updateJob(jobId, "error", "Gateway reconnect failed").catch(() => {});
      stopped = true;
      return;
    }
    reconnectAttempts++;
    const delay = Math.min(
      randomBetween(8000, 20000) * Math.pow(1.5, reconnectAttempts - 1),
      180000,
    );
    log("info", `Gateway reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT})`).catch(() => {});
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectGateway();
    }, delay);
  };

  const shouldThrottle = (): boolean => {
    const now = Date.now();
    recentReplyTimes = recentReplyTimes.filter((t) => now - t < 60000);
    return recentReplyTimes.length >= 3;
  };

  const shouldMissReply = (): boolean => {
    if (replyCount < 5) return false;
    if (Math.random() < 0.08) return true;
    return false;
  };

  const shouldGoAway = (): boolean => {
    const now = Date.now();
    if (now < longAwayUntil) return true;
    if (replyCount > 0 && replyCount % randomBetween(40, 80) === 0) {
      longAwayUntil = now + randomBetween(120000, 600000);
      log("info", `Going AFK for ${(longAwayUntil - now) / 60000 | 0}min (simulating offline)`).catch(() => {});
      return true;
    }
    return false;
  };

  const connectGateway = () => {
    if (stopped) return;

    cleanup();
    ws = new WebSocket("wss://gateway.discord.gg/?v=9&encoding=json");

    ws.on("open", () => {
      log("info", "Connected to Discord Gateway WebSocket").catch(() => {});
    });

    ws.on("message", async (data: string) => {
      if (stopped) return;
      try {
        const payload = JSON.parse(data);
        const { op, t, d, s } = payload;

        if (s !== undefined && s !== null) {
          lastSequence = s;
        }

        if (op === 10) {
          const heartbeatInterval = d.heartbeat_interval;
          startHeartbeat(heartbeatInterval);

          if (sessionId != null && lastSequence != null) {
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

        if (op === 11) {
          heartbeatAcked = true;
        }

        if (op === 9) {
          sessionId = null;
          lastSequence = null;
          log("warn", "Invalid gateway session, reconnecting...").catch(() => {});
          cleanup();
          scheduleReconnect();
          return;
        }

        if (op === 7) {
          log("warn", "Gateway requested reconnect").catch(() => {});
          cleanup();
          scheduleReconnect();
          return;
        }

        if (op === 0) {
          if (t === "READY") {
            selfUserId = d.user.id;
            sessionId = d.session_id;
            reconnectAttempts = 0;
            await log("info", `Gateway ready! Running as user ${d.user.username}`);
          }

          if (t === "RESUMED") {
            reconnectAttempts = 0;
            await log("info", "Gateway session resumed successfully");
          }

          if (t === "MESSAGE_CREATE") {
            if (!d.guild_id && d.author.id !== selfUserId && !d.author.bot) {
              const channelId = d.channel_id;
              const authorTag = `@${d.author.username}`;
              const content = d.content as string;
              // Serialize DM handling to avoid parallel replies / rate limits
              dmQueue = dmQueue
                .then(async () => {
                  if (stopped || abortSignal.aborted) return;
                  await log("chat", `DM from ${authorTag}: "${content}"`);

                  if (shouldGoAway()) {
                    await log("info", "AFK — skipping reply");
                    return;
                  }
                  if (shouldMissReply()) {
                    missedReplies++;
                    await log(
                      "info",
                      `Missed reply to ${authorTag} (simulating not seeing message)`,
                    );
                    return;
                  }
                  if (shouldThrottle()) {
                    await log("info", "Throttled (3+ replies in 60s), skipping this message");
                    return;
                  }

                  const reply = variateMessage(
                    config.messages[Math.floor(Math.random() * config.messages.length)],
                  );

                  let delay = randomBetween(config.minDelay * 1000, config.maxDelay * 1000);
                  if (replyCount < 3) {
                    delay = randomBetween(12000, 30000);
                  } else if (Math.random() < 0.12) {
                    delay = randomBetween(60000, 180000);
                    await log("info", `Long random pause: ${(delay / 1000).toFixed(0)}s`);
                  }

                  const typingTime = config.typing ? typingDuration(reply) : 0;
                  const waitMs = Math.max(delay, typingTime);
                  if (config.typing) {
                    try {
                      await fetch(`https://discord.com/api/v9/channels/${channelId}/typing`, {
                        method: "POST",
                        headers: { Authorization: config.token },
                      });
                    } catch {
                      /* ignore */
                    }
                  }
                  await log("info", `Replying in ${(waitMs / 1000).toFixed(1)}s`);
                  await sleep(waitMs, abortSignal);
                  if (stopped || abortSignal.aborted) return;

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
                      let retryAfter = 60000;
                      try {
                        const parsed = JSON.parse(body);
                        if (parsed.retry_after) retryAfter = parsed.retry_after * 1000 + 10000;
                      } catch {
                        /* use default */
                      }
                      await log(
                        "warn",
                        `Rate limited on reply. Waiting ${(retryAfter / 1000).toFixed(0)}s`,
                      );
                      await sleep(retryAfter, abortSignal);
                    } else if (res.status === 401 || res.status === 403) {
                      await log("error", "Token revoked or access denied. Stopping.");
                      await updateJob(jobId, "error", "Token invalid or banned");
                      stopped = true;
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
                })
                .catch(() => {});
            }
          }

          if (t === "RELATIONSHIP_ADD" && config.autoAcceptFriends) {
            if (d.type === 3) {
              const targetUser = `@${d.user.username}`;
              const userId = d.id as string;
              await log("info", `Received incoming friend request from ${targetUser}`);

              await sleep(randomBetween(5000, 15000));

              try {
                const acceptRes = await fetch(
                  `https://discord.com/api/v9/users/@me/relationships/${userId}`,
                  {
                    method: "PUT",
                    headers: {
                      Authorization: config.token,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({}),
                  },
                );
                if (acceptRes.ok) {
                  await log("info", `Auto-accepted friend request from ${targetUser}`);

                  // Send initial configured reply after accepting
                  if (config.messages && config.messages.length > 0) {
                    try {
                      // Create DM channel
                      const dmChannelRes = await fetch("https://discord.com/api/v9/users/@me/channels", {
                        method: "POST",
                        headers: {
                          Authorization: config.token,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ recipient_id: userId }),
                      });

                      if (dmChannelRes.ok) {
                        const dmChannel = await dmChannelRes.json();
                        const channelId = dmChannel.id;

                        // Small delay before first message
                        await sleep(randomBetween(3000, 8000));

                        const reply = variateMessage(
                          config.messages[Math.floor(Math.random() * config.messages.length)],
                        );

                        // Optional typing
                        if (config.typing) {
                          try {
                            await fetch(`https://discord.com/api/v9/channels/${channelId}/typing`, {
                              method: "POST",
                              headers: { Authorization: config.token },
                            });
                            const typeTime = typingDuration(reply);
                            await sleep(typeTime);
                          } catch { /* ignore typing */ }
                        }

                        const sendRes = await fetch(
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

                        if (sendRes.ok) {
                          await log("bot", `Sent initial auto-reply to new friend ${targetUser}: "${reply}"`);
                        } else {
                          const txt = await sendRes.text();
                          await log("error", `Failed to send initial reply to ${targetUser}: ${txt}`);
                        }
                      } else {
                        await log("error", `Failed to open DM channel for ${targetUser}`);
                      }
                    } catch (sendErr) {
                      await log("error", `Error sending initial reply after friend accept: ${sendErr}`);
                    }
                  }
                } else {
                  const text = await acceptRes.text();
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

    ws.on("close", (code: number, _reason: Buffer) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (stopped) return;

      const fatalCodes = [4004, 4010, 4011, 4012, 4014];
      if (fatalCodes.includes(code)) {
        log("error", `Fatal gateway close (code ${code}), not reconnecting`).catch(() => {});
        updateJob(jobId, "error", `Gateway closed: ${code}`).catch(() => {});
        stopped = true;
        return;
      }

      log(
        "warn",
        `Gateway closed (code ${code}). Reconnecting...`,
      ).catch(() => {});
      scheduleReconnect();
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
      cleanup();
      log("system", "Auto-Reply client stopped.").catch(() => {});
    },
    { once: true },
  );

  return new Promise((resolve) => {
    const checkAbort = setInterval(() => {
      if (abortSignal.aborted || stopped) {
        clearInterval(checkAbort);
        cleanup();
        resolve();
      }
    }, 1000);
  });
}
