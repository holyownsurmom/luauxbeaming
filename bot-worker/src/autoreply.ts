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

const SUFFIXES = ["", " ", "  ", ".", "...", "!", " ~", " lol", " fr", " ngl", " haha"];

function variateMessage(msg: string): string {
  let result = msg.trim();
  if (Math.random() < 0.4) result += pickRandom(SUFFIXES);
  if (Math.random() < 0.12 && result.length > 6) {
    const idx = randomBetween(1, result.length - 2);
    const ch = result[idx];
    if (ch && /[a-z]/i.test(ch)) {
      result = result.slice(0, idx) + ch + ch + result.slice(idx + 1);
    }
  }
  if (Math.random() < 0.1) {
    result = result.charAt(0).toLowerCase() + result.slice(1);
  }
  return result || msg;
}

function browserHeaders(token: string): Record<string, string> {
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
  return {
    Authorization: token,
    "Content-Type": "application/json",
    "User-Agent": userAgent,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://discord.com",
    Referer: "https://discord.com/channels/@me",
    "X-Discord-Locale": "en-US",
    "X-Discord-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
    "X-Super-Properties": superProps,
  };
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

  // Defensive defaults — never NaN timers from missing UI fields
  const minDelaySec = (() => {
    const n = Number(config.minDelay);
    // Floor raised — sub-20s reply spam is a ban magnet
    if (!Number.isFinite(n) || n < 20) return 30;
    return Math.min(86_400, Math.floor(n));
  })();
  const maxDelaySec = (() => {
    const n = Number(config.maxDelay);
    const floor = minDelaySec + 15;
    if (!Number.isFinite(n) || n < floor) return Math.max(floor, 90);
    return Math.min(86_400, Math.floor(n));
  })();
  config.minDelay = minDelaySec;
  config.maxDelay = maxDelaySec;
  // Typing indicator API is a self-bot fingerprint — default off, rare if forced on
  config.typing = config.typing === true;
  config.autoAcceptFriends = !!config.autoAcceptFriends;

  const apiHeaders = browserHeaders(config.token);
  const chromeUa = apiHeaders["User-Agent"];

  await log("system", "Initializing Discord Auto-Reply Gateway client (anti-ban mode v3)...");
  await updateJob(jobId, "running");

  let ws: WebSocket | null = null;
  let stopped = false;
  let dmQueueDepth = 0;
  const MAX_DM_QUEUE = 25;
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
    recentReplyTimes = recentReplyTimes.filter((t) => now - t < 120000);
    // Max 2 replies per 2 minutes
    return recentReplyTimes.length >= 2;
  };

  const shouldMissReply = (): boolean => {
    if (replyCount < 3) return false;
    if (Math.random() < 0.14) return true;
    return false;
  };

  let repliesSinceAfk = 0;
  let afkEvery = randomBetween(12, 25);
  const repliedUsers = new Map<string, number>(); // userId -> last reply ts
  let friendsAcceptedHour = 0;
  let friendsHourStart = Date.now();

  const shouldGoAway = (): boolean => {
    const now = Date.now();
    if (now < longAwayUntil) return true;
    if (repliesSinceAfk >= afkEvery) {
      repliesSinceAfk = 0;
      afkEvery = randomBetween(12, 25);
      longAwayUntil = now + randomBetween(180000, 900000);
      log("info", `Going AFK for ${((longAwayUntil - now) / 60000) | 0}min (simulating offline)`).catch(() => {});
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
            const status = pickRandom(["online", "idle", "dnd", "invisible"] as const);
            sendPayload(2, {
              token: config.token,
              capabilities: 16381,
              properties: {
                os: "Windows",
                browser: "Chrome",
                device: "",
                system_locale: "en-US",
                browser_user_agent: chromeUa,
                browser_version: chromeUa.match(/Chrome\/([\d.]+)/)?.[1] || "134.0.0.0",
                os_version: "10",
                referrer: "",
                referring_domain: "",
                referrer_current: "",
                referring_domain_current: "",
                release_channel: "stable",
                client_build_number: pickRandom([350000, 352000, 354000, 356000]),
                client_event_source: null,
              },
              presence: {
                status,
                since: status === "idle" ? Date.now() - randomBetween(60_000, 600_000) : 0,
                activities: [],
                afk: status === "idle",
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
            // Warmup — don't reply instantly after connect
            const warm = randomBetween(120_000, 480_000);
            longAwayUntil = Date.now() + warm;
            await log("info", `Warmup AFK ${(warm / 60000).toFixed(1)}min before first reply (anti-ban v3)`);
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
              if (dmQueueDepth >= MAX_DM_QUEUE) {
                log("warn", `DM queue full (${MAX_DM_QUEUE}) — dropping message from ${authorTag}`).catch(
                  () => {},
                );
              } else {
              // Serialize DM handling to avoid parallel replies / rate limits
              dmQueueDepth++;
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
                    await log("info", "Throttled (2+ replies in 2min), skipping this message");
                    return;
                  }

                  const authorId = String(d.author.id || "");
                  const lastToUser = repliedUsers.get(authorId) || 0;
                  // Per-user cooldown: at most one reply per user every 10–25 min
                  const userCd = randomBetween(600_000, 1_500_000);
                  if (authorId && Date.now() - lastToUser < userCd) {
                    await log("info", `Per-user cooldown active for ${authorTag} — skip`);
                    return;
                  }

                  const reply = variateMessage(
                    config.messages[Math.floor(Math.random() * config.messages.length)],
                  );

                  let delay = randomBetween(minDelaySec * 1000, maxDelaySec * 1000);
                  if (replyCount < 3) {
                    delay = randomBetween(45000, 120000);
                  } else if (Math.random() < 0.18) {
                    delay = randomBetween(120000, 360000);
                    await log("info", `Long random pause: ${(delay / 1000).toFixed(0)}s`);
                  }

                  // Typing API only rarely (fingerprint) — sleep still simulates think time
                  const useTyping = config.typing && Math.random() < 0.22;
                  const typingTime = useTyping ? typingDuration(reply) : randomBetween(4000, 14000);
                  const waitMs = Math.max(delay, typingTime);
                  if (useTyping) {
                    try {
                      await fetch(`https://discord.com/api/v9/channels/${channelId}/typing`, {
                        method: "POST",
                        headers: apiHeaders,
                      });
                    } catch {
                      /* ignore */
                    }
                  }
                  await log("info", `Replying in ${(waitMs / 1000).toFixed(1)}s`);
                  await sleep(waitMs, abortSignal);
                  if (stopped || abortSignal.aborted) return;

                  const sendOnce = async (): Promise<boolean> => {
                    const res = await fetch(
                      `https://discord.com/api/v9/channels/${channelId}/messages`,
                      {
                        method: "POST",
                        headers: apiHeaders,
                        body: JSON.stringify({
                          content: reply,
                          nonce: String(Date.now() + randomBetween(1000, 9999)),
                          tts: false,
                          flags: 0,
                        }),
                      },
                    );
                    if (res.ok) {
                      replyCount++;
                      repliesSinceAfk++;
                      if (authorId) repliedUsers.set(authorId, Date.now());
                      recentReplyTimes.push(Date.now());
                      await log("bot", `Sent auto-reply to ${authorTag}: "${reply}"`);
                      return true;
                    }
                    if (res.status === 429) {
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
                        `Rate limited on reply. Waiting ${(retryAfter / 1000).toFixed(0)}s then retry`,
                      );
                      await sleep(retryAfter, abortSignal);
                      return false;
                    }
                    if (res.status === 401 || res.status === 403) {
                      await log("error", "Token revoked or access denied. Stopping.");
                      await updateJob(jobId, "error", "Token invalid or banned");
                      stopped = true;
                      return true;
                    }
                    const text = await res.text();
                    await log("error", `Failed to send auto-reply: ${text.slice(0, 300)}`);
                    return true;
                  };

                  try {
                    let done = await sendOnce();
                    if (!done && !stopped && !abortSignal.aborted) {
                      done = await sendOnce();
                      if (!done) await log("warn", "Dropped reply after rate-limit retries");
                    }
                  } catch (e) {
                    await log(
                      "error",
                      `Error sending auto-reply: ${e instanceof Error ? e.message : String(e)}`,
                    );
                  }
                })
                .catch(() => {})
                .finally(() => {
                  dmQueueDepth = Math.max(0, dmQueueDepth - 1);
                });
              }
            }
          }

              if (t === "RELATIONSHIP_ADD" && config.autoAcceptFriends) {
            if (d.type === 3) {
              const targetUser = `@${d.user.username}`;
              const userId = d.id as string;
              await log("info", `Received incoming friend request from ${targetUser}`);

              // Cap friend accepts (mass-accept is a ban signal)
              if (Date.now() - friendsHourStart > 3_600_000) {
                friendsHourStart = Date.now();
                friendsAcceptedHour = 0;
              }
              if (friendsAcceptedHour >= 4) {
                await log("warn", `Friend-accept hourly cap (4) — skipping ${targetUser}`);
              } else if (dmQueueDepth >= MAX_DM_QUEUE) {
                await log("warn", `Friend-accept queue full — skipping ${targetUser}`);
              } else {
                dmQueueDepth++;
                dmQueue = dmQueue
                  .then(async () => {
                    if (stopped || abortSignal.aborted) return;
                    // Long delay before accepting — looks less bot-like
                    await sleep(randomBetween(45_000, 180_000), abortSignal);
                    if (stopped || abortSignal.aborted) return;

                    try {
                      const acceptRes = await fetch(
                        `https://discord.com/api/v9/users/@me/relationships/${userId}`,
                        {
                          method: "PUT",
                          headers: apiHeaders,
                          body: JSON.stringify({}),
                        },
                      );
                      if (!acceptRes.ok) {
                        const text = await acceptRes.text();
                        await log("error", `Failed to accept friend request: ${text.slice(0, 200)}`);
                        return;
                      }
                      friendsAcceptedHour++;
                      await log("info", `Auto-accepted friend request from ${targetUser}`);

                      if (!config.messages?.length) return;
                      // Often skip immediate DM after accept
                      if (Math.random() < 0.45) {
                        await log("info", `Skipping instant DM after accept for ${targetUser}`);
                        return;
                      }
                      await sleep(randomBetween(30_000, 120_000), abortSignal);
                      if (stopped || abortSignal.aborted) return;

                      const dmChannelRes = await fetch(
                        "https://discord.com/api/v9/users/@me/channels",
                        {
                          method: "POST",
                          headers: apiHeaders,
                          body: JSON.stringify({ recipient_id: userId }),
                        },
                      );
                      if (!dmChannelRes.ok) {
                        await log("error", `Failed to open DM channel for ${targetUser}`);
                        return;
                      }
                      const dmChannel = (await dmChannelRes.json()) as { id: string };
                      await sleep(randomBetween(15_000, 45_000), abortSignal);
                      if (stopped || abortSignal.aborted) return;

                      const reply = variateMessage(
                        config.messages[Math.floor(Math.random() * config.messages.length)],
                      );
                      await sleep(randomBetween(5000, 15000), abortSignal);
                      if (stopped || abortSignal.aborted) return;
                      const sendRes = await fetch(
                        `https://discord.com/api/v9/channels/${dmChannel.id}/messages`,
                        {
                          method: "POST",
                          headers: apiHeaders,
                          body: JSON.stringify({
                            content: reply,
                            nonce: String(Date.now() + randomBetween(1000, 9999)),
                            tts: false,
                            flags: 0,
                          }),
                        },
                      );
                      if (sendRes.ok) {
                        await log(
                          "bot",
                          `Sent initial auto-reply to new friend ${targetUser}: "${reply}"`,
                        );
                      } else {
                        const txt = await sendRes.text();
                        await log(
                          "error",
                          `Failed to send initial reply to ${targetUser}: ${txt.slice(0, 200)}`,
                        );
                      }
                    } catch (e) {
                      await log(
                        "error",
                        `Error accepting friend request: ${e instanceof Error ? e.message : String(e)}`,
                      );
                    }
                  })
                  .catch(() => {})
                  .finally(() => {
                    dmQueueDepth = Math.max(0, dmQueueDepth - 1);
                  });
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
