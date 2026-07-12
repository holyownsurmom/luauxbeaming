const SITE_URL = process.env.SITE_URL!;
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

export async function pollJobs(workerId: string): Promise<Job[]> {
  const res = await fetchWithRetry(`${SITE_URL}/api/bots/worker/poll`, {
    method: "POST",
    headers,
    body: JSON.stringify({ worker_id: workerId }),
  });
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  const data = await res.json();
  return data.jobs ?? [];
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
    await fetchWithRetry(`${SITE_URL}/api/bots/worker/log`, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
    });
    flushFailures = 0;
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
    logBuffer.push({ job_id: jobId, discord_id: discordId, level, message });
    if (immediate || message.startsWith("MS_AUTH_REQUIRED|")) {
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

export async function updateJob(jobId: string, status: string, error?: string) {
  const body: Record<string, string> = { job_id: jobId, status, worker_id: WORKER_ID };
  if (error) body.error = error;
  try {
    const res = await fetchWithRetry(`${SITE_URL}/api/bots/worker/update`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[worker] update failed: HTTP ${res.status} for job ${jobId} → ${status}`);
    }
  } catch (e) {
    console.error("[worker] update failed:", e);
  }
}

/** Only write terminal status if the job is still running/claimed (never clobber error/stopped). */
export async function finalizeJob(
  jobId: string,
  status: "completed" | "error" | "stopped",
  error?: string,
) {
  await updateJob(jobId, status, error);
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

export async function checkJobStatuses(workerId: string, jobIds: string[]): Promise<{ id: string; status: string }[]> {
  try {
    const res = await fetchWithRetry(`${SITE_URL}/api/bots/worker/status`, {
      method: "POST",
      headers,
      body: JSON.stringify({ worker_id: workerId, job_ids: jobIds }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.jobs ?? [];
  } catch (e) {
    console.error("[worker] checkJobStatuses failed:", e);
    return [];
  }
}
