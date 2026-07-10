import { botManager } from "../bot-manager.server";

export type McBotConfig = {
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

export async function startMcBot(userId: string, config: McBotConfig): Promise<string> {
  const botId = `mc_${userId}_${config.accountId}`;

  const existing = botManager.get(botId);
  if (existing && (existing.status === "running" || existing.status === "connecting")) {
    throw new Error("Bot is already running for this account");
  }

  botManager.create(botId, "mc", userId, config.label, config as unknown as Record<string, unknown>);
  botManager.setStatus(botId, "connecting");
  botManager.log(botId, "system", `Connecting to ${config.serverHost}:${config.serverPort}...`);

  const mineflayer = await loadMineflayer();

  const botOptions: Record<string, unknown> = {
    host: config.serverHost,
    port: config.serverPort,
    username: config.authType === "offline" ? (config.username || config.label) : undefined,
    auth: config.authType === "microsoft" ? "microsoft" : undefined,
    hideErrors: true,
    checkTimeoutInterval: 60000,
    respawn: true,
  };

  if (config.authType === "ssid" && config.ssid) {
    (botOptions as Record<string, unknown>).auth = "offline";
    (botOptions as Record<string, unknown>).username = config.username || config.label;
    (botOptions as Record<string, unknown>).session = {
      accessToken: config.ssid,
      selectedProfile: { name: config.username || config.label },
    };
  }

  try {
    const bot = mineflayer.createBot(botOptions as never);
    botManager.setRuntime(botId, bot);

    bot.on("login", () => {
      botManager.setStatus(botId, "running");
      botManager.log(botId, "info", `Logged in as ${bot.username}`);
      botManager.log(botId, "system", `Joined ${config.serverHost}:${config.serverPort}`);
    });

    bot.on("spawn", () => {
      botManager.log(botId, "info", "Spawned in world");

      if (config.messages.length > 0 && config.interval > 0) {
        let msgIndex = 0;
        const sendNext = () => {
          if (botManager.get(botId)?.status !== "running") return;
          const msg = config.messages[msgIndex % config.messages.length];
          bot.chat(msg);
          botManager.log(botId, "bot", `> ${msg}`);
          msgIndex++;
        };

        sendNext();
        const interval = setInterval(() => {
          if (botManager.get(botId)?.status !== "running") {
            clearInterval(interval);
            return;
          }
          sendNext();
        }, config.interval * 1000);

        (bot as unknown as { _luauxInterval?: NodeJS.Timeout })._luauxInterval = interval;
      }
    });

    bot.on("chat", (username: string, message: string) => {
      if (username === bot.username) return;
      botManager.log(botId, "chat", `<${username}> ${message}`);
    });

    bot.on("whisper", (username: string, message: string) => {
      botManager.log(botId, "chat", `[whisper] <${username}> ${message}`);
    });

    bot.on("error", (err: Error) => {
      botManager.log(botId, "error", `Error: ${err.message}`);
    });

    bot.on("kicked", (reason: string) => {
      botManager.log(botId, "error", `Kicked: ${reason}`);
      botManager.setStatus(botId, "error", reason);
    });

    bot.on("end", (reason: string) => {
      botManager.log(botId, "system", `Disconnected: ${reason || "connection closed"}`);
      const interval = (bot as unknown as { _luauxInterval?: NodeJS.Timeout })._luauxInterval;
      if (interval) clearInterval(interval);
      botManager.setStatus(botId, "idle");
      botManager.setRuntime(botId, null);
    });

    bot.on("death", () => {
      botManager.log(botId, "warn", "Bot died, respawning...");
    });

    return botId;
  } catch (err) {
    botManager.setStatus(botId, "error", err instanceof Error ? err.message : String(err));
    botManager.log(botId, "error", `Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

export async function stopMcBot(botId: string): Promise<boolean> {
  const bot = botManager.getRuntime(botId) as
    | { end?: () => void; quit?: () => void; _luauxInterval?: NodeJS.Timeout }
    | null;
  if (bot?._luauxInterval) clearInterval(bot._luauxInterval);
  return botManager.stop(botId);
}

export function getMcBotStatus(botId: string) {
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

export async function pingMcServer(host: string, port = 25565): Promise<{
  online: boolean;
  version?: string;
  players?: { online: number; max: number };
  motd?: string;
  latency?: number;
}> {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection(port, host, () => {
      const latency = Date.now() - start;
      const buf = Buffer.alloc(0);
      const pktLen = 0;
      const protocolVersion = -1;
      const serverHost = host;
      const serverPort = port;
      const nextState = 1;

      const writeVarInt = (val: number) => {
        const bytes: number[] = [];
        let v = val;
        while (v > 0x7f) {
          bytes.push((v & 0x7f) | 0x80);
          v >>>= 7;
        }
        bytes.push(v & 0x7f);
        return Buffer.from(bytes);
      };

      const handshake = Buffer.concat([
        writeVarInt(0),
        writeVarInt(protocolVersion),
        writeVarInt(serverHost.length),
        Buffer.from(serverHost),
        Buffer.alloc(2),
        writeVarInt(nextState),
      ]);

      const packet = Buffer.concat([writeVarInt(handshake.length), handshake]);
      socket.write(packet);

      const statusReq = Buffer.concat([writeVarInt(1), writeVarInt(0)]);
      socket.write(Buffer.concat([writeVarInt(statusReq.length), statusReq]));

      let data = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        data = Buffer.concat([data, chunk]);
        try {
          let offset = 0;
          const readVarInt = () => {
            let result = 0;
            let shift = 0;
            while (offset < data.length) {
              const byte = data[offset++];
              result |= (byte & 0x7f) << shift;
              if ((byte & 0x80) === 0) break;
              shift += 7;
            }
            return result;
          };

          const len = readVarInt();
          if (data.length < offset + len) return;
          const _id = readVarInt();
          const jsonLen = readVarInt();
          const jsonStr = data.toString("utf8", offset, offset + jsonLen);
          const parsed = JSON.parse(jsonStr);
          socket.destroy();
          resolve({
            online: true,
            version: parsed.version?.name,
            players: parsed.players,
            motd: parsed.description?.text || parsed.description?.extra?.map((e: { text: string }) => e.text).join(""),
            latency,
          });
        } catch {
          // partial data, wait
        }
      });

      socket.setTimeout(5000);
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ online: false });
      });
      socket.on("error", () => {
        socket.destroy();
        resolve({ online: false });
      });
    });

    socket.on("error", () => {
      resolve({ online: false });
    });

    setTimeout(() => {
      socket.destroy();
      resolve({ online: false });
    }, 5000);
  });
}
