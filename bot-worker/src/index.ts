import "dotenv/config";
import { pollJobs, updateJob, flushAllLogs } from "./api.js";
import { runMcBot, type McJobConfig } from "./mc.js";
import { runDiscordBot, type DiscordJobConfig } from "./discord.js";

const WORKER_ID = process.env.WORKER_ID || `worker-${Date.now()}`;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "3000", 10);

if (!process.env.SITE_URL) {
  console.error("[worker] ERROR: SITE_URL is not set!");
  console.error("[worker] Current directory:", process.cwd());
  console.error("[worker] Expected .env file at:", process.cwd() + "/.env");
  console.error("[worker] Available env vars:", Object.keys(process.env).filter(k => k.startsWith("SITE") || k.startsWith("WORKER")).join(", ") || "none found");
  process.exit(1);
}

if (!process.env.WORKER_SECRET) {
  console.error("[worker] ERROR: WORKER_SECRET is not set!");
  process.exit(1);
}

console.log(`[worker] ${WORKER_ID} started, polling every ${POLL_INTERVAL}ms`);
console.log(`[worker] SITE_URL=${process.env.SITE_URL}`);

async function claimJob(job: {
  id: string;
  discord_id: string;
  type: string;
  config: unknown;
}) {
  if (runningJobs.has(job.id)) return;

  const controller = new AbortController();
  runningJobs.set(job.id, controller);

  console.log(`[worker] claimed job ${job.id} (${job.type})`);

  try {
    if (job.type === "mc") {
      await runMcBot(
        job.id,
        job.discord_id,
        job.config as McJobConfig,
        controller.signal
      );
    } else if (job.type === "discord") {
      await runDiscordBot(
        job.id,
        job.discord_id,
        job.config as DiscordJobConfig,
        controller.signal
      );
    }

    if (!controller.signal.aborted) {
      await updateJob(job.id, "completed");
      console.log(`[worker] job ${job.id} finished (completed)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${job.id} crashed:`, msg);
    await updateJob(job.id, "error", msg);
  } finally {
    runningJobs.delete(job.id);
  }
}

async function poll() {
  try {
    const jobs = await pollJobs(WORKER_ID);

    for (const job of jobs) {
      claimJob(job);
    }
  } catch (err) {
    console.error("[worker] poll error:", err);
  }
}

setInterval(poll, POLL_INTERVAL);
poll();

async function shutdown() {
  console.log("[worker] shutting down...");
  for (const [id, controller] of runningJobs) {
    console.log(`[worker] aborting job ${id}`);
    controller.abort();
  }
  runningJobs.clear();
  await flushAllLogs();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
