import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { envStr } from "./luaux-server.server";

/** Timing-safe worker secret check (x-worker-secret header). */
export function authWorker(request: Request): boolean {
  const secret = envStr("WORKER_SECRET");
  if (!secret) return false;
  const token = request.headers.get("x-worker-secret") || "";
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function workerDb() {
  return createClient(envStr("SUPABASE_URL"), envStr("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
