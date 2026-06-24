import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { TopBanner } from "@/components/TopBanner";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { JsonLd } from "@/components/JsonLd";
import { Analytics } from "@vercel/analytics/next";
import {
  baseMetadata,
  DEFAULT_DESCRIPTION,
  GITHUB_URL,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";

const display = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
const body = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

export const metadata: Metadata = baseMetadata;

// Site-wide structured data: who publishes the site (Organization) and the site
// itself (WebSite). Lets search engines render brand knowledge panels and link
// the GitHub profile as an authoritative sameAs.
const orgSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon.svg`,
  description: DEFAULT_DESCRIPTION,
  sameAs: [GITHUB_URL],
};

const siteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <JsonLd data={[orgSchema, siteSchema]} />
        {/* The signature: the site's own top row IS a live earnd banner — the
            product wears itself. Every page is monetized inventory. */}
        <TopBanner />
        <SiteNav />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
