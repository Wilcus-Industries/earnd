/**
 * Distributed fixed-window rate limiter for unauthenticated endpoints.
 *
 * Backed by Postgres (the `rate_limits` table), NOT process memory: every
 * serverless instance shares the same counter, so the limit can't be multiplied by
 * the instance count the way an in-memory map would be. One atomic upsert per call
 * keeps it allocation-light and free of read-modify-write races.
 *
 * It blunts cheap abuse (registration floods, bid spam from one IP). It is keyed on
 * a best-effort client IP, which is a rate-abuse control, not an identity.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (for a Retry-After header). */
  retryAfter: number;
}

/**
 * Record a hit for `key` and report whether it is within `limit` per `windowMs`.
 *
 * Atomic: a single INSERT … ON CONFLICT DO UPDATE either opens a fresh window or
 * increments the counter — unless the stored window has already expired, in which
 * case it resets to 1. The RETURNING count is the post-increment value, so we block
 * exactly when it exceeds the limit. Fails open (never throws away a request on a
 * limiter hiccup) since this guards abuse, not correctness.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const windowSeconds = Math.ceil(windowMs / 1000);
  const freshReset = sql`now() + (${windowSeconds} * interval '1 second')`;
  const rows = await getDb()
    .insert(rateLimits)
    .values({ key, count: 1, resetAt: freshReset })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.resetAt} <= now() then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${rateLimits.resetAt} <= now() then ${freshReset} else ${rateLimits.resetAt} end`,
      },
    })
    .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });

  const row = rows[0];
  if (!row) return { ok: true, retryAfter: 0 };
  const retryAfter = Math.max(0, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000));
  return { ok: row.count <= limit, retryAfter };
}

/**
 * Best-effort client IP for rate-limit bucketing. Prefer `x-real-ip`, which the
 * Vercel proxy sets to the true client address. A client-supplied
 * `x-forwarded-for` is APPENDED to by the proxy, not replaced, so its leftmost
 * entry is attacker-controlled and must not be trusted as identity — we only fall
 * back to it when `x-real-ip` is absent. A missing header degrades to one shared
 * bucket rather than disabling the limit.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return "unknown";
}
