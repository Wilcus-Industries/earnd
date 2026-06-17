"use client";

import useSWR from "swr";
import type { MarketSnapshot } from "@earnd/contracts";
import { formatMillicents } from "@earnd/contracts/config";
import { fetcher } from "@/lib/fetcher";

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
        {label}
      </span>
      <span className={`tnum font-mono text-2xl ${accent ? "text-signal" : "text-ink"}`}>
        {value}
      </span>
    </div>
  );
}

// Live market vitals for the hero. Polls the public snapshot; degrades to dashes
// before the first response so layout never jumps.
export function LiveStrip() {
  const { data } = useSWR<MarketSnapshot>("/api/market", fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: false,
  });

  const clearing = data?.leaderboard?.[0]?.cpmMillicents;
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-6 border-y border-wire py-6 sm:grid-cols-4">
      <Stat label="top bid / 1k" value={clearing != null ? formatMillicents(clearing) : "—"} accent />
      <Stat label="impressions / min" value={data ? String(data.impressionsPerMinute) : "—"} />
      <Stat label="live campaigns" value={data ? String(data.liveCampaigns) : "—"} />
      <Stat label="publisher share" value="50%" />
    </dl>
  );
}
