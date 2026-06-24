import { auth } from "@/lib/auth";
import { headers } from "next/headers";

/**
 * Returns the authenticated advertiser user, or null. Call from Server
 * Components and API routes. better-auth reads the session cookie from the
 * request headers (works in both App Router server components and route
 * handlers — route handlers forward the incoming cookie header).
 *
 * A thrown error (e.g. BETTER_AUTH_SECRET unset during `next build`, or a
 * tampered/expired session) is treated as "no session" rather than crashing the
 * page. Authoritative gating still happens in middleware (cookie presence) and
 * the API routes (this returns null → 401).
 */
export async function getSessionUser() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    return session?.user ?? null;
  } catch {
    return null;
  }
}
