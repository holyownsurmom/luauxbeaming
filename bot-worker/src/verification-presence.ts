/**
 * Keeps verification Discord bots ONLINE via Gateway.
 * Interaction-only bots appear offline unless they open a Gateway connection.
 */
import WebSocket from "ws";
import { createLogger } from "./api.js";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = 0; // no privileged intents needed for presence only

type PresenceBot = {
  token: string;
  guildId: string;
  label: string;
  ws: WebSocket | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  seq: number | null;
  sessionId: string | null;
  resumeUrl: string | null;
  stopped: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

const bots = new Map<string, PresenceBot>(); // token → bot

function identify(bot: PresenceBot) {
  if (!bot.ws || bot.ws.readyState !== WebSocket.OPEN) return;
  bot.ws.send(
    JSON.stringify({
      op: 2,
      d: {
        token: bot.token,
        intents: INTENTS,
        properties: {
          os: "linux",
          browser: "luaux",
          device: "luaux-verification",
        },
        presence: {
          status: "online",
          activities: [
            {
              name: "Verification",
              type: 3, // Watching
            },
          ],
          afk: false,
          since: null,
        },
      },
    }),
  );
}

function resume(bot: PresenceBot) {
  if (!bot.ws || bot.ws.readyState !== WebSocket.OPEN || !bot.sessionId) {
    identify(bot);
    return;
  }
  bot.ws.send(
    JSON.stringify({
      op: 6,
      d: {
        token: bot.token,
        session_id: bot.sessionId,
        seq: bot.seq,
      },
    }),
  );
}

function connect(bot: PresenceBot) {
  if (bot.stopped) return;
  if (bot.ws) {
    try {
      bot.ws.removeAllListeners();
      bot.ws.close();
    } catch {
      /* ignore */
    }
    bot.ws = null;
  }
  if (bot.heartbeat) {
    clearInterval(bot.heartbeat);
    bot.heartbeat = null;
  }

  const url = bot.resumeUrl || GATEWAY_URL;
  const ws = new WebSocket(url);
  bot.ws = ws;

  ws.on("open", () => {
    console.log(`[presence] gateway open for ${bot.label} (${bot.guildId})`);
  });

  ws.on("message", (raw) => {
    let packet: { op: number; d?: any; s?: number | null; t?: string | null };
    try {
      packet = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (packet.s != null) bot.seq = packet.s;

    switch (packet.op) {
      case 10: {
        // Hello
        const interval = packet.d?.heartbeat_interval || 41250;
        if (bot.heartbeat) clearInterval(bot.heartbeat);
        bot.heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 1, d: bot.seq }));
          }
        }, interval);
        // Jitter first heartbeat
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 1, d: bot.seq }));
          }
        }, interval * Math.random());

        if (bot.sessionId) resume(bot);
        else identify(bot);
        break;
      }
      case 0: {
        if (packet.t === "READY") {
          bot.sessionId = packet.d?.session_id || null;
          bot.resumeUrl = packet.d?.resume_gateway_url
            ? `${packet.d.resume_gateway_url}/?v=10&encoding=json`
            : null;
          console.log(`[presence] READY as ${packet.d?.user?.username} for ${bot.label}`);
        }
        if (packet.t === "RESUMED") {
          console.log(`[presence] RESUMED for ${bot.label}`);
        }
        break;
      }
      case 7: {
        // Reconnect
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        break;
      }
      case 9: {
        // Invalid session
        bot.sessionId = null;
        bot.seq = null;
        setTimeout(() => identify(bot), 2000 + Math.random() * 3000);
        break;
      }
      case 11:
        // Heartbeat ACK
        break;
      default:
        break;
    }
  });

  ws.on("close", () => {
    if (bot.heartbeat) {
      clearInterval(bot.heartbeat);
      bot.heartbeat = null;
    }
    bot.ws = null;
    if (bot.stopped) return;
    if (bot.reconnectTimer) clearTimeout(bot.reconnectTimer);
    bot.reconnectTimer = setTimeout(() => {
      bot.reconnectTimer = null;
      connect(bot);
    }, 5000 + Math.random() * 5000);
  });

  ws.on("error", (err) => {
    console.error(`[presence] gateway error ${bot.label}:`, err.message);
  });
}

export function startPresence(token: string, guildId: string, label = "verification") {
  const clean = token.trim();
  if (!clean) return;
  const existing = bots.get(clean);
  if (existing) {
    existing.guildId = guildId;
    existing.label = label;
    existing.stopped = false;
    if (!existing.ws || existing.ws.readyState !== WebSocket.OPEN) {
      connect(existing);
    }
    return;
  }
  const bot: PresenceBot = {
    token: clean,
    guildId,
    label,
    ws: null,
    heartbeat: null,
    seq: null,
    sessionId: null,
    resumeUrl: null,
    stopped: false,
    reconnectTimer: null,
  };
  bots.set(clean, bot);
  connect(bot);
}

export function stopPresence(token: string) {
  const bot = bots.get(token.trim());
  if (!bot) return;
  bot.stopped = true;
  if (bot.reconnectTimer) clearTimeout(bot.reconnectTimer);
  if (bot.heartbeat) clearInterval(bot.heartbeat);
  if (bot.ws) {
    try {
      bot.ws.close();
    } catch {
      /* ignore */
    }
  }
  bots.delete(token.trim());
}

export function stopAllPresence() {
  for (const token of [...bots.keys()]) stopPresence(token);
}

/** Sync presence bots from API list */
export function syncPresenceBots(
  list: Array<{ bot_token: string; guild_id: string; label?: string }>,
) {
  const wanted = new Set(list.map((b) => b.bot_token.trim()).filter(Boolean));
  for (const token of [...bots.keys()]) {
    if (!wanted.has(token)) stopPresence(token);
  }
  for (const b of list) {
    if (b.bot_token?.trim()) {
      startPresence(b.bot_token, b.guild_id, b.label || b.guild_id);
    }
  }
}
