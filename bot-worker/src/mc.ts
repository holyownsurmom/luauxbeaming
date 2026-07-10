import { db } from "./supabase.js";

export type McJobConfig = {
  accountId: string;
  label: string;
  serverHost: string;
  serverPort: number;
  authType: "ssid" | "microsoft" | "offline";
  username?: string;
  ssid?: string;
  messages: string[];
  interval: number;
};

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
  const log = async (level: string, message: string) => {
    await db.from("bot_logs").insert({
      job_id: jobId,
      discord_id: discordId,
      level,
      message,
    });
  };

  const setStatus = async (status: string, error?: string) => {
    const update: Record<string, unknown> = { status };
    if (error) update.error = error;
    if (status === "running") update.started_at = new Date().toISOString();
    if (status === "stopped" || status === "error") update.stopped_at = new Date().toISOString();
    await db.from("bot_jobs").update(update).eq("id", jobId);
  };

  await log("system", `Connecting to ${config.serverHost}:${config.serverPort}...`);
  await setStatus("running");

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
      selectedProfile: { name: config.username || config.label },
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

  abortSignal.addEventListener("abort", async () => {
    cleanup();
    await log("system", "Stop signal received, disconnecting...");
  });

  const bot = mineflayer.createBot(botOptions as never);

  bot.on("login", async () => {
    await log("info", `Logged in as ${bot.username}`);
  });

  bot.on("spawn", async () => {
    await log("info", "Spawned in world");
    await setStatus("running");

    if (config.messages.length > 0 && config.interval > 0) {
      const sendNext = async () => {
        if (abortSignal.aborted) return;
        const msg = config.messages[msgIndex % config.messages.length];
        bot.chat(msg);
        await log("bot", `> ${msg}`);
        msgIndex++;
      };

      await sendNext();
      sendInterval = setInterval(() => {
        if (abortSignal.aborted) {
          if (sendInterval) clearInterval(sendInterval);
          return;
        }
        sendNext();
      }, config.interval * 1000);
    }
  });

  bot.on("chat", async (username: string, message: string) => {
    if (username === bot.username) return;
    await log("chat", `<${username}> ${message}`);
  });

  bot.on("whisper", async (username: string, message: string) => {
    await log("chat", `[whisper] <${username}> ${message}`);
  });

  bot.on("error", async (err: Error) => {
    await log("error", `Error: ${err.message}`);
  });

  bot.on("kicked", async (reason: string) => {
    await log("error", `Kicked: ${reason}`);
    cleanup();
    await setStatus("error", reason);
  });

  bot.on("end", async (reason: string) => {
    await log("system", `Disconnected: ${reason || "connection closed"}`);
    cleanup();
    if (!abortSignal.aborted) {
      await setStatus("stopped");
    }
  });

  bot.on("death", async () => {
    await log("warn", "Bot died, respawning...");
  });

  bot.on("error", () => {});

  return new Promise((resolve) => {
    const checkAbort = setInterval(() => {
      if (abortSignal.aborted) {
        clearInterval(checkAbort);
        cleanup();
        bot.end();
        resolve();
      }
    }, 1000);

    bot.on("end", () => {
      clearInterval(checkAbort);
      resolve();
    });
  });
}
