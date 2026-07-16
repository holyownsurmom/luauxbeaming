import { createLogger, fetchMcSession, markMcAccountExpired, updateJob } from "./api.js";
import { isJobPaused } from "./pause-state.js";
import {
  accountLockKey,
  certsNeedRefresh,
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

const MC_SUFFIXES = ["", " ", ".", "...", "!", "?", " ~", " :)", " :D", " lol", " fr"];

function variateMessage(msg: string): string {
  let result = msg.trim();
  if (!result) return msg;
  // Light typo
  if (Math.random() < 0.12 && result.length > 6) {
    const idx = randomBetween(1, result.length - 2);
    const ch = result[idx];
    if (ch && /[a-z]/i.test(ch)) {
      result = result.slice(0, idx) + ch + ch + result.slice(idx + 1);
    }
  }
  // Random lowercase first char
  if (Math.random() < 0.1 && result.length > 2) {
    result = result.charAt(0).toLowerCase() + result.slice(1);
  }
  if (Math.random() < 0.35) {
    result += pickRandom(MC_SUFFIXES);
  }
  return result || msg;
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
  // Humanized jitter around base interval (+ occasional longer AFK)
  let min = baseInterval * 0.65;
  let max = baseInterval * 1.75;
  if (Math.random() < 0.12) {
    // "tab away" pause
    min = baseInterval * 2;
    max = baseInterval * 5;
  }
  // Slow down slightly over long runs
  if (runtimeMinutes > 20) {
    const fat = 1 + Math.min(runtimeMinutes / 90, 1.2);
    min *= fat;
    max *= fat;
  }

  if (sentCount < 3) {
    min = Math.max(min, 8);
    max = Math.max(max, 18);
  }

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

  // Premium session — revalidated from site DB so Refresh Token applies mid-job
  let premiumSession: PremiumSession | null = null;
  let lastSessionRefreshAt = 0;
  const SESSION_REFRESH_MS = 30 * 60_000;
  const accountId = config.accountId || "";

  const failAuth = async (msg: string, markExpired = false): Promise<JobRunResult> => {
    await log("error", msg, true);
    if (markExpired) await markMcAccountExpired(accountId, discordId);
    await updateJob(jobId, "error", msg);
    return { status: "error", error: msg };
  };

  /**
   * Resolve SSID + chat certs.
   * 1) Prefer live token from site (mc_accounts) via worker API
   * 2) Fallback to job-config ssid (legacy / offline site)
   */
  const refreshPremiumSession = async (force = false): Promise<boolean> => {
    // Device-code microsoft sessions live only in memory (premiumSession)
    if (config.authType === "microsoft" && premiumSession?.source === "microsoft") {
      const needsCerts = certsNeedRefresh(premiumSession);
      if (!force && !needsCerts && Date.now() - lastSessionRefreshAt < SESSION_REFRESH_MS) {
        return true;
      }
      if (premiumSession.accessToken && needsCerts) {
        const keys = await fetchMinecraftCertificates(premiumSession.accessToken);
        if (keys) {
          premiumSession = {
            ...premiumSession,
            profileKeys: keys,
            certsExpiresOn:
              keys.expiresOn instanceof Date ? keys.expiresOn.getTime() : null,
            certsRefreshAfter:
              keys.refreshAfter instanceof Date ? keys.refreshAfter.getTime() : null,
          };
          lastSessionRefreshAt = Date.now();
          await log("info", "Chat certificates refreshed (Microsoft session)", true);
          return true;
        }
      }
      return !!premiumSession;
    }

    if (config.authType !== "ssid" && config.authType !== "microsoft") return true;

    const needsCerts = certsNeedRefresh(premiumSession);
    if (
      !force &&
      premiumSession &&
      !needsCerts &&
      Date.now() - lastSessionRefreshAt < SESSION_REFRESH_MS
    ) {
      return true;
    }

    await log(
      "info",
      force || !premiumSession
        ? "SSID auth — loading live token + certificates..."
        : needsCerts
          ? "Refreshing chat-signing certificates..."
          : "Re-validating SSID session...",
      true,
    );

    // Live fetch from DB (user may have refreshed token while bot was running)
    let token = "";
    if (accountId || jobId) {
      const live = await fetchMcSession({
        jobId,
        accountId: accountId || undefined,
        discordId,
      });
      if (live.ok) {
        token = live.token;
        config.username = live.username;
        config.uuid = live.uuid;
        config.ssid = live.token;
        config.authType = "ssid";
      } else if (live.code === "token_expired" || live.httpStatus === 401) {
        await log("error", live.error, true);
        await markMcAccountExpired(accountId, discordId);
        return false;
      } else if (live.code === "no_ssid") {
        // Microsoft accounts may have no SSID until device-code completes
        if (config.authType === "microsoft" && premiumSession) return true;
        await log("error", live.error, true);
        return false;
      } else {
        await log(
          "warn",
          `Live session fetch failed (${live.error}) — trying job-config token`,
          true,
        );
      }
    }

    if (!token) {
      token = config.ssid || "";
    }
    if (!token) {
      if (premiumSession?.accessToken) {
        token = premiumSession.accessToken;
      } else {
        await log(
          "error",
          "No SSID available. Open account → Refresh Token and paste a fresh access_token.",
          true,
        );
        return false;
      }
    }

    // If only certs expired but same token, refresh certs only
    if (
      !force &&
      premiumSession &&
      premiumSession.accessToken === token &&
      needsCerts
    ) {
      const keys = await fetchMinecraftCertificates(token);
      if (keys) {
        premiumSession = {
          ...premiumSession,
          profileKeys: keys,
          certsExpiresOn:
            keys.expiresOn instanceof Date ? keys.expiresOn.getTime() : null,
          certsRefreshAfter:
            keys.refreshAfter instanceof Date ? keys.refreshAfter.getTime() : null,
        };
        lastSessionRefreshAt = Date.now();
        await log("info", "Chat certificates refreshed", true);
        return true;
      }
      await log("warn", "Cert refresh failed — full re-validate", true);
    }

    const resolved = await resolveSsidSession(token, log);
    if ("error" in resolved) {
      const expired =
        resolved.code === "invalid" || /expired|invalid|rejected/i.test(resolved.error);
      if (expired) await markMcAccountExpired(accountId, discordId);
      return false;
    }
    premiumSession = resolved.session;
    lastSessionRefreshAt = Date.now();
    config.authType = "ssid";
    config.ssid = resolved.session.accessToken;
    config.username = resolved.session.name;
    config.uuid = resolved.session.idDashed;
    return true;
  };

  // Pure Microsoft device-code (no stored SSID) — interactive on launch via console popup
  if (config.authType === "microsoft" && !config.ssid) {
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

      const authTitle = Titles.MinecraftNintendoSwitch || "00000000441cc96b";
      const cacheDir = `./prismarine-cache/${(config.label || config.username || "default").replace(/[^\w.-]/g, "_")}`;
      const msAccountKey = config.username || config.label || "mc-user";

      await log("info", "Starting Microsoft device-code authentication...", true);
      await log(
        "system",
        "Waiting for Microsoft login — open the link and enter the code when shown.",
        true,
      );
      await updateJob(jobId, "running");

      if (abortSignal.aborted) {
        return { status: "stopped", error: "Stopped by user" };
      }

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
          const expires = info?.expires_in || info?.expiresIn || info?.expires_on || 900;
          const mins = Math.max(1, Math.round(Number(expires) / 60) || 15);

          if (!code) {
            log(
              "warn",
              `Microsoft auth callback missing code. Raw: ${JSON.stringify(info).slice(0, 300)}`,
              true,
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

      // Race device-code against abort so Stop works during login wait
      let abortReject: ((e: Error) => void) | null = null;
      const abortWait = new Promise<never>((_, reject) => {
        abortReject = reject;
        if (abortSignal.aborted) {
          reject(new Error("Stopped by user"));
          return;
        }
        abortSignal.addEventListener(
          "abort",
          () => reject(new Error("Stopped by user")),
          { once: true },
        );
      });
      let mcToken: {
        token?: string;
        profile?: { name?: string; id?: string };
        certificates?: { profileKeys?: unknown };
      };
      try {
        mcToken = await Promise.race([
          authflow.getMinecraftJavaToken({
            fetchProfile: true,
            fetchCertificates: true,
          }),
          abortWait,
        ]);
      } catch (e) {
        if (abortSignal.aborted || /stopped by user/i.test(String(e))) {
          return { status: "stopped", error: "Stopped by user" };
        }
        throw e;
      }
      abortReject = null;

      if (abortSignal.aborted) {
        return { status: "stopped", error: "Stopped by user" };
      }

      if (!mcToken?.token) {
        return failAuth("Microsoft auth failed: no token returned", false);
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
        return failAuth("Microsoft auth failed: no Minecraft profile on this account", false);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let profileKeys = (mcToken as any).certificates?.profileKeys || null;
      if (profileKeys) {
        await log("info", "Chat certificates loaded (prismarine-auth)", true);
      } else {
        await log("info", "Fetching chat-signing certificates...", true);
        profileKeys = await fetchMinecraftCertificates(mcToken.token);
        if (profileKeys) await log("info", "Chat certificates loaded", true);
        else await log("warn", "Could not load chat certificates", true);
      }

      premiumSession = {
        accessToken: mcToken.token,
        name,
        id,
        idUndashed: formatUuidUndashed(id),
        idDashed: formatUuidDashed(id),
        profileKeys,
        source: "microsoft",
        certsExpiresOn:
          profileKeys?.expiresOn instanceof Date ? profileKeys.expiresOn.getTime() : null,
        certsRefreshAfter:
          profileKeys?.refreshAfter instanceof Date ? profileKeys.refreshAfter.getTime() : null,
      };
      lastSessionRefreshAt = Date.now();
      config.username = name;
      config.uuid = formatUuidDashed(id);
      // Keep as microsoft with token in memory for reconnect cert refresh via same session
      config.ssid = mcToken.token;
      await log("info", `Authenticated as ${name} (${formatUuidDashed(id)})`, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/stopped by user/i.test(msg) || abortSignal.aborted) {
        return { status: "stopped", error: "Stopped by user" };
      }
      return failAuth(`Microsoft auth failed: ${msg}`, false);
    }
  } else if (config.authType === "ssid" || (config.authType === "microsoft" && config.ssid)) {
    // SSID / microsoft-with-stored-token path
    config.authType = "ssid";
    const ok = await refreshPremiumSession(true);
    if (!ok) {
      return failAuth(
        "SSID validation failed — paste a fresh Minecraft access_token via Refresh Token.",
        false,
      );
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

  let connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      connectionTimeout = null;
    }
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  const disconnectBot = () => {
    cleanup();
    if (currentBot) {
      const bot = currentBot;
      currentBot = null;
      try {
        bot.quit("stop");
      } catch {
        try {
          bot.end("stop");
        } catch {
          /* ignore disconnect errors */
        }
      }
      try {
        bot.removeAllListeners();
      } catch {
        /* ignore */
      }
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
    // Server full is temporary — allow reconnect with backoff
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

    // Refresh SSID/certs on reconnect (live DB token + cert expiry)
    if (config.authType === "ssid" || premiumSession) {
      const ok = await refreshPremiumSession(reconnectAttempts > 0);
      if (!ok) {
        connecting = false;
        const msg =
          "SSID expired or invalid — open the account → Refresh Token, then launch again.";
        await updateJob(jobId, "error", msg);
        authFailed = true;
        stopped = true;
        terminal = { status: "error", error: msg };
        return;
      }
    }

    // Always tear down any previous bot before opening a new socket
    if (currentBot) {
      const prev = currentBot;
      currentBot = null;
      try {
        prev.quit("reconnect");
      } catch {
        try {
          prev.end("reconnect");
        } catch {
          /* ignore */
        }
      }
      try {
        prev.removeAllListeners();
      } catch {
        /* ignore */
      }
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
      if (currentBot) {
        const prev = currentBot;
        currentBot = null;
        try {
          prev.quit("reconnect");
        } catch {
          try {
            prev.end("reconnect");
          } catch {
            /* ignore */
          }
        }
        try {
          prev.removeAllListeners();
        } catch {
          /* ignore */
        }
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
        const isAuth =
          lower.includes("authenticat") ||
          lower.includes("not logged into") ||
          lower.includes("invalid session") ||
          lower.includes("not authenticated");
        const msg = isAuth
          ? `Authentication failed: ${reasonText}. Token may be expired — open account → Refresh Token.`
          : lower.includes("banned") || lower.includes("blocked") || lower.includes("suspicious")
            ? `Account blocked/banned: ${reasonText}`
            : `Not reconnecting: ${reasonText}`;
        log("error", msg, true).catch(() => {});
        if (isAuth) await markMcAccountExpired(accountId, discordId);
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
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
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
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
      // Ignore end events from bots that were already replaced
      if (currentBot !== bot && currentBot !== null) return;
      if (handlingDisconnect) return;
      const reasonText = formatKickReason(reason) || "connection closed";
      await scheduleReconnect(reasonText, false);
    });

    bot.on("death", () => {
      log("warn", "Bot died, respawning...").catch(() => {});
    });

    if (connectionTimeout) clearTimeout(connectionTimeout);
    connectionTimeout = setTimeout(() => {
      connectionTimeout = null;
      if (!connected && !stopped && !handlingDisconnect && currentBot === bot) {
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
