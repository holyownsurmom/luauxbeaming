/**
 * Keeps verification Discord bots ONLINE via Gateway.
 * Interaction-only bots appear offline unless they open a Gateway connection.
 */
import WebSocket from "ws";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = 0; // no privileged intents needed for presence only
const MAX_RECONNECT_MS = 60_000;

type PresenceBot = {
  token: string;
  guildId: string;
  label: string;
  ws: WebSocket | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  heartbeatTimeout: ReturnType<typeof setTimeout> | null;
  seq: number | null;
  sessionId: string | null;
  resumeUrl: string | null;
  stopped: boolean;
  connecting: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
};

const bots = new Map<string, PresenceBot>(); // token → bot

function clearHeartbeat(bot: PresenceBot) {
  if (bot.heartbeat) {
    clearInterval(bot.heartbeat);
    bot.heartbeat = null;
  }
  if (bot.heartbeatTimeout) {
    clearTimeout(bot.heartbeatTimeout);
    bot.heartbeatTimeout = null;
  }
}

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
        seq: bot.seq ?? 0,
      },
    }),
  );
}

function scheduleReconnect(bot: PresenceBot, reason: string) {
  if (bot.stopped) return;
  if (bot.reconnectTimer) return;

  bot.reconnectAttempt = Math.min(bot.reconnectAttempt + 1, 8);
  const delay = Math.min(
    MAX_RECONNECT_MS,
    2000 * Math.pow(2, bot.reconnectAttempt - 1) + Math.random() * 1000,
  );
  console.log(
    `[presence] reconnect ${bot.label} in ${(delay / 1000).toFixed(1)}s (${reason}, attempt ${bot.reconnectAttempt})`,
  );
  bot.reconnectTimer = setTimeout(() => {
    bot.reconnectTimer = null;
    connect(bot);
  }, delay);
}

function connect(bot: PresenceBot) {
  if (bot.stopped || bot.connecting) return;
  // Already online — don't tear down a healthy gateway
  if (bot.ws && bot.ws.readyState === WebSocket.OPEN) return;
  bot.connecting = true;

  if (bot.reconnectTimer) {
    clearTimeout(bot.reconnectTimer);
    bot.reconnectTimer = null;
  }

  if (bot.ws) {
    try {
      bot.ws.removeAllListeners();
      // terminate half-open sockets instead of close() to avoid
      // "WebSocket was closed before the connection was established"
      if (bot.ws.readyState === WebSocket.CONNECTING) bot.ws.terminate();
      else bot.ws.close();
    } catch {
      /* ignore */
    }
    bot.ws = null;
  }
  clearHeartbeat(bot);

  const url = bot.resumeUrl || GATEWAY_URL;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    bot.connecting = false;
    const msg = e instanceof Error ? e.message : String(e);
    scheduleReconnect(bot, `create failed: ${msg}`);
    return;
  }
  bot.ws = ws;

  // Hard open timeout — prevents infinite hang if gateway never opens
  const openTimeout = setTimeout(() => {
    if (bot.ws === ws && ws.readyState !== WebSocket.OPEN) {
      console.error(`[presence] open timeout for ${bot.label}`);
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
    }
  }, 15_000);

  ws.on("open", () => {
    clearTimeout(openTimeout);
    bot.connecting = false;
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
        clearHeartbeat(bot);
        bot.heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ op: 1, d: bot.seq }));
            } catch {
              /* ignore */
            }
          }
        }, interval);
        // Jitter first heartbeat
        bot.heartbeatTimeout = setTimeout(() => {
          bot.heartbeatTimeout = null;
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ op: 1, d: bot.seq }));
            } catch {
              /* ignore */
            }
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
          bot.reconnectAttempt = 0;
          console.log(`[presence] READY as ${packet.d?.user?.username} for ${bot.label}`);
        }
        if (packet.t === "RESUMED") {
          bot.reconnectAttempt = 0;
          console.log(`[presence] RESUMED for ${bot.label}`);
        }
        break;
      }
      case 7: {
        // Reconnect requested
        try {
          ws.close(4000, "reconnect");
        } catch {
          /* ignore */
        }
        break;
      }
      case 9: {
        // Invalid session
        const resumable = packet.d === true;
        if (!resumable) {
          bot.sessionId = null;
          bot.seq = null;
          bot.resumeUrl = null;
        }
        setTimeout(() => {
          if (bot.stopped || bot.ws !== ws) return;
          if (resumable) resume(bot);
          else identify(bot);
        }, 2000 + Math.random() * 3000);
        break;
      }
      case 11:
        // Heartbeat ACK
        break;
      default:
        break;
    }
  });

  ws.on("close", (code, reason) => {
    clearTimeout(openTimeout);
    bot.connecting = false;
    clearHeartbeat(bot);
    if (bot.ws === ws) bot.ws = null;
    if (bot.stopped) return;
    const reasonText = reason?.toString() || `code ${code}`;
    // Session may be dead after hard close codes
    if (code === 4004 || code === 4010 || code === 4011 || code === 4013 || code === 4014) {
      bot.sessionId = null;
      bot.seq = null;
      bot.resumeUrl = null;
    }
    scheduleReconnect(bot, reasonText);
  });

  ws.on("error", (err) => {
    // ECONNRESET / transient network — reconnect handles it; avoid stack spam
    const msg = err instanceof Error ? err.message : String(err);
    if (!/ECONNRESET|ECONNREFUSED|ETIMEDOUT|closed before/i.test(msg)) {
      console.error(`[presence] gateway error ${bot.label}:`, msg);
    }
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
      if (!existing.connecting && !existing.reconnectTimer) {
        connect(existing);
      }
    }
    return;
  }
  const bot: PresenceBot = {
    token: clean,
    guildId,
    label,
    ws: null,
    heartbeat: null,
    heartbeatTimeout: null,
    seq: null,
    sessionId: null,
    resumeUrl: null,
    stopped: false,
    connecting: false,
    reconnectTimer: null,
    reconnectAttempt: 0,
  };
  bots.set(clean, bot);
  connect(bot);
}

export function stopPresence(token: string) {
  const bot = bots.get(token.trim());
  if (!bot) return;
  bot.stopped = true;
  if (bot.reconnectTimer) clearTimeout(bot.reconnectTimer);
  clearHeartbeat(bot);
  if (bot.ws) {
    try {
      bot.ws.removeAllListeners();
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
