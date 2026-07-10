import { botManager } from "../bot-manager.server";

export type DiscordSpamConfig = {
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

let discordModule: typeof import("discord.js") | null = null;

async function loadDiscord() {
  if (!discordModule) {
    discordModule = await import("discord.js");
  }
  return discordModule;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startDiscordSpam(userId: string, config: DiscordSpamConfig): Promise<string> {
  const botId = `dc_spam_${userId}_${Date.now()}`;

  botManager.create(botId, "discord", userId, `Spam-${config.channelId}`, config as unknown as Record<string, unknown>);
  botManager.setStatus(botId, "connecting");
  botManager.log(botId, "system", "Initializing Discord client...");

  const { Client, GatewayIntentBits } = await loadDiscord();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  botManager.setRuntime(botId, client);

  let stopped = false;

  client.once("ready", async () => {
    botManager.log(botId, "info", `Logged in as ${client.user?.tag}`);
    botManager.setStatus(botId, "running");

    let channel;
    try {
      channel = await client.channels.fetch(config.channelId);
    } catch (e) {
      botManager.log(botId, "error", `Failed to fetch channel: ${e instanceof Error ? e.message : String(e)}`);
      botManager.setStatus(botId, "error", "Channel not found");
      client.destroy();
      return;
    }

    if (!channel || !("send" in channel)) {
      botManager.log(botId, "error", "Channel not found or not a text channel");
      botManager.setStatus(botId, "error", "Invalid channel");
      client.destroy();
      return;
    }

    botManager.log(botId, "info", `Target: #${(channel as { name?: string }).name || config.channelId}`);
    botManager.log(botId, "system", `Spamming ${config.messages.length} message(s) every ~${config.interval}s`);

    let msgIndex = 0;
    let sentCount = 0;
    let failCount = 0;
    const startTime = Date.now();

    const sendNext = async () => {
      if (stopped || botManager.get(botId)?.status !== "running") return;

      const msg = config.messages[msgIndex % config.messages.length];
      msgIndex++;

      try {
        const sent = await channel.send(msg);
        sentCount++;
        botManager.log(botId, "bot", `> ${msg}`);

        if (config.deleteAfterSend) {
          setTimeout(async () => {
            try {
              await sent.delete();
              botManager.log(botId, "info", "Deleted sent message");
            } catch {
              // message might already be deleted
            }
          }, randomBetween(1000, 3000));
        }
      } catch (e) {
        failCount++;
        const errMsg = e instanceof Error ? e.message : String(e);
        botManager.log(botId, "error", `Send failed: ${errMsg}`);

        if (errMsg.includes("rate limit") || errMsg.includes("429")) {
          const retryAfter = 10000 + randomBetween(0, 5000);
          botManager.log(botId, "warn", `Rate limited, waiting ${retryAfter}ms`);
          await sleep(retryAfter);
        }

        if (failCount > 20) {
          botManager.log(botId, "error", "Too many failures, stopping");
          botManager.setStatus(botId, "error", "Too many send failures");
          stopped = true;
          client.destroy();
          return;
        }
      }

      if (stopped || botManager.get(botId)?.status !== "running") return;

      const runtime = config.humanize
        ? randomBetween(config.minDelay * 1000, config.maxDelay * 1000)
        : config.interval * 1000;

      botManager.log(botId, "info", `Next message in ${(runtime / 1000).toFixed(1)}s`);
      setTimeout(sendNext, runtime);
    };

    sendNext();

    const runtimeMinutes = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 60000);
      botManager.log(botId, "info", `Runtime: ${elapsed}m | Sent: ${sentCount} | Failed: ${failCount}`);
    };

    setInterval(() => {
      if (!stopped && botManager.get(botId)?.status === "running") {
        runtimeMinutes();
      }
    }, 300000);
  });

  client.on("error", (err: Error) => {
    botManager.log(botId, "error", `Client error: ${err.message}`);
  });

  client.on("warn", (info: string) => {
    botManager.log(botId, "warn", info);
  });

  client.on("disconnect", () => {
    if (!stopped) {
      botManager.log(botId, "warn", "Disconnected from Discord");
      botManager.setStatus(botId, "error", "Disconnected");
      stopped = true;
    }
  });

  try {
    await client.login(config.token);
    return botId;
  } catch (err) {
    botManager.setStatus(botId, "error", err instanceof Error ? err.message : String(err));
    botManager.log(botId, "error", `Login failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

export async function stopDiscordSpam(botId: string): Promise<boolean> {
  return botManager.stop(botId);
}

export function getDiscordSpamStatus(botId: string) {
  const instance = botManager.get(botId);
  if (!instance) return null;
  return {
    id: botId,
    status: instance.status,
    label: instance.label,
    error: instance.error,
    startedAt: instance.startedAt,
    config: instance.config,
  };
}
