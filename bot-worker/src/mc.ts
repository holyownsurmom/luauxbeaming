import { createLogger, updateJob } from "./api.js";
import { isJobPaused } from "./pause-state.js";
import {
  accountLockKey,
  createPremiumAuthInjector,
  fetchMinecraftCertificates,
  fetchMinecraftProfile,
  formatUuidDashed,
  formatUuidUndashed,
  resolveSsidSession,
  type PremiumSession,
} from "./mc-auth.js";

export type JobRunResult = {
  status: "completed" | "error" | "stopped";
  error?: string;
};

export type McJobConfig = {
  accountId: string;
  label: string;
  serverHost: string;
  serverPort: number;
  authType: "microsoft" | "ssid" | "offline";
  username?: string;
  uuid?: string;
  /** Minecraft services access token (SSID) — only present for authType "ssid" */
  ssid?: string;
  messages: string[];
  interval: number;
};

const CONNECTION_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 25;
const RECONNECT_BASE_DELAY = 5000;

/** Only one live socket per Minecraft account (prevents multi-login + Invalid sequence storms) */
const activeAccounts = new Map<string, string>(); // uuid/name → jobId

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
): Promise<JobRunResult> {
  const log = createLogger(jobId, discordId);
  let terminal: JobRunResult = { status: "completed" };

  if (!config.serverHost) {
    await log("error", "Missing serverHost");
    await updateJob(jobId, "error", "Missing serverHost");
    return { status: "error", error: "Missing serverHost" };
  }
  if (!config.messages?.length) {
    await log("error", "No messages configured");
    await updateJob(jobId, "error", "No messages configured");
    return { status: "error", error: "No messages configured" };
  }

  if (config.interval < 5) config.interval = 5;

  // Premium session resolved ONCE per job (reused on every reconnect)
  let premiumSession: PremiumSession | null = null;

  if (config.authType === "ssid") {
    await log("info", "SSID auth — validating token + loading certificates...");
    const resolved = await resolveSsidSession(config.ssid || "", log);
    if ("error" in resolved) {
      await updateJob(jobId, "error", resolved.error);
      return { status: "error", error: resolved.error };
    }
    premiumSession = resolved.session;
  }

  if (config.authType === "microsoft") {
    try {
      const prismarineAuth = await import("prismarine-auth");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Authflow =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prismarineAuth as any).Authflow ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prismarineAuth as any).default?.Authflow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Titles =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prismarineAuth as any).Titles ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prismarineAuth as any).default?.Titles ||
        {};

      // Device-code works with live + Nintendo Switch title (official prismarine-auth example).
      const authTitle = Titles.MinecraftNintendoSwitch || "00000000441cc96b";
      const cacheDir = `./prismarine-cache/${(config.label || "default").replace(/[^\w.-]/g, "_")}`;
      const msAccountKey = config.username || config.label || "mc-user";

      await log("info", "Starting Microsoft device code authentication...");
      await log(
        "system",
        "Waiting for Microsoft login — a popup should appear with the link and code.",
      );

      const authflow = new Authflow(
        msAccountKey,
        cacheDir,
        { authTitle, deviceType: "Nintendo", flow: "live" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (info: any) => {
          const code = info?.user_code || info?.userCode || info?.code || "";
          const uri =
            info?.verification_uri ||
            info?.verificationUri ||
            info?.verification_url ||
            "https://www.microsoft.com/link";
          const expires =
            info?.expires_in || info?.expiresIn || info?.expires_on || 900;
          const mins = Math.max(1, Math.round(Number(expires) / 60) || 15);

          if (!code) {
            console.log("[ms-auth] device code payload:", JSON.stringify(info));
            log(
              "warn",
              `Microsoft auth callback missing code. Raw: ${JSON.stringify(info).slice(0, 300)}`,
            ).catch(() => {});
            return;
          }

          log("system", `MS_AUTH_REQUIRED|${uri}|${code}|${mins}`, true).catch(() => {});
          log(
            "info",
            `Microsoft login required — open ${uri} and enter code ${code} (expires in ${mins} min)`,
            true,
          ).catch(() => {});
          console.log(`[ms-auth] Open ${uri} and enter code: ${code}`);
        },
      );

      const mcToken = await authflow.getMinecraftJavaToken({
        fetchProfile: true,
        fetchCertificates: true,
      });

      if (!mcToken?.token) {
        await log("error", "Microsoft auth failed: no token returned");
        await updateJob(jobId, "error", "Microsoft auth failed");
        return { status: "error", error: "Microsoft auth failed" };
      }

      let name = mcToken.profile?.name as string | undefined;
      let id = mcToken.profile?.id as string | undefined;

      if (!name || !id) {
        const profile = await fetchMinecraftProfile(mcToken.token);
        if (profile) {
          name = profile.name;
          id = profile.id;
        }
      }

      if (!name || !id) {
        await log("error", "Microsoft auth failed: no Minecraft profile");
        await updateJob(jobId, "error", "Microsoft auth failed: no profile");
        return { status: "error", error: "Microsoft auth failed: no profile" };
      }

      // Prefer certificates from prismarine-auth; fallback to direct Mojang API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let profileKeys = (mcToken as any).certificates?.profileKeys || null;
      if (profileKeys) {
        await log("info", "Chat certificates loaded (prismarine-auth)");
      } else {
        await log("info", "Fetching chat-signing certificates...");
        profileKeys = await fetchMinecraftCertificates(mcToken.token);
        if (profileKeys) await log("info", "Chat certificates loaded");
        else await log("warn", "Could not load chat certificates");
      }

      premiumSession = {
        accessToken: mcToken.token,
        name,
        id,
        idUndashed: formatUuidUndashed(id),
        idDashed: formatUuidDashed(id),
        profileKeys,
        source: "microsoft",
      };
      await log("info", `Authenticated as ${name} (${formatUuidDashed(id)})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log("error", `Microsoft auth failed: ${msg}`);
      await updateJob(jobId, "error", `Microsoft auth failed: ${msg}`);
      return { status: "error", error: `Microsoft auth failed: ${msg}` };
    }
  }

  const accountKey = accountLockKey(
    premiumSession,
    config.username || config.label || jobId,
  );

  const existingJob = activeAccounts.get(accountKey);
  if (existingJob && existingJob !== jobId) {
    const msg = `Account already in use by another bot job (${existingJob.slice(0, 8)}…). Stop that bot first.`;
    await log("error", msg);
    await updateJob(jobId, "error", msg);
    return { status: "error", error: msg };
  }
  activeAccounts.set(accountKey, jobId);

  const mineflayer = await loadMineflayer();

  const startedAt = Date.now();
  let sentCount = 0;
  let reconnectAttempts = 0;
  let currentTimer: ReturnType<typeof setTimeout> | null = null;
  let antiAfkTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let authFailed = false;
  let lastLongBreakMin = 0;
  let messageOrder = shuffleArray(config.messages.map((_, i) => i));
  let shufflePosition = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentBot: any = null;

  const releaseAccount = () => {
    if (activeAccounts.get(accountKey) === jobId) {
      activeAccounts.delete(accountKey);
    }
  };

  const runtimeMinutes = () => (Date.now() - startedAt) / 60000;

  const cleanup = () => {
    if (currentTimer) {
      clearTimeout(currentTimer);
      currentTimer = null;
    }
    if (antiAfkTimer) {
      clearTimeout(antiAfkTimer);
      antiAfkTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
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
    // Minimal anti-AFK: ONLY slow head look via bot.look (no walk/jump/sneak).
    // Walking control packets cause Invalid sequence on Via/Donut when multi-connected.
    if (antiAfkTimer) clearTimeout(antiAfkTimer);
    const tick = () => {
      if (stopped || abortSignal.aborted || currentBot !== bot) return;
      try {
        if (bot.entity && Math.random() < 0.4) {
          const yaw = bot.entity.yaw + (Math.random() - 0.5) * 0.25;
          const pitch = Math.max(-0.4, Math.min(0.3, (Math.random() - 0.5) * 0.15));
          bot.look(yaw, pitch, false);
        }
      } catch {
        /* ignore */
      }
      if (!stopped && currentBot === bot) {
        antiAfkTimer = setTimeout(tick, randomBetween(15000, 35000));
      }
    };
    antiAfkTimer = setTimeout(tick, randomBetween(20000, 40000));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function startMessageLoop(bot: any) {
    let pauseNotified = false;

    const scheduleNext = () => {
      if (stopped || abortSignal.aborted) return;

      // User paused bot from console — stay connected, don't send
      if (isJobPaused(jobId)) {
        if (!pauseNotified) {
          pauseNotified = true;
          log("system", "Bot PAUSED — messages stopped (stay online). Press RESUME to continue.").catch(
            () => {},
          );
        }
        currentTimer = setTimeout(() => scheduleNext(), 2000);
        return;
      }
      if (pauseNotified) {
        pauseNotified = false;
        log("system", "Bot RESUMED — message loop active again.").catch(() => {});
      }

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
      if (isJobPaused(jobId)) {
        scheduleNext();
        return;
      }

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

    // Short settle after spawn — long delays looked like a dead console
    const initialDelay = randomBetween(8_000, 15_000);
    log(
      "info",
      `Waiting ${(initialDelay / 1000).toFixed(0)}s before first message (interval base ${config.interval}s)...`,
      true,
    ).catch(() => {});
    currentTimer = setTimeout(() => {
      if (stopped || abortSignal.aborted || currentBot !== bot) return;
      sendOneMessage(bot);
    }, initialDelay);
  }

  function extractChatText(node: unknown): string {
    if (node == null) return "";
    if (typeof node === "string") return node;
    if (typeof node === "number" || typeof node === "boolean") return String(node);
    if (Array.isArray(node)) return node.map(extractChatText).join("");
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // NBT-style chat component from modern servers: { type: "string", value: "Timed out." }
      if (typeof obj.value === "string" && (obj.type === "string" || obj.type === "text" || !obj.text)) {
        return obj.value;
      }
      if (obj.value != null && typeof obj.value === "object") {
        const nested = extractChatText(obj.value);
        if (nested) return nested;
      }
      let out = "";
      if (typeof obj.text === "string") out += obj.text;
      if (Array.isArray(obj.extra)) out += obj.extra.map(extractChatText).join("");
      if (obj.with && Array.isArray(obj.with)) out += obj.with.map(extractChatText).join(" ");
      if (typeof obj.translate === "string" && !out) out += obj.translate;
      return out || JSON.stringify(node);
    }
    return String(node);
  }

  function formatKickReason(reason: unknown): string {
    if (reason == null) return "unknown";
    if (typeof reason === "string") {
      try {
        const parsed = JSON.parse(reason);
        const text = extractChatText(parsed).trim();
        return text || reason;
      } catch {
        return reason;
      }
    }
    const text = extractChatText(reason).trim();
    if (text) return text;
    try {
      return JSON.stringify(reason);
    } catch {
      return String(reason);
    }
  }

  function shouldReconnect(kickReason: unknown): boolean {
    const lower = formatKickReason(kickReason).toLowerCase();
    if (lower.includes("banned")) return false;
    if (lower.includes("blocked")) return false;
    if (lower.includes("security")) return false;
    if (lower.includes("suspicious")) return false;
    if (lower.includes("authenticat")) return false;
    if (lower.includes("not authenticated")) return false;
    if (lower.includes("not logged into")) return false;
    if (lower.includes("invalid session")) return false;
    if (lower.includes("whitelist")) return false;
    if (lower.includes("full")) return false;
    if (lower.includes("logged in from another")) return false;
    if (lower.includes("already connected")) return false;
    if (lower.includes("already logged in")) return false;
    return true;
  }

  let connecting = false;
  let reconnectScheduled = false;
  let lastDisconnectLogAt = 0;
  let lastDisconnectReason = "";

  async function connect() {
    if (stopped || abortSignal.aborted || authFailed || connecting) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connecting = true;
    reconnectScheduled = false;

    // Always tear down any previous bot before opening a new socket
    if (currentBot) {
      try {
        currentBot.removeAllListeners();
        currentBot.quit("reconnect");
      } catch {
        try {
          currentBot.end("reconnect");
        } catch {
          /* ignore */
        }
      }
      currentBot = null;
      await new Promise((r) => setTimeout(r, 2000));
    }

    const attemptLabel =
      reconnectAttempts > 0
        ? `Reconnect ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`
        : "Connecting";
    await log(
      "system",
      `${attemptLabel} to ${config.serverHost}:${config.serverPort}…`,
      true,
    );

    const botOptions: Record<string, unknown> = {
      host: config.serverHost,
      port: config.serverPort,
      username: config.username || config.label || "Player",
      hideErrors: true,
      checkTimeoutInterval: 60_000,
      keepAlive: true,
      respawn: true,
      // physics plugin MUST load (teleport_confirm). physicsEnabled true = simulate ticks.
      physicsEnabled: true,
      viewDistance: "tiny",
      brand: "vanilla",
      version: false,
    };

    if (
      (config.authType === "microsoft" || config.authType === "ssid") &&
      premiumSession
    ) {
      botOptions.username = premiumSession.name;
      botOptions.auth = createPremiumAuthInjector(premiumSession);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bot: any = null;
    let connected = false;
    let handlingDisconnect = false;
    let loopsStarted = false;

    const scheduleReconnect = async (reasonText: string, _fromKick: boolean) => {
      // Single-flight: kicked + end + error often fire together for the same close
      if (handlingDisconnect || reconnectScheduled || stopped || authFailed) return;
      handlingDisconnect = true;
      reconnectScheduled = true;
      connecting = false;
      cleanup();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (currentBot) {
        try {
          currentBot.removeAllListeners();
          currentBot.quit("reconnect");
        } catch {
          try {
            currentBot?.end("reconnect");
          } catch {
            /* ignore */
          }
        }
        currentBot = null;
      }

      if (stopped || abortSignal.aborted || authFailed) return;

      const lower = reasonText.toLowerCase();
      if (
        lower.includes("logged in from another") ||
        lower.includes("already connected") ||
        lower.includes("already logged in") ||
        lower.includes("you logged in from another location")
      ) {
        const msg = `Kicked: account already online elsewhere. Stop other bots using this account. (${reasonText})`;
        log("error", msg, true).catch(() => {});
        await updateJob(jobId, "error", msg);
        authFailed = true;
        stopped = true;
        terminal = { status: "error", error: msg };
        return;
      }

      const doReconnect = shouldReconnect(reasonText);
      if (!doReconnect) {
        const msg = lower.includes("authenticat") || lower.includes("not logged into")
          ? `Authentication failed: ${reasonText}. Your token may be expired — re-login and get a new token.`
          : lower.includes("banned") || lower.includes("blocked") || lower.includes("suspicious")
            ? `Account blocked/banned: ${reasonText}`
            : `Not reconnecting: ${reasonText}`;
        log("error", msg, true).catch(() => {});
        await updateJob(jobId, "error", msg);
        authFailed = true;
        stopped = true;
        terminal = { status: "error", error: msg };
        return;
      }

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        log("error", "Max reconnect attempts reached", true).catch(() => {});
        await updateJob(jobId, "error", "Max reconnect attempts");
        stopped = true;
        terminal = { status: "error", error: "Max reconnect attempts" };
        return;
      }

      reconnectAttempts++;
      // Protocol / socket closes need longer cool-down (avoid spam reconnects)
      const isHardClose =
        lower.includes("invalid sequence") ||
        lower.includes("timed out") ||
        lower.includes("timeout") ||
        lower.includes("socketclosed") ||
        lower.includes("socket closed") ||
        lower.includes("econnreset") ||
        lower.includes("etimedout") ||
        lower.includes("connection closed") ||
        lower.includes("connreset");
      const baseDelay = isHardClose
        ? randomBetween(25, 55) * 1000
        : reconnectAttempts <= 3
          ? RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1)
          : randomBetween(45, 150) * 1000;
      const delay = baseDelay + randomBetween(0, 5000);

      // Dedupe identical disconnect spam in console
      const now = Date.now();
      if (
        reasonText !== lastDisconnectReason ||
        now - lastDisconnectLogAt > 4000
      ) {
        lastDisconnectReason = reasonText;
        lastDisconnectLogAt = now;
        log(
          "warn",
          `Disconnected (${reasonText.slice(0, 80)}). Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
          true,
        ).catch(() => {});
      }

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectScheduled = false;
        connect();
      }, delay);
    };

    try {
      bot = (mineflayer as any).createBot(botOptions);
    } catch (e) {
      connecting = false;
      const msg = e instanceof Error ? e.message : String(e);
      log("error", `createBot failed: ${msg}`, true).catch(() => {});
      void scheduleReconnect(msg, false);
      return;
    }
    currentBot = bot;

    let lastChatKey = "";
    let lastChatAt = 0;
    let lastKickKey = "";
    let lastKickAt = 0;

    let loggedInOnce = false;

    bot.on("login", () => {
      if (currentBot !== bot) return;
      connected = true;
      connecting = false;
      if (loggedInOnce) return;
      loggedInOnce = true;
      log("info", `Logged in as ${bot.username}`, true).catch(() => {});
    });

    bot.on("spawn", () => {
      if (currentBot !== bot) return;
      if (loopsStarted) return;
      loopsStarted = true;
      connecting = false;
      reconnectAttempts = 0;
      log("info", "Spawned in world — settling, then message loop…", true).catch(() => {});
      updateJob(jobId, "running").catch(() => {});

      // Brief settle so Via/Paper teleports finish; then start chat loop
      const settleMs = randomBetween(8_000, 14_000);
      log("info", `Settle ${Math.round(settleMs / 1000)}s before chat loop`, true).catch(() => {});
      setTimeout(() => {
        if (stopped || abortSignal.aborted || currentBot !== bot) return;
        startAntiAfk(bot);
        startMessageLoop(bot);
      }, settleMs);
    });

    bot.on("chat", (username: string, message: string) => {
      if (currentBot !== bot) return;
      if (username === bot.username) return;
      const key = `${username}|${message}`;
      const now = Date.now();
      if (key === lastChatKey && now - lastChatAt < 2000) return;
      lastChatKey = key;
      lastChatAt = now;
      log("chat", `<${username}> ${message}`).catch(() => {});
    });

    bot.on("whisper", (username: string, message: string) => {
      if (currentBot !== bot) return;
      log("chat", `[whisper] <${username}> ${message}`).catch(() => {});
    });

    bot.on("error", (err: Error) => {
      if (currentBot !== bot) return;
      // socketClosed often also fires end — avoid double spam
      const msg = err?.message || String(err);
      if (/socketclosed|econnreset|etimedout|timed out/i.test(msg)) {
        void scheduleReconnect(msg, false);
        return;
      }
      log("error", `Error: ${msg}`).catch(() => {});
    });

    bot.on("kicked", async (reason: unknown) => {
      if (currentBot !== bot) return;
      const reasonText = formatKickReason(reason);
      const now = Date.now();
      if (reasonText === lastKickKey && now - lastKickAt < 3000) return;
      lastKickKey = reasonText;
      lastKickAt = now;
      log("warn", `Kicked: ${reasonText}`, true).catch(() => {});
      await scheduleReconnect(reasonText, true);
    });

    bot.on("end", async (reason: unknown) => {
      clearTimeout(connectionTimeout);
      if (currentBot !== bot && handlingDisconnect) return;
      const reasonText = formatKickReason(reason) || "connection closed";
      await scheduleReconnect(reasonText, false);
    });

    bot.on("death", () => {
      log("warn", "Bot died, respawning...").catch(() => {});
    });

    const connectionTimeout = setTimeout(() => {
      if (!connected && !stopped && !handlingDisconnect) {
        log("error", "Connection timed out").catch(() => {});
        void scheduleReconnect("Connection timed out", false);
      }
    }, CONNECTION_TIMEOUT_MS);
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
        releaseAccount();
        if (cleanupTimer) clearInterval(cleanupTimer);
        if (abortSignal.aborted && terminal.status === "completed") {
          terminal = { status: "stopped", error: "Stopped by user" };
        }
        resolve(terminal);
      }
    }, 1000);
  });
}
