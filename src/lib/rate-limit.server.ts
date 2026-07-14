/**
 * In-memory sliding-window rate limiter (per serverless isolate).
 * Good enough for admin login / invoice abuse; not a global multi-region store.
 */

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

/** Drop empty/old keys periodically so memory stays bounded */
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.timestamps.length === 0 || b.timestamps[b.timestamps.length - 1]! < now - 3_600_000) {
      buckets.delete(k);
    }
  }
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

/**
 * @param key unique bucket (e.g. `admin-login:ip:user`)
 * @param limit max events in window
 * @param windowMs window length
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const cutoff = now - windowMs;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  bucket.timestamps.push(now);
  return { ok: true, remaining: limit - bucket.timestamps.length };
}

/** Best-effort client IP from common proxy headers */
export function clientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return "unknown";
}

export function rateLimitResponse(retryAfterSec: number, message = "Too many requests") {
  return Response.json(
    { error: message, retryAfterSec },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    },
  );
}
