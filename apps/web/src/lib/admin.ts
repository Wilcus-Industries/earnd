import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/env";

/** Extract a bearer token from the Authorization header (with or without "Bearer "). */
export function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : header;
}

/** Constant-time string compare that is also safe across differing lengths. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Fail-closed admin gate shared by the moderation queue and the payout runner.
 * With no EARND_ADMIN_TOKEN configured, NOTHING privileged is allowed — creatives
 * stay pending and no payout can be triggered.
 */
export function isAdmin(req: Request): boolean {
  const expected = serverEnv().EARND_ADMIN_TOKEN;
  if (!expected) return false;
  return constantTimeEqual(bearerToken(req), expected);
}
