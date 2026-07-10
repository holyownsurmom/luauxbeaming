const SITE_URL = process.env.SITE_URL!;
const WORKER_SECRET = process.env.WORKER_SECRET!;

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

export async function pollJobs(workerId: string): Promise<Job[]> {
  const res = await fetch(`${SITE_URL}/api/bots/worker/poll`, {
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

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushLogs();
  }, 2000);
}

async function flushLogs() {
  if (logBuffer.length === 0) return;
  const batch = logBuffer.splice(0, 50);
  try {
    await fetch(`${SITE_URL}/api/bots/worker/log`, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
    });
  } catch (e) {
    console.error("[worker] log flush failed:", e);
    // Re-queue on failure
    logBuffer.unshift(...batch);
  }
  if (logBuffer.length > 0) scheduleFlush();
}

export function createLogger(jobId: string, discordId: string) {
  return async (level: string, message: string) => {
    logBuffer.push({ job_id: jobId, discord_id: discordId, level, message });
    scheduleFlush();
  };
}

export async function updateJob(jobId: string, status: string, error?: string) {
  const body: Record<string, string> = { job_id: jobId, status };
  if (error) body.error = error;
  try {
    await fetch(`${SITE_URL}/api/bots/worker/update`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("[worker] update failed:", e);
  }
}

export async function flushAllLogs() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushLogs();
}
