import type { Metadata } from "next";

/**
 * Single source of truth for site-wide SEO metadata.
 *
 * SITE_URL reads NEXT_PUBLIC_BASE_URL directly (not serverEnv()) on purpose:
 * metadataBase / sitemap / robots / manifest are evaluated at *build* time for
 * static generation, and serverEnv() validates the whole secret schema
 * (DATABASE_URL, Stripe keys, …) which isn't present during `next build`.
 * NEXT_PUBLIC_ vars are inlined at build, so this stays available everywhere —
 * the same pattern already used in market/page.tsx and publisher/page.tsx.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export const SITE_NAME = "earnd";
export const GITHUB_URL = "https://github.com/Wilcus-Industries/earnd";

export const DEFAULT_TITLE = "earnd — your terminal's top row is inventory";
export const DEFAULT_DESCRIPTION =
  "earnd is a terminal ad network. One line, pinned to the top row at every prompt. The developer who runs it earns 50% of the revenue their attention generates.";

export const KEYWORDS = [
  "terminal ad network",
  "developer attention",
  "earn from terminal",
  "terminal banner ads",
  "CPM advertising",
  "developer ad network",
  "command line ads",
  "shell prompt ads",
  "monetize terminal",
  "second-price auction",
];

/**
 * Site-wide defaults spread into the root layout. metadataBase makes every
 * relative OG/canonical URL resolve to an absolute one (required for crawlable
 * social previews). Icons wire up the existing favicon.ico + icon.svg.
 */
export const baseMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: DEFAULT_TITLE, template: "%s · earnd" },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: KEYWORDS,
  authors: [{ name: "earnd" }],
  creator: "earnd",
  publisher: "earnd",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon.svg",
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: "/",
    locale: "en_US",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

/**
 * Per-page metadata for public, indexable pages. Sets a canonical URL and
 * page-specific OG/Twitter title + description (Next deep-merges with the root
 * defaults, so the site-wide OG image and card type carry through).
 */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { url: path, title, description },
    // Next replaces (not deep-merges) the whole `twitter` object when a page
    // sets it, so re-assert the large-image card here or it silently downgrades
    // to the default "summary".
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * Metadata for gated, non-public pages (auth/token dashboards, sign-in). Keeps
 * them out of the index even if a URL leaks — belt-and-suspenders with robots.txt.
 */
export function noindexMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false },
  };
}
