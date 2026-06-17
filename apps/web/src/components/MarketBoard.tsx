"use client";

import dynamic from "next/dynamic";
import useSWR from "swr";
import type { MarketSnapshot } from "@earnd/contracts";
import { formatMillicents } from "@earnd/contracts/config";
import { fetcher } from "@/lib/fetcher";

// Client-only chart island (uPlot touches the DOM/canvas, no SSR).
const BidChart = dynamic(() => import("./BidChart"), {
  ssr: false,
  loading: () => <div className="h-[320px] w-full animate-pulse rounded bg-panel" />,
});

export function MarketBoard({ initial }: { initial?: MarketSnapshot }) {
  const { data } = useSWR<MarketSnapshot>("/api/market", fetcher, {
    refreshInterval: 4000,
    fallbackData: initial,
    revalidateOnFocus: false,
  });

  const rows = data?.leaderboard ?? [];
  const asOf = data ? new Date(data.asOf) : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-md border border-wire bg-panel/40 p-4">
        {data && data.series.length > 0 ? (
          <BidChart series={data.series} />
        ) : (
          <div className="flex h-[320px] items-center justify-center font-mono text-sm text-ink-faint">
            no clearing history yet — bids will plot here as they clear
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-wire">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-wire font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">advertiser</th>
              <th className="px-4 py-3 font-medium">creative</th>
              <th className="px-4 py-3 text-right font-medium">bid / 1k</th>
              <th className="px-4 py-3 text-right font-medium">spend</th>
            </tr>
          </thead>
          <tbody className="font-mono text-sm">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-faint">
                  no live campaigns
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.rank} className="border-b border-wire/60 last:border-0">
                <td className={`px-4 py-3 tnum ${r.rank === 1 ? "text-signal" : "text-ink-faint"}`}>
                  {String(r.rank).padStart(2, "0")}
                </td>
                <td className="px-4 py-3 text-ink">{r.advertiser}</td>
                <td className="max-w-[320px] truncate px-4 py-3 text-ink-dim">{r.line}</td>
                <td className={`px-4 py-3 text-right tnum ${r.rank === 1 ? "text-signal" : "text-ink"}`}>
                  {formatMillicents(r.cpmMillicents)}
                </td>
                <td className="px-4 py-3 text-right tnum text-ink-dim">
                  {formatMillicents(r.spendMillicents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="font-mono text-[11px] text-ink-faint">
        {data ? (
          <>
            {data.impressionsPerMinute} impressions/min · {data.liveCampaigns} live ·{" "}
            {(data.ivtRate * 100).toFixed(1)}% filtered (IVT, unbilled) · aggregated &amp;
            delayed{asOf ? ` · as of ${asOf.toLocaleTimeString()}` : ""}
          </>
        ) : (
          "loading market…"
        )}
      </p>
    </div>
  );
}
