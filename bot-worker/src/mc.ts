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

let mineflayerModule: typeof import("mineflayer") | null = null;

async function loadMineflayer() {
  if (!mineflayerModule) {
    mineflayerModule = await import("mineflayer");
  }
  return mineflayerModule;
}

export async function runMcBot(
  jobId: string,
  discordId: string,
  config: McJobConfig,
  abortSignal: AbortSignal
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

  await log("system", `Connecting to ${config.serverHost}:${config.serverPort}...`);

  const mineflayer = await loadMineflayer();

  const botOptions: Record<string, unknown> = {
    host: config.serverHost,
    port: config.serverPort,
    username:
      config.authType === "offline"
        ? config.username || config.label
        : undefined,
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

  let sendInterval: ReturnType<typeof setInterval> | null = null;
  let msgIndex = 0;

  const cleanup = () => {
    if (sendInterval) {
      clearInterval(sendInterval);
      sendInterval = null;
    }
  };

  abortSignal.addEventListener("abort", () => {
    cleanup();
    log("system", "Stop signal received, disconnecting...").catch(() => {});
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bot = (mineflayer as any).createBot(botOptions);

  let connected = false;

  bot.on("login", () => {
    connected = true;
    log("info", `Logged in as ${bot.username}`).catch(() => {});
  });

  bot.on("spawn", () => {
    log("info", "Spawned in world").catch(() => {});
    updateJob(jobId, "running").catch(() => {});

    if (config.messages.length > 0 && config.interval > 0) {
      const sendNext = async () => {
        if (abortSignal.aborted) return;
        const msg = config.messages[msgIndex % config.messages.length];
        bot.chat(msg);
        await log("bot", `> ${msg}`);
        msgIndex++;
      };

      sendNext().catch(() => {});
      sendInterval = setInterval(() => {
        if (abortSignal.aborted) {
          if (sendInterval) clearInterval(sendInterval);
          return;
        }
        sendNext().catch(() => {});
      }, config.interval * 1000);
    }
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

  bot.on("kicked", (reason: string) => {
    log("error", `Kicked: ${reason}`).catch(() => {});
    cleanup();
  });

  bot.on("end", (reason: string) => {
    log("system", `Disconnected: ${reason || "connection closed"}`).catch(() => {});
    cleanup();
  });

  bot.on("death", () => {
    log("warn", "Bot died, respawning...").catch(() => {});
  });

  return new Promise((resolve) => {
    const checkAbort = setInterval(() => {
      if (abortSignal.aborted) {
        clearInterval(checkAbort);
        cleanup();
        bot.end();
        resolve();
      }
    }, 1000);

    const connectionTimeout = setTimeout(() => {
      if (!connected) {
        log("error", "Connection timed out").catch(() => {});
        cleanup();
        bot.end();
        clearInterval(checkAbort);
        resolve();
      }
    }, CONNECTION_TIMEOUT_MS);

    bot.on("end", () => {
      clearTimeout(connectionTimeout);
      clearInterval(checkAbort);
      resolve();
    });
  });
}
