import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { TopBanner } from "@/components/TopBanner";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";

const display = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
const body = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "earnd — your terminal's top row is inventory",
  description:
    "earnd is a terminal ad network. One line, pinned to the top row at every prompt. The developer who runs it earns 50% of the revenue their attention generates.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        {/* The signature: the site's own top row IS a live earnd banner — the
            product wears itself. Every page is monetized inventory. */}
        <TopBanner />
        <SiteNav />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
