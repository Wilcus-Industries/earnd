import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Only the four public, indexable routes. Gated routes are intentionally
// omitted (also noindex'd via middleware + disallowed in robots.txt).
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/publisher`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/market`, lastModified, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: "monthly", priority: 0.4 },
  ];
}
