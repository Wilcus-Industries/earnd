/**
 * Minimal in-memory fixed-window rate limiter for unauthenticated endpoints.
 *
 * Scope + limits: this is per-server-instance and resets on cold start / deploy.
 * It blunts cheap abuse (registration floods, bid spam from one IP) but is NOT a
 * distributed quota — a multi-instance deployment should front this with a shared
 * store (Redis/Upstash) or an edge limiter. Tracked as the durable-limiter TODO
 * alongside proof-of-possession on /api/devices/register.
 *
 * Fixed-window (not token-bucket) keeps it allocation-light and predictable; the
 * map is swept lazily so it can't grow without bound.
 */

interface Window {
  count: number;
  resetAt: number; // epoch ms when the current window expires
}

const buckets = new Map<string, Window>();
let lastSweep = 0;

// Drop expired windows occasionally so the map can't leak under many distinct keys.
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, w] of buckets) {
    if (w.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (for a Retry-After header). */
  retryAfter: number;
}

/**
 * Record a hit for `key` and report whether it is within `limit` per `windowMs`.
 * Returns ok:false once the window's count exceeds the limit.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const w = buckets.get(key);
  if (!w || w.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  w.count += 1;
  if (w.count > limit) {
    return { ok: false, retryAfter: Math.ceil((w.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * Best-effort client IP from proxy headers (Vercel/most reverse proxies set
 * x-forwarded-for). Falls back to a constant so a missing header degrades to a
 * single shared bucket rather than disabling the limit. These headers are
 * spoofable end-to-end, so this is a rate-abuse control, not an identity.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
