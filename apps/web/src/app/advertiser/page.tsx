"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatMillicents } from "@earnd/contracts/config";
import { authClient } from "@/lib/auth-client";

interface AdItem {
  adId: string;
  line: string;
  displayUrl: string;
  targetUrl: string;
  icon: string | null;
  moderation: string;
  adCreatedAt: string;
  campaignName: string;
  maxCpmMillicents: number;
  budgetMillicents: number;
  dailyCapMillicents: number | null;
  bidStatus: string;
  bidCreatedAt: string;
  views: number;
  spendMillicents: number;
}

const moderationBadge: Record<string, { label: string; cls: string }> = {
  pending: { label: "Awaiting moderation", cls: "text-amber-400" },
  approved: { label: "Live", cls: "text-signal" },
  rejected: { label: "Rejected", cls: "text-red-400" },
};

const bidBadge: Record<string, string> = {
  active: "text-ink-dim",
  paused: "text-amber-400",
  depleted: "text-ink-faint",
};

export default function AdvertiserPortal() {
  const [ads, setAds] = useState<AdItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/advertiser/ads", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not load your ads.");
        return;
      }
      setAds(data.ads);
    } catch {
      setError("Network error.");
    }
  }, []);

  // Fetch the advertiser's ads once on mount. setState inside the async load is
  // the intended sync-from-external-system pattern; the lint rule fires on the
  // call site, so disable it here (same pattern as the publisher dashboard).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    window.location.href = "/";
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">your ads</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Advertiser portal
          </h1>
        </div>
        <button
          onClick={signOut}
          disabled={signingOut}
          className="shrink-0 rounded-sm border border-wire-bright px-3 py-2 font-mono text-[12px] text-ink-dim transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
        >
          {signingOut ? "…" : "sign out"}
        </button>
      </header>

      {error && (
        <div className="mb-6 rounded-sm border border-red-500/50 bg-panel/40 px-4 py-3 font-mono text-sm text-red-400">
          {error}
        </div>
      )}

      {ads === null ? (
        <p className="font-mono text-sm text-ink-faint">loading…</p>
      ) : ads.length === 0 ? (
        <div className="rounded-lg border border-wire bg-panel/30 p-8 text-center">
          <p className="font-display text-lg text-ink">No ads yet</p>
          <p className="mt-2 text-sm text-ink-dim">
            Place your first bid to get a banner in front of developers.
          </p>
          <Link
            href="/bid"
            className="mt-5 inline-block rounded-sm bg-signal px-5 py-3 font-mono text-sm font-semibold text-canvas transition-opacity hover:opacity-90"
          >
            place a bid →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {ads.map((ad) => {
            const mod = moderationBadge[ad.moderation] ?? {
              label: ad.moderation,
              cls: "text-ink-dim",
            };
            const pct =
              ad.budgetMillicents > 0
                ? Math.min(100, (ad.spendMillicents / ad.budgetMillicents) * 100)
                : 0;
            return (
              <div key={ad.adId} className="rounded-lg border border-wire bg-panel/30 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-[13px] text-ink">
                      {ad.icon && <span className="shrink-0">{ad.icon}</span>}
                      <span className="truncate">{ad.line}</span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-ink-faint">
                      {ad.displayUrl} · {ad.campaignName}
                    </p>
                  </div>
                  <span className={`shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] ${mod.cls}`}>
                    {mod.label}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-wire bg-wire sm:grid-cols-4">
                  <Cell label="views" value={ad.views.toLocaleString()} />
                  <Cell label="spend" value={formatMillicents(ad.spendMillicents)} accent />
                  <Cell
                    label="budget"
                    value={formatMillicents(ad.budgetMillicents)}
                  />
                  <Cell
                    label="max cpm"
                    value={`${formatMillicents(ad.maxCpmMillicents)}/1k`}
                  />
                </div>

                <div className="mt-3">
                  <div className="h-1 overflow-hidden rounded-full bg-wire">
                    <div
                      className="h-full rounded-full bg-signal transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] text-ink-faint">
                    {formatMillicents(ad.spendMillicents)} of {formatMillicents(ad.budgetMillicents)} spent
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ink-faint">
                  <span>
                    bid:{" "}
                    <span className={(bidBadge[ad.bidStatus] ?? "text-ink-dim") + " uppercase tracking-[0.12em]"}>
                      {ad.bidStatus}
                    </span>
                  </span>
                  {ad.dailyCapMillicents != null && (
                    <span>daily cap: {formatMillicents(ad.dailyCapMillicents)}</span>
                  )}
                  <span>created {new Date(ad.adCreatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })}

          <Link
            href="/bid"
            className="mt-2 inline-block self-start rounded-sm border border-wire-bright px-4 py-2.5 font-mono text-sm text-ink-dim transition-colors hover:border-signal hover:text-signal"
          >
            place another bid →
          </Link>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-canvas p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-sm tnum ${accent ? "text-signal" : "text-ink"}`}>{value}</p>
    </div>
  );
}
