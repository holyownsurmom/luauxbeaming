import { db } from "./supabase.js";
import { runMcBot, type McJobConfig } from "./mc.js";
import { runDiscordBot, type DiscordJobConfig } from "./discord.js";

const WORKER_ID = process.env.WORKER_ID || `worker-${Date.now()}`;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "3000", 10);

const runningJobs = new Map<string, AbortController>();

console.log(`[worker] ${WORKER_ID} started, polling every ${POLL_INTERVAL}ms`);

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

  await db
    .from("bot_jobs")
    .update({
      status: "running",
      worker_id: WORKER_ID,
      started_at: new Date().toISOString(),
    })
    .eq("id", job.id);

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

    const finalStatus = controller.signal.aborted ? "stopped" : "stopped";
    await db
      .from("bot_jobs")
      .update({
        status: finalStatus,
        stopped_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    console.log(`[worker] job ${job.id} finished (${finalStatus})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${job.id} crashed:`, msg);

    await db
      .from("bot_jobs")
      .update({
        status: "error",
        error: msg,
        stopped_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  } finally {
    runningJobs.delete(job.id);
  }
}

async function handleStopSignals() {
  const { data: stoppingJobs } = await db
    .from("bot_jobs")
    .select("id")
    .eq("status", "stopping");

  if (!stoppingJobs?.length) return;

  for (const job of stoppingJobs) {
    const controller = runningJobs.get(job.id);
    if (controller) {
      console.log(`[worker] stopping job ${job.id}`);
      controller.abort();
    } else {
      await db
        .from("bot_jobs")
        .update({
          status: "stopped",
          stopped_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }
  }
}

async function poll() {
  try {
    await handleStopSignals();

    const { data: pendingJobs } = await db
      .from("bot_jobs")
      .select("id, discord_id, type, config")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(5);

    if (!pendingJobs?.length) return;

    for (const job of pendingJobs) {
      claimJob(job);
    }
  } catch (err) {
    console.error("[worker] poll error:", err);
  }
}

setInterval(poll, POLL_INTERVAL);
poll();

process.on("SIGINT", async () => {
  console.log("[worker] shutting down...");
  for (const [id, controller] of runningJobs) {
    console.log(`[worker] aborting job ${id}`);
    controller.abort();
  }
  runningJobs.clear();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("[worker] shutting down...");
  for (const [id, controller] of runningJobs) {
    console.log(`[worker] aborting job ${id}`);
    controller.abort();
  }
  runningJobs.clear();
  process.exit(0);
});
