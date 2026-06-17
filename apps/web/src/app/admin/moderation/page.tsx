"use client";

import { useCallback, useEffect, useState } from "react";

interface PendingAd {
  adId: string;
  line: string;
  displayUrl: string;
  targetUrl: string;
  icon: string | null;
  createdAt: string;
  advertiser: string;
  email: string;
}

export default function ModerationPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<PendingAd[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Keep the token in sessionStorage only: it survives a refresh within the tab
  // but is cleared when the tab closes, so a payout-capable secret never persists
  // to disk where another script or a later user could read it (CWE-522).
  useEffect(() => {
    const saved = window.sessionStorage.getItem("earnd_admin_token");
    // One-shot read of sessionStorage after mount (browser-only).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setToken(saved);
  }, []);

  const load = useCallback(async (tok: string) => {
    setError(null);
    const res = await fetch("/api/moderation", { headers: { authorization: `Bearer ${tok}` } });
    if (res.status === 401) {
      setAuthed(false);
      setError("Token rejected (or no EARND_ADMIN_TOKEN is configured).");
      return;
    }
    if (!res.ok) {
      setError("Could not load the queue.");
      return;
    }
    const data = await res.json();
    setRows(data.pending ?? []);
    setAuthed(true);
    window.sessionStorage.setItem("earnd_admin_token", tok);
  }, []);

  async function decide(adId: string, action: "approve" | "reject") {
    setBusy(adId);
    try {
      const res = await fetch("/api/moderation", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ adId, action }),
      });
      if (res.ok) setRows((r) => r.filter((x) => x.adId !== adId));
      else setError("Action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <header className="mb-8 flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">moderation</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Review queue</h1>
        <p className="text-sm text-ink-dim">
          Creatives wait here until approved. Nothing serves while pending.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">
            admin token
          </span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="EARND_ADMIN_TOKEN"
            className="w-full rounded-sm border border-wire-bright bg-panel/40 px-3 py-2.5 font-mono text-sm text-ink outline-none focus:border-signal"
          />
        </label>
        <button
          onClick={() => load(token)}
          disabled={token.length < 16}
          className="rounded-sm bg-signal px-4 py-2.5 font-mono text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          load queue
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-sm border border-red-500/50 bg-panel/40 px-4 py-3 font-mono text-sm text-red-400">
          {error}
        </div>
      )}

      {authed && rows.length === 0 && (
        <p className="rounded-md border border-wire bg-panel/30 px-4 py-10 text-center font-mono text-sm text-ink-faint">
          queue is empty — nothing waiting for review
        </p>
      )}

      <ul className="flex flex-col gap-4">
        {rows.map((ad) => (
          <li key={ad.adId} className="rounded-md border border-wire bg-panel/30 p-4">
            <div className="mb-3 flex items-center gap-2 rounded-sm bg-[#070A07] px-3 py-1.5 font-mono text-[12px]">
              <span className="onair-dot h-2 w-2 shrink-0 rounded-full bg-signal" />
              {ad.icon && (
                <span className="shrink-0 text-[13px] leading-none">{ad.icon}</span>
              )}
              <span className="truncate text-ink-dim">
                {ad.line}
                <span className="text-ink-faint"> → {ad.displayUrl}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] text-ink-faint">
              <span>
                {ad.advertiser} · {ad.email}
              </span>
              <a
                href={ad.targetUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-ink-dim underline-offset-2 hover:text-signal hover:underline"
              >
                {ad.targetUrl}
              </a>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => decide(ad.adId, "approve")}
                disabled={busy === ad.adId}
                className="rounded-sm bg-signal px-4 py-2 font-mono text-xs font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                approve
              </button>
              <button
                onClick={() => decide(ad.adId, "reject")}
                disabled={busy === ad.adId}
                className="rounded-sm border border-wire-bright px-4 py-2 font-mono text-xs text-ink-dim transition-colors hover:border-red-500/60 hover:text-red-400 disabled:opacity-40"
              >
                reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
