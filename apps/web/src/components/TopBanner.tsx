"use client";

import Link from "next/link";
import useSWR from "swr";
import type { MarketSnapshot } from "@earnd/contracts";
import { formatMillicents } from "@earnd/contracts/config";
import { fetcher } from "@/lib/fetcher";

const HOUSE_LINE = "your terminal's top row is for sale — one line, every prompt. place a bid →";

// The site's own pinned top row, rendered as a live earnd banner. It polls the
// public market and shows the current rank-1 creative + clearing price. This is
// the product demonstrating itself: the row you're reading is inventory.
export function TopBanner() {
  const { data } = useSWR<MarketSnapshot>("/api/market", fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: false,
  });

  const top = data?.leaderboard?.[0];
  const live = Boolean(top);
  const line = top?.line ?? HOUSE_LINE;
  const price = data ? `${formatMillicents(data.leaderboard[0]?.cpmMillicents ?? 0)}/1k` : "—";

  return (
    <Link
      href="/market"
      aria-label="Live market — the current top bid is shown on this row"
      className="group block border-b border-wire bg-panel"
    >
      <div className="mx-auto flex h-9 max-w-6xl items-center gap-3 px-4 font-mono text-[13px]">
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className={`onair-dot inline-block h-2 w-2 rounded-full ${live ? "bg-signal" : "bg-ink-faint"}`}
            aria-hidden
          />
          <span className={`text-[10px] font-semibold tracking-[0.18em] ${live ? "text-signal" : "text-ink-faint"}`}>
            {live ? "ON AIR" : "OPEN"}
          </span>
        </span>

        <span className="min-w-0 flex-1 truncate text-ink-dim group-hover:text-ink">
          {line}
        </span>

        <span className="hidden shrink-0 items-center gap-2 text-ink-faint sm:flex">
          <span className="tnum text-ink">{price}</span>
          <span className="text-[10px] uppercase tracking-widest">this row earns</span>
        </span>
      </div>
    </Link>
  );
}
