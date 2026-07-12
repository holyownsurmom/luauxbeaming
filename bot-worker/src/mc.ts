import { createLogger, updateJob } from "./api.js";

export type JobRunResult = {
  status: "completed" | "error" | "stopped";
  error?: string;
};

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
const MAX_RECONNECT_ATTEMPTS = 25;
const RECONNECT_BASE_DELAY = 5000;

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

async function fetchUuidFromUsername(username: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id || null;
  } catch {
    return null;
  }
}

async function fetchMinecraftProfile(accessToken: string): Promise<{ name: string; id: string } | null> {
  try {
    const res = await fetch("https://api.minecraftservices.com/minecraft/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.name && data?.id) return { name: data.name, id: data.id };
    return null;
  } catch {
    return null;
  }
}

/** Chat-signing keypair (1.19+) — missing keys often cause Invalid sequence / chat kicks on modern SMPs */
async function fetchMinecraftCertificates(accessToken: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch("https://api.minecraftservices.com/player/certificates", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const cert = await res.json();
    if (!cert?.keyPair?.publicKey || !cert?.keyPair?.privateKey) return null;

    const crypto = await import("crypto");
    const toDer = (pem: string) => {
      const b64 = pem
        .replace(/-----BEGIN [A-Z ]+-----/g, "")
        .replace(/-----END [A-Z ]+-----/g, "")
        .replace(/\s+/g, "");
      return Buffer.from(b64, "base64");
    };
    const publicDER = toDer(cert.keyPair.publicKey);
    const privateDER = toDer(cert.keyPair.privateKey);
    return {
      publicPEM: cert.keyPair.publicKey,
      privatePEM: cert.keyPair.privateKey,
      publicDER,
      privateDER,
      signature: Buffer.from(cert.publicKeySignature || "", "base64"),
      signatureV2: Buffer.from(cert.publicKeySignatureV2 || cert.publicKeySignature || "", "base64"),
      expiresOn: new Date(cert.expiresAt),
      refreshAfter: new Date(cert.refreshedAfter || cert.expiresAt),
      public: crypto.createPublicKey({ key: publicDER, format: "der", type: "spki" }),
      private: crypto.createPrivateKey({ key: privateDER, format: "der", type: "pkcs8" }),
    };
  } catch {
    return null;
  }
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

  let ssidProfile: { name: string; id: string } | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let profileKeys: any = null;
  // Microsoft session resolved ONCE per job (not on every reconnect)
  let msSession: {
    accessToken: string;
    name: string;
    id: string;
  } | null = null;

  if (config.authType === "ssid") {
    if (!config.ssid) {
      await log("error", "SSID token is empty. Re-add your account with a valid SSID.");
      await updateJob(jobId, "error", "SSID token is empty");
      return { status: "error", error: "SSID token is empty" };
    }

    await log("info", "Resolving Minecraft profile from SSID token...");
    ssidProfile = await fetchMinecraftProfile(config.ssid);
    if (!ssidProfile) {
      await log("error", "Could not resolve Minecraft profile from SSID token. The token may be expired or invalid.");
      await updateJob(jobId, "error", "SSID token invalid — could not resolve profile");
      return { status: "error", error: "SSID token invalid — could not resolve profile" };
    }
    await log("info", `Resolved profile: ${ssidProfile.name} (${ssidProfile.id})`);
    await log("info", "Fetching chat-signing certificates for SSID session...");
    profileKeys = await fetchMinecraftCertificates(config.ssid);
    if (profileKeys) {
      await log("info", "Chat certificates loaded");
    } else {
      await log("warn", "Could not load chat certificates — server may kick with Invalid sequence");
    }
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
      // msal + MinecraftJava often returns invalid_grant and camelCase-only code fields.
      const authTitle =
        Titles.MinecraftNintendoSwitch || "00000000441cc96b";
      const cacheDir = `./prismarine-cache/${(config.label || "default").replace(/[^\w.-]/g, "_")}`;
      const accountKey = config.username || config.label || "mc-user";

      await log("info", "Starting Microsoft device code authentication...");
      await log(
        "system",
        "Waiting for Microsoft login — a popup should appear with the link and code.",
      );

      const authflow = new Authflow(
        accountKey,
        cacheDir,
        { authTitle, deviceType: "Nintendo", flow: "live" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (info: any) => {
          // Support both live (snake_case) and msal (camelCase) field names
          const code =
            info?.user_code ||
            info?.userCode ||
            info?.code ||
            "";
          const uri =
            info?.verification_uri ||
            info?.verificationUri ||
            info?.verification_url ||
            "https://www.microsoft.com/link";
          const expires =
            info?.expires_in || info?.expiresIn || info?.expires_on || 900;
          const mins = Math.max(1, Math.round(Number(expires) / 60) || 15);

          if (!code) {
            // Still surface raw payload so we can debug without hanging silently
            console.log("[ms-auth] device code payload:", JSON.stringify(info));
            log(
              "warn",
              `Microsoft auth callback missing code. Raw: ${JSON.stringify(info).slice(0, 300)}`,
            ).catch(() => {});
            return;
          }

          // Structured log for dashboard popup (do not change format)
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

      msSession = { accessToken: mcToken.token, name, id };
      await log("info", `Authenticated as ${name} (${id})`);
      // Prefer certificates from prismarine-auth; fallback to direct Mojang API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const certs = (mcToken as any).certificates?.profileKeys;
      if (certs) {
        profileKeys = certs;
        await log("info", "Chat certificates loaded (prismarine-auth)");
      } else {
        await log("info", "Fetching chat-signing certificates...");
        profileKeys = await fetchMinecraftCertificates(mcToken.token);
        if (profileKeys) await log("info", "Chat certificates loaded");
        else await log("warn", "Could not load chat certificates");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log("error", `Microsoft auth failed: ${msg}`);
      await updateJob(jobId, "error", `Microsoft auth failed: ${msg}`);
      return { status: "error", error: `Microsoft auth failed: ${msg}` };
    }
  }

  await log(
    "system",
    `Connecting to ${config.serverHost}:${config.serverPort} (anti-ban mode v2)...`,
  );

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
  function startAntiAfk(_bot: any) {
    // DISABLED: look/move/control packets cause "Invalid sequence" on modern SMP
    // (ViaVersion / Paper / DonutSMP). Stay still — only chat keeps the session useful.
    if (antiAfkTimer) {
      clearTimeout(antiAfkTimer);
      antiAfkTimer = null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function startMessageLoop(bot: any) {
    const scheduleNext = () => {
      if (stopped || abortSignal.aborted) return;

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

    const initialDelay = randomBetween(25000, 55000);
    log("info", `Waiting ${(initialDelay / 1000).toFixed(0)}s before first message...`).catch(() => {});
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

  async function connect() {
    if (stopped || abortSignal.aborted || authFailed || connecting) return;
    connecting = true;

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
      await new Promise((r) => setTimeout(r, 1500));
    }

    const injectPremiumAuth = (
      accessToken: string,
      name: string,
      rawUuid: string,
    ) => {
      const undashed = rawUuid.replace(/-/g, "");
      const dashed =
        undashed.length === 32
          ? `${undashed.slice(0, 8)}-${undashed.slice(8, 12)}-${undashed.slice(12, 16)}-${undashed.slice(16, 20)}-${undashed.slice(20)}`
          : rawUuid;
      return (
        client: {
          session: unknown;
          username: string;
          uuid?: string;
          profileKeys?: unknown;
          emit: (event: string, data: unknown) => void;
        },
        options: {
          accessToken?: string;
          haveCredentials?: boolean;
          connect: (client: unknown) => void;
        },
      ) => {
        const session = {
          accessToken,
          clientToken: null,
          selectedProfile: { name, id: undashed },
          availableProfiles: [{ name, id: undashed }],
        };
        client.session = session;
        client.username = name;
        client.uuid = dashed;
        options.accessToken = accessToken;
        options.haveCredentials = true;
        if (profileKeys) {
          client.profileKeys = profileKeys;
        }
        client.emit("session", session);
        options.connect(client);
      };
    };

    const botOptions: Record<string, unknown> = {
      host: config.serverHost,
      port: config.serverPort,
      username: config.username || config.label || "Player",
      hideErrors: true,
      checkTimeoutInterval: 60_000,
      keepAlive: true,
      respawn: true,
      // MUST keep physics plugin loaded — it sends teleport_confirm (1.9+).
      // Disabling it causes "Invalid sequence" kicks on Paper/Via/DonutSMP.
      physicsEnabled: true,
      viewDistance: "tiny",
      brand: "vanilla",
      version: false,
    };

    if (config.authType === "microsoft" && msSession) {
      botOptions.username = msSession.name;
      botOptions.auth = injectPremiumAuth(
        msSession.accessToken,
        msSession.name,
        msSession.id,
      );
    }

    if (config.authType === "ssid" && config.ssid && ssidProfile) {
      botOptions.username = ssidProfile.name;
      botOptions.auth = injectPremiumAuth(config.ssid, ssidProfile.name, ssidProfile.id);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bot: any;
    try {
      bot = (mineflayer as any).createBot(botOptions);
    } catch (e) {
      connecting = false;
      const msg = e instanceof Error ? e.message : String(e);
      log("error", `createBot failed: ${msg}`).catch(() => {});
      reconnectAttempts++;
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !stopped) {
        reconnectTimer = setTimeout(() => connect(), randomBetween(8000, 15000));
      } else {
        stopped = true;
        terminal = { status: "error", error: msg };
      }
      return;
    }
    currentBot = bot;
    connecting = false;

    let connected = false;
    let handlingDisconnect = false;
    let loopsStarted = false;

    const scheduleReconnect = async (reasonText: string, fromKick: boolean) => {
      if (handlingDisconnect) return;
      handlingDisconnect = true;
      cleanup();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (currentBot === bot) {
        try {
          bot.removeAllListeners();
          bot.quit("reconnect");
        } catch {
          try {
            bot.end("reconnect");
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
        log("error", msg).catch(() => {});
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
        log("error", msg).catch(() => {});
        await updateJob(jobId, "error", msg);
        authFailed = true;
        stopped = true;
        terminal = { status: "error", error: msg };
        return;
      }

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        log("error", "Max reconnect attempts reached").catch(() => {});
        await updateJob(jobId, "error", "Max reconnect attempts");
        stopped = true;
        terminal = { status: "error", error: "Max reconnect attempts" };
        return;
      }

      reconnectAttempts++;
      // Protocol kicks ("Invalid sequence", "Timed out") need longer cool-down
      const isProtocolKick =
        lower.includes("invalid sequence") ||
        lower.includes("timed out") ||
        lower.includes("timeout");
      const baseDelay = isProtocolKick
        ? randomBetween(20, 45) * 1000
        : reconnectAttempts <= 3
          ? RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1)
          : randomBetween(45, 150) * 1000;
      const delay = baseDelay + randomBetween(0, 8000);
      log(
        "info",
        `Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})${fromKick ? " after kick" : ""}: ${reasonText.slice(0, 80)}`,
      ).catch(() => {});
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    let lastChatKey = "";
    let lastChatAt = 0;
    let lastKickKey = "";
    let lastKickAt = 0;

    let loggedInOnce = false;

    bot.on("login", () => {
      if (currentBot !== bot) return;
      connected = true;
      if (loggedInOnce) return;
      loggedInOnce = true;
      log("info", `Logged in as ${bot.username}`).catch(() => {});
    });

    bot.on("spawn", () => {
      if (currentBot !== bot) return;
      if (loopsStarted) return;
      loopsStarted = true;
      reconnectAttempts = 0;
      log("info", "Spawned in world (idle mode — no movement packets)").catch(() => {});
      updateJob(jobId, "running").catch(() => {});

      // Sit completely still; only chat after settle
      setTimeout(() => {
        if (stopped || abortSignal.aborted || currentBot !== bot) return;
        startAntiAfk(bot);
        startMessageLoop(bot);
      }, randomBetween(25000, 40000));
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
      log("error", `Error: ${err.message}`).catch(() => {});
    });

    bot.on("kicked", async (reason: unknown) => {
      if (currentBot !== bot && handlingDisconnect) return;
      const reasonText = formatKickReason(reason);
      const now = Date.now();
      if (reasonText === lastKickKey && now - lastKickAt < 3000) {
        await scheduleReconnect(reasonText, true);
        return;
      }
      lastKickKey = reasonText;
      lastKickAt = now;
      log("warn", `Kicked: ${reasonText}`).catch(() => {});
      await scheduleReconnect(reasonText, true);
    });

    bot.on("end", async (reason: unknown) => {
      clearTimeout(connectionTimeout);
      if (handlingDisconnect) return;
      const reasonText = formatKickReason(reason) || "connection closed";
      log("system", `Disconnected: ${reasonText}`).catch(() => {});
      await scheduleReconnect(reasonText, false);
    });

    bot.on("death", () => {
      log("warn", "Bot died, respawning...").catch(() => {});
    });

    const connectionTimeout = setTimeout(() => {
      if (!connected && !stopped && !handlingDisconnect) {
        log("error", "Connection timed out").catch(() => {});
        cleanup();
        disconnectBot();
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
        if (cleanupTimer) clearInterval(cleanupTimer);
        if (abortSignal.aborted && terminal.status === "completed") {
          terminal = { status: "stopped", error: "Stopped by user" };
        }
        resolve(terminal);
      }
    }, 1000);
  });
}
