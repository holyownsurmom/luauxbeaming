import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const lockPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.worker.lock");

/** Prevent two bot-worker processes fighting over jobs / OTP. */
export function acquireInstanceLock(): void {
  try {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, "utf8").trim();
      const pid = parseInt(raw, 10);
      if (pid && pid !== process.pid) {
        try {
          // throws if process dead
          process.kill(pid, 0);
          console.error(
            `[worker] FATAL: another bot-worker is already running (pid ${pid}). ` +
              `Stop it first: pm2 kill  then start a single instance.`,
          );
          process.exit(1);
        } catch {
          // stale lock
        }
      }
    }
    fs.writeFileSync(lockPath, String(process.pid), "utf8");
  } catch (e) {
    console.warn("[worker] instance lock failed:", e);
  }

  const release = () => {
    try {
      if (fs.existsSync(lockPath)) {
        const raw = fs.readFileSync(lockPath, "utf8").trim();
        if (raw === String(process.pid)) fs.unlinkSync(lockPath);
      }
    } catch {
      /* ignore */
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => {
    release();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    release();
    process.exit(0);
  });
}
