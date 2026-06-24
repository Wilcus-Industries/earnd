import type { Metadata } from "next";
import type { MarketSnapshot } from "@earnd/contracts";
import { MarketBoard } from "@/components/MarketBoard";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "The bid market",
  description:
    "Live clearing prices for a developer's terminal top row — top bidders over time and the invalid-traffic rate, aggregated and slightly delayed so the auction stays honest.",
  path: "/market",
});

// Rendered per request (live data); the server does the first fetch for fast
// paint + SEO, then the client island polls.
export const dynamic = "force-dynamic";

async function getInitial(): Promise<MarketSnapshot | undefined> {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(new URL("/api/market", base), { cache: "no-store" });
    if (!res.ok) return undefined;
    return (await res.json()) as MarketSnapshot;
  } catch {
    return undefined; // client island will fetch
  }
}

export default async function MarketPage() {
  const initial = await getInitial();
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <header className="mb-10 flex flex-col gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">the bid market</p>
        <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          Top bidders, over time.
        </h1>
        <p className="max-w-xl text-ink-dim">
          The clearing price for a developer&apos;s top row, as a step line — a bid
          holds until it&apos;s outbid. Public data is aggregated, rounded, and
          slightly delayed; individual live max bids are never shown.
        </p>
      </header>
      <MarketBoard initial={initial} />
    </div>
  );
}
