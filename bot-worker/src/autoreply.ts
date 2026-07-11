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

  await log("system", "Initializing Discord Auto-Reply Gateway client...");
  await updateJob(jobId, "running");

  let ws: WebSocket | null = null;
  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let selfUserId: string | null = null;
  let lastSequence: number | null = null;
  let sessionId: string | null = null;

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

        // Op 10: Hello
        if (op === 10) {
          const heartbeatInterval = d.heartbeat_interval;
          startHeartbeat(heartbeatInterval);

          // Identify or Resume
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

        // Op 9: Invalid Session
        if (op === 9) {
          sessionId = null;
          lastSequence = null;
          log("warn", "Invalid gateway session, re-identifying...").catch(() => {});
          await sleep(2000);
          ws?.close();
        }

        // Event Dispatch (Op 0)
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
            // Check if it's a DM (no guild_id)
            if (!d.guild_id && d.author.id !== selfUserId && !d.author.bot) {
              const channelId = d.channel_id;
              const authorTag = `@${d.author.username}`;
              await log("chat", `DM from ${authorTag}: "${d.content}"`);

              // Choose random reply message
              const reply = config.messages[Math.floor(Math.random() * config.messages.length)];

              const delay = randomBetween(config.minDelay * 1000, config.maxDelay * 1000);

              if (config.typing) {
                // Send typing
                await fetch(`https://discord.com/api/v9/channels/${channelId}/typing`, {
                  method: "POST",
                  headers: { Authorization: config.token },
                }).catch(() => {});
                await log(
                  "info",
                  `Typing simulation active... replying in ${(delay / 1000).toFixed(1)}s`,
                );
              } else {
                await log("info", `Replying in ${(delay / 1000).toFixed(1)}s`);
              }

              setTimeout(async () => {
                if (stopped) return;
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
                    await log("bot", `Sent auto-reply to ${authorTag}: "${reply}"`);
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
              }, delay);
            }
          }

          if (t === "RELATIONSHIP_ADD" && config.autoAcceptFriends) {
            // Check if relationship is incoming (type 3)
            if (d.type === 3) {
              const targetUser = `@${d.user.username}`;
              await log("info", `Received incoming friend request from ${targetUser}`);

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

    ws.on("close", async (code, reason) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (stopped) return;

      log(
        "warn",
        `Gateway WebSocket closed (code ${code}): ${reason || "No reason"}. Reconnecting in 5s...`,
      ).catch(() => {});
      await sleep(5000);
      connectGateway();
    });

    ws.on("error", (err) => {
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
