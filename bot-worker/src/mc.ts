import { createLogger, updateJob } from "./api.js";

export type McJobConfig = {
  accountId: string;
  label: string;
  serverHost: string;
  serverPort: number;
  authType: "ssid" | "microsoft" | "offline";
  username?: string;
  uuid?: string;
  ssid?: string;
  messages: string[];
  interval: number;
};

const CONNECTION_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 25;
const RECONNECT_BASE_DELAY = 5000;

let mineflayerModule: typeof import("mineflayer") | null = null;

async function loadMineflayer() {
  if (!mineflayerModule) {
    mineflayerModule = await import("mineflayer");
  }
  return mineflayerModule;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function fetchUuidFromUsername(username: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id || null;
  } catch {
    return null;
  }
}

const MC_SUFFIXES = ["", " ", ".", "...", "!", "?", " ~", " :)"];

function variateMessage(msg: string): string {
  if (Math.random() < 0.3) {
    return msg + pickRandom(MC_SUFFIXES);
  }
  return msg;
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function calculateMessageDelay(baseInterval: number, sentCount: number, runtimeMinutes: number): number {
  let min = baseInterval * 0.7;
  let max = baseInterval * 1.5;

  if (sentCount < 3) {
    min = Math.max(min, 8);
    max = Math.max(max, 18);
  }

  const slowdownFactor = 1 + Math.min(runtimeMinutes / 120, 2);
  min *= slowdownFactor;
  max *= slowdownFactor;

  const delay = randomBetween(min * 1000, max * 1000);
  const jitter = randomBetween(-2000, 5000);
  return Math.max(5000, delay + jitter);
}

function shouldTakeBreak(sentCount: number, runtimeMinutes: number): number {
  if (sentCount > 0 && sentCount % randomBetween(10, 20) === 0) {
    return randomBetween(90, 300) * 1000;
  }
  if (Math.random() < 0.05) {
    return randomBetween(60, 180) * 1000;
  }
  return 0;
}

function shouldTakeLongBreak(runtimeMinutes: number, lastLongBreakMin: number): number {
  const sinceLastLongBreak = runtimeMinutes - lastLongBreakMin;
  if (sinceLastLongBreak >= randomBetween(60, 120)) {
    if (Math.random() < 0.3) {
      return randomBetween(600, 1800) * 1000;
    }
  }
  return 0;
}

export async function runMcBot(
  jobId: string,
  discordId: string,
  config: McJobConfig,
  abortSignal: AbortSignal,
): Promise<void> {
  const log = createLogger(jobId, discordId);

  if (!config.serverHost) {
    await log("error", "Missing serverHost");
    await updateJob(jobId, "error", "Missing serverHost");
    return;
  }
  if (!config.messages?.length) {
    await log("error", "No messages configured");
    await updateJob(jobId, "error", "No messages configured");
    return;
  }

  if (config.interval < 5) config.interval = 5;

  if (config.authType === "ssid") {
    if (!config.ssid) {
      await log("error", "SSID token is empty. Re-add your account with a valid SSID.");
      await updateJob(jobId, "error", "SSID token is empty");
      return;
    }
    if (!config.username) {
      await log("error", "Username is required for SSID auth.");
      await updateJob(jobId, "error", "Missing username for SSID auth");
      return;
    }

    if (!config.uuid || config.uuid.replace(/-/g, "").length !== 32) {
      await log("info", "UUID not provided or invalid, fetching from Mojang...");
      const fetchedUuid = await fetchUuidFromUsername(config.username);
      if (fetchedUuid) {
        config.uuid = fetchedUuid;
        await log("info", `Resolved UUID: ${fetchedUuid}`);
      } else {
        await log(
          "error",
          `Could not resolve UUID for "${config.username}". Make sure the username is correct and spelled exactly (case-sensitive).`,
        );
        await updateJob(
          jobId,
          "error",
          `UUID not found for "${config.username}". Check username spelling.`,
        );
        return;
      }
    }
  }

  await log(
    "system",
    `Connecting to ${config.serverHost}:${config.serverPort} (anti-ban mode v2)...`,
  );

  const mineflayer = await loadMineflayer();

  const startedAt = Date.now();
  let sentCount = 0;
  let msgIndex = 0;
  let reconnectAttempts = 0;
  let currentTimer: ReturnType<typeof setTimeout> | null = null;
  let antiAfkTimer: ReturnType<typeof setInterval> | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let authFailed = false;
  let lastLongBreakMin = 0;
  let messageOrder = shuffleArray(config.messages.map((_, i) => i));
  let shufflePosition = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentBot: any = null;

  const runtimeMinutes = () => (Date.now() - startedAt) / 60000;

  const cleanup = () => {
    if (currentTimer) {
      clearTimeout(currentTimer);
      currentTimer = null;
    }
    if (antiAfkTimer) {
      clearInterval(antiAfkTimer);
      antiAfkTimer = null;
    }
  };

  const disconnectBot = () => {
    if (currentBot) {
      try {
        currentBot.removeAllListeners();
        currentBot.end();
      } catch {
        /* ignore disconnect errors */
      }
      currentBot = null;
    }
  };

  abortSignal.addEventListener("abort", () => {
    stopped = true;
    cleanup();
    disconnectBot();
    log("system", "Stop signal received, disconnecting...").catch(() => {});
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function startAntiAfk(bot: any) {
    if (antiAfkTimer) clearInterval(antiAfkTimer);

    let lookOnlyPhase = true;

    antiAfkTimer = setInterval(() => {
      if (stopped || abortSignal.aborted) return;
      try {
        if (!bot.entity) return;

        const yaw = bot.entity.yaw + (Math.random() - 0.5) * 0.4;
        const pitch = (Math.random() - 0.5) * 0.3;
        bot.look(yaw, pitch, false);

        if (!lookOnlyPhase && Math.random() < 0.25) {
          const direction = pickRandom(["forward", "back", "left", "right"]);
          bot.setControlState(direction, true);
          const dur = randomBetween(200, 800);
          setTimeout(() => {
            try {
              if (currentBot === bot) bot.setControlState(direction, false);
            } catch {
              /* ignore */
            }
          }, dur);
        }

        if (!lookOnlyPhase && Math.random() < 0.08) {
          bot.setControlState("jump", true);
          setTimeout(() => {
            try {
              if (currentBot === bot) bot.setControlState("jump", false);
            } catch {
              /* ignore */
            }
          }, 100);
        }

        if (!lookOnlyPhase && Math.random() < 0.05) {
          try {
            bot.setControlState("sneak", true);
            setTimeout(() => {
              try {
                if (currentBot === bot) bot.setControlState("sneak", false);
              } catch {
                /* ignore */
              }
            }, randomBetween(500, 1500));
          } catch {
            /* ignore */
          }
        }

        if (!lookOnlyPhase && Math.random() < 0.04) {
          try {
            const hotbar = bot.inventory?.slots?.slice(36, 45);
            const heldItem = bot.heldItem;
            if (hotbar && hotbar.length > 1) {
              const emptySlot = hotbar.findIndex((s: { type: string } | null) => !s);
              const filledSlot = hotbar.findIndex((s: { type: string } | null) => s && s !== heldItem);
              if (filledSlot >= 0) {
                bot.equip(filledSlot + 36, "hand");
                setTimeout(() => {
                  try {
                    if (emptySlot >= 0) bot.equip(emptySlot + 36, "hand");
                  } catch {
                    /* ignore */
                  }
                }, randomBetween(2000, 5000));
              }
            }
          } catch {
            /* ignore inventory errors */
          }
        }

        if (!lookOnlyPhase && Math.random() < 0.03) {
          try {
            const nearestEntity = bot.nearestEntity(
              (e: { type: string; username?: string }) => e.type === "player" && e.username !== bot.username,
            );
            if (nearestEntity) {
              bot.lookAt(nearestEntity.position.offset(0, 1.6, 0));
              setTimeout(() => {
                try {
                  if (currentBot === bot) {
                    bot.look(
                      bot.entity.yaw + (Math.random() - 0.5) * 2,
                      (Math.random() - 0.5) * 0.3,
                      false,
                    );
                  }
                } catch {
                  /* ignore */
                }
              }, randomBetween(1000, 3000));
            }
          } catch {
            /* ignore entity errors */
          }
        }

        lookOnlyPhase = false;
      } catch {
        /* ignore movement errors */
      }
    }, randomBetween(4000, 10000));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function startMessageLoop(bot: any) {
    const scheduleNext = () => {
      if (stopped || abortSignal.aborted) return;

      const rt = runtimeMinutes();

      const longBreak = shouldTakeLongBreak(rt, lastLongBreakMin);
      if (longBreak > 0) {
        lastLongBreakMin = rt;
        const breakMin = (longBreak / 60000).toFixed(0);
        log("info", `Long AFK break: ${breakMin}min (simulating offline) (runtime: ${rt.toFixed(0)}min)`).catch(() => {});
        currentTimer = setTimeout(() => {
          if (stopped || abortSignal.aborted) return;
          log("info", "Resuming from long break").catch(() => {});
          scheduleNext();
        }, longBreak);
        return;
      }

      const breakDuration = shouldTakeBreak(sentCount, rt);
      if (breakDuration > 0) {
        log("info", `Taking a break: ${(breakDuration / 1000).toFixed(0)}s (sent ${sentCount} msgs, runtime ${rt.toFixed(0)}min)`).catch(() => {});
        currentTimer = setTimeout(() => {
          if (stopped || abortSignal.aborted) return;
          sendOneMessage(bot);
        }, breakDuration);
        return;
      }

      const delay = calculateMessageDelay(config.interval, sentCount, rt);
      log("info", `Next message in ${(delay / 1000).toFixed(0)}s (sent ${sentCount}, runtime ${rt.toFixed(0)}min)`).catch(() => {});
      currentTimer = setTimeout(() => {
        if (stopped || abortSignal.aborted) return;
        sendOneMessage(bot);
      }, delay);
    };

    const sendOneMessage = async (botArg: typeof bot) => {
      if (stopped || abortSignal.aborted) return;

      try {
        if (shufflePosition >= messageOrder.length) {
          messageOrder = shuffleArray(config.messages.map((_, i) => i));
          shufflePosition = 0;
        }
        const baseMsg = config.messages[messageOrder[shufflePosition] % config.messages.length];
        shufflePosition++;
        const msg = variateMessage(baseMsg);
        botArg.chat(msg);
        sentCount++;
        await log("bot", `> ${msg}`);
      } catch (e) {
        await log("error", `Chat error: ${e instanceof Error ? e.message : String(e)}`);
      }

      scheduleNext();
    };

    const initialDelay = randomBetween(8000, 25000);
    log("info", `Waiting ${(initialDelay / 1000).toFixed(0)}s before first message...`).catch(() => {});
    currentTimer = setTimeout(() => {
      if (stopped || abortSignal.aborted) return;
      sendOneMessage(bot);
    }, initialDelay);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function shouldReconnect(kickReason: string): boolean {
    const lower = kickReason.toLowerCase();
    if (lower.includes("banned")) return false;
    if (lower.includes("authenticat")) return false;
    if (lower.includes("failed to verify")) return false;
    if (lower.includes("not authenticated")) return false;
    if (lower.includes("invalid session")) return false;
    if (lower.includes("whitelist")) return false;
    if (lower.includes("full")) return false;
    return true;
  }

  async function connect() {
    if (stopped || abortSignal.aborted || authFailed) return;

    const botOptions: Record<string, unknown> = {
      host: config.serverHost,
      port: config.serverPort,
      username: config.authType === "offline" ? config.username || config.label : undefined,
      auth: config.authType === "microsoft" ? "microsoft" : undefined,
      authOptions: config.authType === "microsoft" ? {
        deviceCodeCallback: (info: { verification_uri: string; user_code: string; expires_in: number }) => {
          console.log("");
          console.log("╔══════════════════════════════════════════════════╗");
          console.log("║        🔐  MICROSOFT AUTHORIZATION REQUIRED     ║");
          console.log("╠══════════════════════════════════════════════════╣");
          console.log("║                                                  ║");
          console.log(`║  Step 1: Open this link:                         ║`);
          console.log(`║  ${info.verification_uri.padEnd(46)}║`);
          console.log("║                                                  ║");
          console.log(`║  Step 2: Enter this code:                        ║`);
          console.log(`║  ${info.user_code.padEnd(46)}║`);
          console.log("║                                                  ║");
          console.log("║  Step 3: Sign in with your Microsoft account    ║");
          console.log('║  Step 4: Click "Authorize" when prompted         ║');
          console.log("║                                                  ║");
          console.log(`║  ⏳ Expires in ${(info.expires_in / 60).toFixed(0)} minutes. Waiting...     ║`);
          console.log("╚══════════════════════════════════════════════════╝");
          console.log("");
        },
      } : undefined,
      hideErrors: true,
      checkTimeoutInterval: 60000,
      respawn: false,
    };

    if (config.authType === "ssid" && config.ssid) {
      const cleanUuid = (config.uuid || "").replace(/-/g, "");
      const profileName = config.username || config.label;

      if (!cleanUuid || cleanUuid.length !== 32) {
        await log(
          "error",
          `Invalid UUID format: "${config.uuid}". Must be 32 hex characters.`,
        );
        await updateJob(jobId, "error", "Invalid UUID format");
        authFailed = true;
        return;
      }

      botOptions.auth = "offline";
      botOptions.username = profileName;
      botOptions.session = {
        accessToken: config.ssid,
        selectedProfile: {
          name: profileName,
          id: cleanUuid,
        },
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bot = (mineflayer as any).createBot(botOptions);
    currentBot = bot;

    let connected = false;

    bot.on("login", () => {
      connected = true;
      reconnectAttempts = 0;
      log("info", `Logged in as ${bot.username}`).catch(() => {});
    });

    bot.on("spawn", () => {
      log("info", "Spawned in world").catch(() => {});
      updateJob(jobId, "running").catch(() => {});
      reconnectAttempts = 0;

      startAntiAfk(bot);
      startMessageLoop(bot);
    });

    bot.on("chat", (username: string, message: string) => {
      if (username === bot.username) return;
      log("chat", `<${username}> ${message}`).catch(() => {});
    });

    bot.on("whisper", (username: string, message: string) => {
      log("chat", `[whisper] <${username}> ${message}`).catch(() => {});
    });

    bot.on("error", (err: Error) => {
      log("error", `Error: ${err.message}`).catch(() => {});
    });

    bot.on("kicked", async (reason: string) => {
      log("warn", `Kicked: ${reason}`).catch(() => {});
      cleanup();
      if (currentBot === bot) currentBot = null;

      const doReconnect = shouldReconnect(reason);
      if (!doReconnect) {
        const msg = reason.toLowerCase().includes("authenticat")
          ? `Authentication failed: ${reason}. Your SSID token may be expired — re-login to Minecraft and get a new token.`
          : reason.toLowerCase().includes("banned")
            ? `Banned: ${reason}`
            : `Not reconnecting: ${reason}`;
        log("error", msg).catch(() => {});
        await updateJob(jobId, "error", msg);
        authFailed = true;
        stopped = true;
        return;
      }

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !stopped && !abortSignal.aborted) {
        reconnectAttempts++;
        const baseDelay = reconnectAttempts <= 3
          ? RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1)
          : randomBetween(30, 120) * 1000;
        const delay = baseDelay + randomBetween(0, 5000);
        log("info", `Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`).catch(() => {});
        setTimeout(() => connect(), delay);
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        log("error", "Max reconnect attempts reached").catch(() => {});
        await updateJob(jobId, "error", "Max reconnect attempts");
        stopped = true;
      }
    });

    bot.on("end", async (reason: string) => {
      log("system", `Disconnected: ${reason || "connection closed"}`).catch(() => {});
      cleanup();
      if (currentBot === bot) currentBot = null;

      if (stopped || abortSignal.aborted || authFailed) return;

      if (shouldReconnect(reason) && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const baseDelay = reconnectAttempts <= 3
          ? RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1)
          : randomBetween(30, 120) * 1000;
        const delay = baseDelay + randomBetween(0, 5000);
        log("info", `Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`).catch(() => {});
        setTimeout(() => connect(), delay);
      } else if (!shouldReconnect(reason)) {
        log("error", `Connection lost: ${reason} — not reconnecting`).catch(() => {});
        await updateJob(jobId, "error", reason);
        stopped = true;
      } else {
        log("error", "Max reconnect attempts reached").catch(() => {});
        await updateJob(jobId, "error", "Connection lost");
        stopped = true;
      }
    });

    bot.on("death", () => {
      log("warn", "Bot died, respawning...").catch(() => {});
    });

    const connectionTimeout = setTimeout(() => {
      if (!connected && !stopped) {
        log("error", "Connection timed out").catch(() => {});
        cleanup();
        disconnectBot();
      }
    }, CONNECTION_TIMEOUT_MS);

    bot.on("end", () => {
      clearTimeout(connectionTimeout);
    });
  }

  connect();

  cleanupTimer = setInterval(() => {
    if (abortSignal.aborted && !stopped) {
      stopped = true;
      cleanup();
      disconnectBot();
      if (cleanupTimer) clearInterval(cleanupTimer);
    }
  }, 1000);

  return new Promise((resolve) => {
    const checkDone = setInterval(() => {
      if (abortSignal.aborted || stopped) {
        clearInterval(checkDone);
        cleanup();
        disconnectBot();
        if (cleanupTimer) clearInterval(cleanupTimer);
        resolve();
      }
    }, 1000);
  });
}
