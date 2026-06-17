"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatMillicents } from "@earnd/contracts/config";

interface PayoutRow {
  amountMillicents: number;
  status: string;
  stripeTransferId: string | null;
  createdAt: string;
}

interface Summary {
  publisherId: string;
  escrowMillicents: number;
  maturedMillicents: number;
  payoutThresholdMillicents: number;
  escrowHoldDays: number;
  hasAccount: boolean;
  payoutsEnabled: boolean;
  payouts: PayoutRow[];
}

export default function PublisherDashboard() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tokenKey = `earnd_dash_token:${id}`;

  const load = useCallback(
    async (tok: string) => {
      setError(null);
      const res = await fetch(`/api/publisher/${id}`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${tok}` },
      });
      if (res.status === 401) {
        setAuthed(false);
        setError("Token rejected. Copy it from `earnd status` on the machine running the banner.");
        return;
      }
      if (!res.ok) {
        setError("Could not load earnings.");
        return;
      }
      setData(await res.json());
      setAuthed(true);
      window.localStorage.setItem(tokenKey, tok);
    },
    [id, tokenKey],
  );

  // Restore a saved token and run any post-onboarding refresh, once on mount.
  useEffect(() => {
    const saved = window.localStorage.getItem(tokenKey);
    if (!saved) return;
    const params = new URLSearchParams(window.location.search);
    const init = async () => {
      if (params.get("onboarding") === "done") {
        await fetch(`/api/connect?publisherId=${id}`, {
          cache: "no-store",
          headers: { authorization: `Bearer ${saved}` },
        }).catch(() => {});
      }
      await load(saved);
      if (params.get("reconnect") === "1") void startOnboarding(saved);
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(saved);
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function startOnboarding(tok = token) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
        body: JSON.stringify({ publisherId: id }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setError(body.error ?? "Could not start onboarding.");
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!authed) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="font-display text-2xl font-bold text-ink">Publisher dashboard</h1>
        <p className="mt-2 text-sm text-ink-dim">
          Enter your dashboard token. Run{" "}
          <code className="font-mono text-signal">earnd status</code> on the machine running the
          banner — it prints the token next to this dashboard URL.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="dashboard token"
            className="w-full rounded-sm border border-wire-bright bg-panel/40 px-3 py-2.5 font-mono text-sm text-ink outline-none focus:border-signal"
          />
          <button
            onClick={() => load(token)}
            disabled={token.length < 8}
            className="rounded-sm bg-signal px-4 py-2.5 font-mono text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            open dashboard
          </button>
          {error && <p className="font-mono text-[12px] text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8 flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">your earnings</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          Publisher dashboard
        </h1>
      </header>

      {error && (
        <div className="mb-6 rounded-sm border border-red-500/50 bg-panel/40 px-4 py-3 font-mono text-sm text-red-400">
          {error}
        </div>
      )}

      {!data ? (
        <p className="font-mono text-sm text-ink-faint">loading…</p>
      ) : (
        <>
          <div className="grid gap-px overflow-hidden rounded-md border border-wire bg-wire sm:grid-cols-3">
            <Stat label="In escrow" value={formatMillicents(data.escrowMillicents)} sub="accrued, not yet matured" />
            <Stat
              label="Payable now"
              value={formatMillicents(data.maturedMillicents)}
              sub={`cleared the ${data.escrowHoldDays}-day hold`}
              accent
            />
            <Stat
              label="Threshold"
              value={formatMillicents(data.payoutThresholdMillicents)}
              sub="minimum to pay out"
            />
          </div>

          <div className="mt-8 rounded-md border border-wire bg-panel/30 p-5">
            <h2 className="font-display text-lg font-semibold text-ink">Payouts</h2>
            {!data.hasAccount ? (
              <>
                <p className="mt-2 text-sm text-ink-dim">
                  Connect a Stripe account to get paid. Identity verification (KYC) is required
                  before any transfer.
                </p>
                <button
                  onClick={() => startOnboarding()}
                  disabled={busy}
                  className="mt-4 rounded-sm bg-signal px-4 py-2.5 font-mono text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "opening…" : "connect a payout account →"}
                </button>
              </>
            ) : data.payoutsEnabled ? (
              <p className="mt-2 flex items-center gap-2 font-mono text-sm text-ink-dim">
                <span className="h-2 w-2 rounded-full bg-signal" />
                Verified — payouts enabled. Matured earnings settle on the next payout run.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-ink-dim">
                  Onboarding started but verification isn&apos;t complete. Finish it to enable
                  transfers.
                </p>
                <button
                  onClick={() => startOnboarding()}
                  disabled={busy}
                  className="mt-4 rounded-sm border border-wire-bright px-4 py-2.5 font-mono text-sm text-ink-dim transition-colors hover:border-signal hover:text-signal disabled:opacity-50"
                >
                  {busy ? "opening…" : "finish verification →"}
                </button>
              </>
            )}
          </div>

          {data.payouts.length > 0 && (
            <div className="mt-8 overflow-x-auto rounded-md border border-wire">
              <table className="w-full min-w-[480px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-wire font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                    <th className="px-4 py-3 font-medium">date</th>
                    <th className="px-4 py-3 text-right font-medium">amount</th>
                    <th className="px-4 py-3 font-medium">status</th>
                    <th className="px-4 py-3 font-medium">transfer</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-sm">
                  {data.payouts.map((p) => (
                    <tr key={p.stripeTransferId ?? p.createdAt} className="border-b border-wire/60 last:border-0">
                      <td className="px-4 py-3 text-ink-dim">{new Date(p.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right tnum text-ink">{formatMillicents(p.amountMillicents)}</td>
                      <td className="px-4 py-3 text-ink-dim">{p.status}</td>
                      <td className="max-w-[160px] truncate px-4 py-3 text-ink-faint">{p.stripeTransferId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-canvas p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">{label}</p>
      <p className={`mt-2 font-display text-2xl font-bold tnum ${accent ? "text-signal" : "text-ink"}`}>
        {value}
      </p>
      <p className="mt-1 font-mono text-[11px] text-ink-faint">{sub}</p>
    </div>
  );
}
