import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Fast auth gate for the advertiser portal. `getSessionCookie` only checks that
 * a session cookie is present (no DB hit), so this runs cheaply on every matched
 * request. Authoritative validation happens server-side in the page/API via
 * `getSessionUser()` — a tampered cookie is rejected there.
 */
export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/advertiser")) {
    return NextResponse.next();
  }
  const sessionCookie = getSessionCookie(req);
  if (!sessionCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `redirect=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/advertiser/:path*"],
};
