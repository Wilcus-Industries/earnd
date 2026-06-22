import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy. The app embeds no third-party scripts, iframes, or font
// hosts (next/font self-hosts; Stripe Checkout is a full-page redirect, not an
// embed), so everything is locked to 'self'. `'unsafe-inline'` is required for
// script/style because Next injects its inline runtime bootstrap and Tailwind/
// next/font inject inline styles; moving scripts to a per-request nonce is the
// documented follow-up to drop script 'unsafe-inline' entirely.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

// Baseline security headers applied to every response. Defends the admin/payout
// surfaces (clickjacking, MIME sniffing, referrer leakage) and, in production,
// pins HTTPS via HSTS.
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  // Transpile the shared workspace package (it ships raw TS).
  transpilePackages: ["@earnd/contracts"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
