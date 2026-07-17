import WebSocket from "ws";
import { createLogger, updateJob } from "./api.js";
import {
  circadianMultiplier,
  createSessionBrowser,
  humanNonce,
  isQuietHours,
  messageFingerprint,
  pickRandom,
  quietHoursExtraMs,
  randomBetween,
  sendWithRetry,
  sleep,
  typingDurationMs,
  variateMessage,
} from "./discord-humanize.js";

export type AutoReplyJobConfig = {
  token: string;
  messages: string[];
  minDelay: number;
  maxDelay: number;
  typing: boolean;
  autoAcceptFriends: boolean;
};

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

  // Anti-ban v7 floors — sub-40s replies are a ban magnet
  const minDelaySec = (() => {
    const n = Number(config.minDelay);
    if (!Number.isFinite(n) || n < 40) return 60;
    return Math.min(86_400, Math.floor(n));
  })();
  const maxDelaySec = (() => {
    const n = Number(config.maxDelay);
    const floor = minDelaySec + 40;
    if (!Number.isFinite(n) || n < floor) return Math.max(floor, 180);
    return Math.min(86_400, Math.floor(n));
  })();
  config.minDelay = minDelaySec;
  config.maxDelay = maxDelaySec;
  // Typing indicator API is a self-bot fingerprint — default off, rare if forced on
  config.typing = config.typing === true;
  config.autoAcceptFriends = !!config.autoAcceptFriends;

  const sessionBrowser = createSessionBrowser();
  const apiHeaders = sessionBrowser.headers(config.token);
  const chromeUa = sessionBrowser.userAgent;
  const DAILY_REPLY_CAP = randomBetween(22, 45);
  let repliesToday = 0;
  let dayStart = Date.now();
  const recentReplyFingerprints: string[] = [];

  await log("system", "Initializing Discord Auto-Reply Gateway client (anti-ban mode v7)...");
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
    recentReplyTimes = recentReplyTimes.filter((t) => now - t < 3_600_000);
    // Allow multiple people: max 3 / 2 min, max 20 / hour (still safer than spam)
    if (recentReplyTimes.filter((t) => now - t < 120_000).length >= 3) return true;
    if (recentReplyTimes.length >= 20) return true;
    return false;
  };

  const shouldMissReply = (): boolean => {
    // Low miss rate — still reply to most people (was skipping too many as "last only")
    if (replyCount < 2) return false;
    return Math.random() < 0.08;
  };

  let repliesSinceAfk = 0;
  let afkEvery = randomBetween(5, 12);
  const repliedUsers = new Map<string, number>(); // userId -> last reply ts
  let friendsAcceptedHour = 0;
  let friendsHourStart = Date.now();
  let consecutiveRateLimits = 0;

  const shouldGoAway = (): boolean => {
    const now = Date.now();
    if (now < longAwayUntil) return true;
    // Quiet hours → long offline
    if (isQuietHours()) {
      const extra = quietHoursExtraMs();
      if (extra > 0) {
        longAwayUntil = now + extra;
        log("info", `Quiet hours AFK ${((extra / 60000) | 0)}min`).catch(() => {});
        return true;
      }
    }
    if (repliesSinceAfk >= afkEvery) {
      repliesSinceAfk = 0;
      afkEvery = randomBetween(5, 12);
      longAwayUntil = now + randomBetween(360_000, 1_800_000);
      log("info", `Going AFK for ${((longAwayUntil - now) / 60000) | 0}min (simulating offline)`).catch(() => {});
      return true;
    }
    // Random "left Discord" windows
    if (replyCount >= 4 && Math.random() < 0.07) {
      longAwayUntil = now + randomBetween(20 * 60_000, 75 * 60_000);
      log("info", `Random offline window ${(((longAwayUntil - now) / 60000) | 0)}min`).catch(() => {});
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
            let warm = randomBetween(300_000, 900_000);
            warm = Math.floor(warm * circadianMultiplier());
            if (isQuietHours()) warm += quietHoursExtraMs();
            longAwayUntil = Date.now() + warm;
            await log(
              "info",
              `Warmup AFK ${(warm / 60000).toFixed(1)}min before first reply (anti-ban v7) | daily cap ~${DAILY_REPLY_CAP}`,
            );
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

                  // Reset daily counter after 24h
                  if (Date.now() - dayStart > 86_400_000) {
                    repliesToday = 0;
                    dayStart = Date.now();
                  }
                  if (repliesToday >= DAILY_REPLY_CAP) {
                    await log("info", `Daily reply cap (${DAILY_REPLY_CAP}) — skipping`);
                    return;
                  }

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
                    await log("info", "Throttled (rate / hourly budget), skipping this message");
                    return;
                  }

                  const authorId = String(d.author.id || "");
                  // Short per-user gap only (anti double-tap) — reply to EVERYONE, not just one person
                  const lastToUser = repliedUsers.get(authorId) || 0;
                  const userCd = randomBetween(8_000, 25_000);
                  if (authorId && Date.now() - lastToUser < userCd) {
                    await log("info", `Brief cooldown for ${authorTag} — skip duplicate`);
                    return;
                  }

                  // Ignore empty messages only
                  if (content && content.trim().length < 1) {
                    return;
                  }

                  let reply = variateMessage(
                    config.messages[Math.floor(Math.random() * config.messages.length)],
                  );
                  let rfp = messageFingerprint(reply);
                  let rtry = 0;
                  while (rtry < 3 && recentReplyFingerprints.includes(rfp)) {
                    reply = variateMessage(
                      config.messages[Math.floor(Math.random() * config.messages.length)],
                    );
                    rfp = messageFingerprint(reply);
                    rtry++;
                  }

                  let delay = randomBetween(minDelaySec * 1000, maxDelaySec * 1000);
                  delay = Math.floor(delay * circadianMultiplier());
                  // First few replies still a bit slower, but not multi-minute (so all DMers get answers)
                  if (replyCount < 3) {
                    delay = Math.max(delay, randomBetween(45_000, 90_000));
                  } else if (Math.random() < 0.12) {
                    delay = randomBetween(90_000, 180_000);
                    await log("info", `Long random pause: ${(delay / 1000).toFixed(0)}s`);
                  }

                  // Typing API only rarely (fingerprint) — sleep still simulates think time
                  const useTyping = config.typing && Math.random() < 0.08;
                  const typingTime = useTyping
                    ? typingDurationMs(reply, 3500, 16_000)
                    : randomBetween(8000, 28_000);
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
                  // Re-check throttle after wait (other replies may have fired)
                  if (shouldThrottle() || shouldGoAway()) {
                    await log("info", "Post-wait throttle/AFK — dropping reply");
                    return;
                  }

                  try {
                    const res = await sendWithRetry(
                      `https://discord.com/api/v9/channels/${channelId}/messages`,
                      {
                        method: "POST",
                        headers: apiHeaders,
                        body: JSON.stringify({
                          content: reply,
                          nonce: humanNonce(),
                          tts: false,
                          flags: 0,
                        }),
                      },
                      1,
                      abortSignal,
                    );

                    if (!res) {
                      await log("error", "Failed to send auto-reply: network error");
                      return;
                    }
                    if (res.ok) {
                      replyCount++;
                      repliesToday++;
                      repliesSinceAfk++;
                      consecutiveRateLimits = 0;
                      if (authorId) repliedUsers.set(authorId, Date.now());
                      recentReplyTimes.push(Date.now());
                      recentReplyFingerprints.push(rfp);
                      if (recentReplyFingerprints.length > 20) recentReplyFingerprints.shift();
                      await log("bot", `Sent auto-reply to ${authorTag}: "${reply}"`);
                      return;
                    }
                    if (res.captcha) {
                      await log(
                        "error",
                        "Discord requires captcha on this account — token is flagged. Stop using it; switch to a fresh alt. Not a LuauX bug.",
                      );
                      await updateJob(
                        jobId,
                        "error",
                        "Discord captcha-required (account flagged). Use a different alt token.",
                      );
                      stopped = true;
                      return;
                    }
                    if (res.status === 429 || res.rateLimited) {
                      consecutiveRateLimits++;
                      await log(
                        "warn",
                        `Rate limited on reply (#${consecutiveRateLimits})${res.global ? " [global]" : ""}`,
                      );
                      if (consecutiveRateLimits >= 2) {
                        longAwayUntil = Date.now() + randomBetween(30 * 60_000, 90 * 60_000);
                        consecutiveRateLimits = 0;
                        await log("warn", "Repeated RL — going AFK 30–90min to protect token");
                      }
                      return;
                    }
                    if (res.status === 401 || res.status === 403) {
                      await log("error", "Token revoked or access denied. Stopping.");
                      await updateJob(jobId, "error", "Token invalid or banned");
                      stopped = true;
                      return;
                    }
                    await log("error", `Failed to send auto-reply: ${res.body.slice(0, 300)}`);
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
              if (friendsAcceptedHour >= 2) {
                await log("warn", `Friend-accept hourly cap (2) — skipping ${targetUser}`);
              } else if (isQuietHours()) {
                await log("info", `Quiet hours — not accepting friends now (${targetUser})`);
              } else if (dmQueueDepth >= MAX_DM_QUEUE) {
                await log("warn", `Friend-accept queue full — skipping ${targetUser}`);
              } else if (Math.random() < 0.35) {
                await log("info", `Skipping friend request from ${targetUser} (human ignore)`);
              } else {
                dmQueueDepth++;
                dmQueue = dmQueue
                  .then(async () => {
                    if (stopped || abortSignal.aborted) return;
                    // Long delay before accepting — looks less bot-like
                    await sleep(randomBetween(180_000, 720_000), abortSignal);
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
                      // Usually skip immediate DM after accept (ban signal)
                      if (Math.random() < 0.72) {
                        await log("info", `Skipping instant DM after accept for ${targetUser}`);
                        return;
                      }
                      await sleep(randomBetween(90_000, 300_000), abortSignal);
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
                      await sleep(randomBetween(30_000, 90_000), abortSignal);
                      if (stopped || abortSignal.aborted) return;

                      const reply = variateMessage(
                        config.messages[Math.floor(Math.random() * config.messages.length)],
                      );
                      await sleep(randomBetween(8000, 25_000), abortSignal);
                      if (stopped || abortSignal.aborted) return;
                      const sendRes = await fetch(
                        `https://discord.com/api/v9/channels/${dmChannel.id}/messages`,
                        {
                          method: "POST",
                          headers: apiHeaders,
                          body: JSON.stringify({
                            content: reply,
                            nonce: humanNonce(),
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
                        if (/captcha/i.test(txt)) {
                          await log(
                            "error",
                            "Discord captcha on friend-DM — account flagged. Stopping. Use a fresh alt; disable auto-accept friends.",
                          );
                          await updateJob(
                            jobId,
                            "error",
                            "Discord captcha-required after friend accept (account flagged).",
                          );
                          stopped = true;
                          return;
                        }
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
