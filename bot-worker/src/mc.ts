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
const MAX_RECONNECT_ATTEMPTS = 5;
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

const MC_SUFFIXES = ["", " ", ".", "...", "!", "?", " ~", " :)"];

function variateMessage(msg: string): string {
  if (Math.random() < 0.3) {
    return msg + pickRandom(MC_SUFFIXES);
  }
  return msg;
}

function calculateMessageDelay(baseInterval: number, sentCount: number): number {
  let min = baseInterval * 0.7;
  let max = baseInterval * 1.5;

  if (sentCount < 3) {
    min = Math.max(min, 8);
    max = Math.max(max, 18);
  }

  const delay = randomBetween(min * 1000, max * 1000);
  const jitter = randomBetween(-2000, 3000);
  return Math.max(3000, delay + jitter);
}

function shouldTakeBreak(sentCount: number): number {
  if (sentCount > 0 && sentCount % randomBetween(12, 25) === 0) {
    return randomBetween(60, 180) * 1000;
  }
  if (Math.random() < 0.06) {
    return randomBetween(30, 90) * 1000;
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

  await log(
    "system",
    `Connecting to ${config.serverHost}:${config.serverPort} (anti-ban mode)...`,
  );

  const mineflayer = await loadMineflayer();

  let sentCount = 0;
  let msgIndex = 0;
  let reconnectAttempts = 0;
  let currentTimer: ReturnType<typeof setTimeout> | null = null;
  let antiAfkTimer: ReturnType<typeof setInterval> | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentBot: any = null;

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
    antiAfkTimer = setInterval(() => {
      if (stopped || abortSignal.aborted) return;
      try {
        if (!bot.entity) return;
        const yaw = bot.entity.yaw + (Math.random() - 0.5) * 0.4;
        const pitch = (Math.random() - 0.5) * 0.3;
        bot.look(yaw, pitch, false);

        if (Math.random() < 0.3) {
          const direction = pickRandom(["forward", "back", "left", "right"]);
          bot.setControlState(direction, true);
          setTimeout(() => {
            try { bot.setControlState(direction, false); } catch { /* ignore */ }
          }, randomBetween(200, 600));
        }

        if (Math.random() < 0.1) {
          bot.setControlState("jump", true);
          setTimeout(() => {
            try { bot.setControlState("jump", false); } catch { /* ignore */ }
          }, 100);
        }
      } catch {
        /* ignore movement errors */
      }
    }, randomBetween(4000, 9000));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function startMessageLoop(bot: any) {
    const scheduleNext = () => {
      if (stopped || abortSignal.aborted) return;

      const breakDuration = shouldTakeBreak(sentCount);
      if (breakDuration > 0) {
        log("info", `Taking a break: ${(breakDuration / 1000).toFixed(0)}s (sent ${sentCount} msgs)`).catch(() => {});
        currentTimer = setTimeout(() => {
          if (stopped || abortSignal.aborted) return;
          sendOneMessage(bot);
        }, breakDuration);
        return;
      }

      const delay = calculateMessageDelay(config.interval, sentCount);
      currentTimer = setTimeout(() => {
        if (stopped || abortSignal.aborted) return;
        sendOneMessage(bot);
      }, delay);
    };

    const sendOneMessage = async (bot: any) => {
      if (stopped || abortSignal.aborted) return;

      try {
        const baseMsg = config.messages[msgIndex % config.messages.length];
        const msg = variateMessage(baseMsg);
        bot.chat(msg);
        sentCount++;
        msgIndex++;
        await log("bot", `> ${msg}`);
      } catch (e) {
        await log("error", `Chat error: ${e instanceof Error ? e.message : String(e)}`);
      }

      scheduleNext();
    };

    const initialDelay = randomBetween(3000, 10000);
    log("info", `Waiting ${(initialDelay / 1000).toFixed(0)}s before first message...`).catch(() => {});
    currentTimer = setTimeout(() => {
      if (stopped || abortSignal.aborted) return;
      sendOneMessage(bot);
    }, initialDelay);
  }

  async function connect() {
    if (stopped || abortSignal.aborted) return;

    const botOptions: Record<string, unknown> = {
      host: config.serverHost,
      port: config.serverPort,
      username: config.authType === "offline" ? config.username || config.label : undefined,
      auth: config.authType === "microsoft" ? "microsoft" : undefined,
      hideErrors: true,
      checkTimeoutInterval: 60000,
      respawn: true,
    };

    if (config.authType === "ssid" && config.ssid) {
      botOptions.auth = "offline";
      botOptions.username = config.username || config.label;
      botOptions.session = {
        accessToken: config.ssid,
        selectedProfile: {
          name: config.username || config.label,
          id: (config.uuid || "").replace(/-/g, ""),
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
      currentBot = null;

      if (reason.toLowerCase().includes("banned")) {
        log("error", "Bot was banned, stopping").catch(() => {});
        await updateJob(jobId, "error", `Banned: ${reason}`);
        stopped = true;
        return;
      }

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !stopped && !abortSignal.aborted) {
        reconnectAttempts++;
        const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1) + randomBetween(0, 3000);
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
      currentBot = null;

      if (stopped || abortSignal.aborted) return;

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1) + randomBetween(0, 3000);
        log("info", `Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`).catch(() => {});
        setTimeout(() => connect(), delay);
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
