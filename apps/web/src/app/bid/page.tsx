"use client";

import { useEffect, useRef, useState } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "topup_success" }
  | { kind: "topup_cancelled" };

const MAX_ICON_BYTES = 16 * 1024;

export default function BidPage() {
  const [advertiserName, setAdvertiserName] = useState("");
  const [email, setEmail] = useState("");
  const [line, setLine] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [displayUrl, setDisplayUrl] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [maxCpmDollars, setMaxCpmDollars] = useState("2.00");
  const [budgetDollars, setBudgetDollars] = useState("50");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  // Reflect the Stripe Checkout return (?topup=success|cancelled) without pulling
  // in useSearchParams (which would force a Suspense boundary).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("topup");
    const next = p === "success" ? "topup_success" : p === "cancelled" ? "topup_cancelled" : null;
    // One-shot read of a browser-only value after mount (the Stripe return param).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next) setStatus({ kind: next });
  }, []);

  async function onFile(file: File | null) {
    if (!file) {
      setIcon(null);
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      setStatus({ kind: "error", message: "Icon must be 16KB or smaller." });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    setIcon(dataUrl);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "submitting" });

    const cpm = Number(maxCpmDollars);
    const budget = Number(budgetDollars);
    if (!Number.isFinite(cpm) || !Number.isFinite(budget)) {
      setStatus({ kind: "error", message: "Bid and budget must be numbers." });
      return;
    }

    try {
      const bidRes = await fetch("/api/bids", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          advertiserName,
          email,
          line,
          targetUrl,
          displayUrl: displayUrl || undefined,
          icon: icon || undefined,
          maxCpmDollars: cpm,
          budgetDollars: budget,
        }),
      });
      const bid = await bidRes.json();
      if (!bidRes.ok) {
        setStatus({ kind: "error", message: bid.error ?? "Could not create the bid." });
        return;
      }

      // Fund the advertiser → redirect to Stripe Checkout. The ledger is credited
      // only by the verified webhook, never here.
      const coRes = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ advertiserId: bid.advertiserId, amountDollars: bid.fundDollars }),
      });
      const co = await coRes.json();
      if (!coRes.ok || !co.url) {
        setStatus({ kind: "error", message: co.error ?? "Could not start checkout." });
        return;
      }
      window.location.href = co.url;
    } catch {
      setStatus({ kind: "error", message: "Network error. Try again." });
    }
  }

  const submitting = status.kind === "submitting";
  const previewLine = line.trim() || "your one line, here";
  const previewHost = (displayUrl || hostOf(targetUrl) || "your-url.com").replace(/^www\./, "");

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <header className="mb-8 flex flex-col gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">place a bid</p>
        <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          Buy the top row.
        </h1>
        <p className="max-w-xl text-ink-dim">
          One sanitized line, pinned above a developer&apos;s prompt. Set your max CPM and a
          budget, fund it, and your creative enters moderation. A bid-weighted second-price
          auction clears every impression.
        </p>
      </header>

      {status.kind === "topup_success" && (
        <Notice tone="ok">
          Payment received. Your balance is credited once Stripe confirms it — your creative
          serves as soon as a moderator approves it.
        </Notice>
      )}
      {status.kind === "topup_cancelled" && (
        <Notice tone="warn">Checkout was cancelled. Your bid is saved but unfunded.</Notice>
      )}
      {status.kind === "error" && <Notice tone="error">{status.message}</Notice>}

      <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-start">
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <Field label="Your name">
            <input
              required
              value={advertiserName}
              onChange={(e) => setAdvertiserName(e.target.value)}
              className={inputCls}
              placeholder="Acme Inc."
            />
          </Field>
          <Field label="Email" hint="Receipts and moderation updates go here.">
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="ads@acme.com"
            />
          </Field>
          <Field label="Banner line" hint={`${line.length}/140 shown · control characters are stripped`}>
            <input
              required
              maxLength={400}
              value={line}
              onChange={(e) => setLine(e.target.value)}
              className={inputCls}
              placeholder="Acme — ship faster with realtime error tracking"
            />
          </Field>
          <Field label="Destination URL" hint="https only. Shown via a signed redirect, never raw.">
            <input
              required
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              className={inputCls}
              placeholder="https://acme.com/terminal"
            />
          </Field>
          <Field label="Display URL" hint="Optional. Defaults to the destination's host.">
            <input
              value={displayUrl}
              onChange={(e) => setDisplayUrl(e.target.value)}
              className={inputCls}
              placeholder="acme.com"
            />
          </Field>
          <Field label="Icon" hint="Optional PNG/JPG/GIF/WebP, 16KB max.">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="block w-full font-mono text-sm text-ink-dim file:mr-3 file:rounded-sm file:border file:border-wire-bright file:bg-transparent file:px-3 file:py-1.5 file:font-mono file:text-xs file:text-ink-dim hover:file:text-ink"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Max bid" hint="USD per 1,000 impressions. Min $1.">
              <div className="flex items-center gap-2">
                <span className="font-mono text-ink-faint">$</span>
                <input
                  required
                  inputMode="decimal"
                  value={maxCpmDollars}
                  onChange={(e) => setMaxCpmDollars(e.target.value)}
                  className={`${inputCls} tnum`}
                />
                <span className="font-mono text-xs text-ink-faint">/1k</span>
              </div>
            </Field>
            <Field label="Budget" hint="You fund this now. Min $20.">
              <div className="flex items-center gap-2">
                <span className="font-mono text-ink-faint">$</span>
                <input
                  required
                  inputMode="decimal"
                  value={budgetDollars}
                  onChange={(e) => setBudgetDollars(e.target.value)}
                  className={`${inputCls} tnum`}
                />
              </div>
            </Field>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded-sm bg-signal px-5 py-3 font-mono text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "starting checkout…" : "fund & submit for review →"}
          </button>
          <p className="font-mono text-[11px] text-ink-faint">
            Test mode — use card 4242 4242 4242 4242, any future date, any CVC.
          </p>
        </form>

        {/* Signature: a live row-1 banner preview — the product showing itself. */}
        <aside className="lg:sticky lg:top-8">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            live preview · row 1
          </p>
          <div className="overflow-hidden rounded-lg border border-wire bg-[#070A07] shadow-2xl shadow-black/40">
            <div className="flex items-center gap-1.5 border-b border-wire px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-wire-bright" />
              <span className="h-2.5 w-2.5 rounded-full bg-wire-bright" />
              <span className="h-2.5 w-2.5 rounded-full bg-wire-bright" />
              <span className="ml-2 font-mono text-[11px] text-ink-faint">zsh — 80×24</span>
            </div>
            <div className="flex items-center gap-2 border-b border-wire bg-panel px-4 py-1.5 font-mono text-[12px]">
              <span className="onair-dot h-2 w-2 shrink-0 rounded-full bg-signal" />
              {icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={icon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-[2px] object-cover" />
              )}
              <span className="truncate text-ink-dim">
                {previewLine}
                <span className="text-ink-faint"> → {previewHost}</span>
              </span>
            </div>
            <div className="space-y-1.5 p-4 font-mono text-[12px] leading-relaxed text-ink-dim">
              <p>
                <span className="text-signal">~/code</span> $ npm run dev
              </p>
              <p className="text-ink-faint">ready on http://localhost:3000</p>
              <p>
                <span className="text-signal">~/code</span> ${" "}
                <span className="inline-block h-3.5 w-1.5 translate-y-0.5 bg-ink" />
              </p>
            </div>
          </div>
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-ink-faint">
            Pinned above the prompt while the developer works. Hidden offline, in full-screen
            apps, or when toggled off — and it never bills for those.
          </p>
        </aside>
      </div>
    </div>
  );
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}

const inputCls =
  "w-full rounded-sm border border-wire-bright bg-panel/40 px-3 py-2.5 font-mono text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-signal";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">{label}</span>
      {children}
      {hint && <span className="font-mono text-[11px] text-ink-faint">{hint}</span>}
    </label>
  );
}

function Notice({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const border =
    tone === "ok" ? "border-signal/50" : tone === "warn" ? "border-wire-bright" : "border-red-500/50";
  const text = tone === "error" ? "text-red-400" : "text-ink-dim";
  return (
    <div className={`mb-6 rounded-sm border ${border} bg-panel/40 px-4 py-3 font-mono text-sm ${text}`}>
      {children}
    </div>
  );
}
