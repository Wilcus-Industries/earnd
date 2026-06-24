import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Crawl directives. Public marketing/market/privacy pages are allowed; every
// API, admin, auth, advertiser-tooling, token-dashboard, and click-redirect path
// is disallowed. "/publisher/" (trailing slash) blocks the token dashboards at
// /publisher/[id] while leaving the public "/publisher" install page crawlable.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin/", "/advertiser", "/bid", "/sign-in", "/publisher/", "/r/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
