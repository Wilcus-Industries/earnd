import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Baseline security headers applied to every response. Defends the admin/payout
// surfaces (clickjacking, MIME sniffing, referrer leakage) and, in production,
// pins HTTPS via HSTS.
//
// Content-Security-Policy is NOT here: it carries a per-request script nonce, so
// it's set in middleware.ts (src/middleware.ts) instead of these static headers.
const securityHeaders = [
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
