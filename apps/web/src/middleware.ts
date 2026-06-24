import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Per-request Content-Security-Policy (with a script nonce) plus the fast auth gate
 * for the advertiser portal.
 *
 * The nonce is what lets us drop `'unsafe-inline'` from `script-src`: Next reads the
 * nonce from the request's CSP header and stamps it onto its own bootstrap scripts,
 * and `'strict-dynamic'` extends trust to anything those scripts load. `style-src`
 * keeps `'unsafe-inline'` — Tailwind / next/font inject inline styles with no nonce
 * hook, and styles are a far weaker XSS sink than scripts. This is a per-request
 * header, so it lives here rather than in next.config's static `headers()`; the
 * other security headers (HSTS, X-Frame-Options, …) stay there.
 *
 * `getSessionCookie` only checks that a session cookie is present (no DB hit), so
 * the /advertiser gate stays cheap. Authoritative validation still happens
 * server-side via `getSessionUser()` — a tampered cookie is rejected there.
 */
function buildCsp(nonce: string, isProd: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // jsdelivr is required by the frimousse emoji picker (/bid), which fetches
    // its emoji dataset from cdn.jsdelivr.net/npm/emojibase-data at runtime.
    "connect-src 'self' https://cdn.jsdelivr.net",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/advertiser")) {
    const sessionCookie = getSessionCookie(req);
    if (!sessionCookie) {
      const url = req.nextUrl.clone();
      url.pathname = "/sign-in";
      url.search = `redirect=${encodeURIComponent(req.nextUrl.pathname)}`;
      return NextResponse.redirect(url);
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "production");

  // Next picks up the nonce from the request's CSP header and applies it to its
  // scripts; we also set the header on the response so the browser enforces it.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Run on every document route so each HTML response gets a nonce'd CSP, and so the
  // /advertiser gate above still fires. Skip Next internals and static assets — they
  // serve no executable document context and don't need a per-request nonce.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
