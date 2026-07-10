import { db } from "./supabase.js";

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

let discordModule: typeof import("discord.js") | null = null;

async function loadDiscord() {
  if (!discordModule) {
    discordModule = await import("discord.js");
  }
  return discordModule;
}

export async function runDiscordBot(
  jobId: string,
  discordId: string,
  config: DiscordJobConfig,
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

  await log("system", "Initializing Discord client...");
  await setStatus("running");

  const { Client, GatewayIntentBits } = await loadDiscord();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  let stopped = false;

  abortSignal.addEventListener("abort", async () => {
    stopped = true;
    await log("system", "Stop signal received, destroying client...");
    try { client.destroy(); } catch {}
  });

  client.once("ready", async () => {
    await log("info", `Logged in as ${client.user?.tag}`);

    let channel;
    try {
      channel = await client.channels.fetch(config.channelId);
    } catch (e) {
      await log("error", `Failed to fetch channel: ${e instanceof Error ? e.message : String(e)}`);
      await setStatus("error", "Channel not found");
      client.destroy();
      return;
    }

    if (!channel || !("send" in channel)) {
      await log("error", "Channel not found or not a text channel");
      await setStatus("error", "Invalid channel");
      client.destroy();
      return;
    }

    await log("info", `Target: #${(channel as { name?: string }).name || config.channelId}`);
    await log("system", `Spamming ${config.messages.length} message(s) every ~${config.interval}s`);

    let msgIndex = 0;
    let sentCount = 0;
    let failCount = 0;

    const sendNext = async () => {
      if (stopped) return;

      const msg = config.messages[msgIndex % config.messages.length];
      msgIndex++;

      try {
        const sent = await channel.send(msg);
        sentCount++;
        await log("bot", `> ${msg}`);

        if (config.deleteAfterSend) {
          setTimeout(async () => {
            try { await sent.delete(); } catch {}
          }, randomBetween(1000, 3000));
        }
      } catch (e) {
        failCount++;
        const errMsg = e instanceof Error ? e.message : String(e);
        await log("error", `Send failed: ${errMsg}`);

        if (errMsg.includes("rate limit") || errMsg.includes("429")) {
          const retryAfter = 10000 + randomBetween(0, 5000);
          await log("warn", `Rate limited, waiting ${retryAfter}ms`);
          await sleep(retryAfter);
        }

        if (failCount > 20) {
          await log("error", "Too many failures, stopping");
          await setStatus("error", "Too many send failures");
          stopped = true;
          client.destroy();
          return;
        }
      }

      if (stopped) return;

      const runtime = config.humanize
        ? randomBetween(config.minDelay * 1000, config.maxDelay * 1000)
        : config.interval * 1000;

      await log("info", `Next message in ${(runtime / 1000).toFixed(1)}s`);

      const timer = setTimeout(sendNext, runtime);
      abortSignal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    };

    sendNext();

    const runtimeMinutes = setInterval(() => {
      if (!stopped) {
        log("info", `Runtime: ${Math.floor(process.uptime() / 60)}m | Sent: ${sentCount} | Failed: ${failCount}`);
      }
    }, 300000);

    abortSignal.addEventListener("abort", () => clearInterval(runtimeMinutes), { once: true });
  });

  client.on("error", async (err: Error) => {
    await log("error", `Client error: ${err.message}`);
  });

  client.on("warn", async (info: string) => {
    await log("warn", info);
  });

  client.on("disconnect", async () => {
    if (!stopped) {
      await log("warn", "Disconnected from Discord");
      await setStatus("error", "Disconnected");
      stopped = true;
    }
  });

  try {
    await client.login(config.token);
  } catch (err) {
    await setStatus("error", err instanceof Error ? err.message : String(err));
    await log("error", `Login failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  return new Promise((resolve) => {
    const checkAbort = setInterval(() => {
      if (abortSignal.aborted || stopped) {
        clearInterval(checkAbort);
        try { client.destroy(); } catch {}
        resolve();
      }
    }, 1000);
  });
}
