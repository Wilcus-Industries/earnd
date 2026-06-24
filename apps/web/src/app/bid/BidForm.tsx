"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { EmojiPicker } from "frimousse";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "topup_success" }
  | { kind: "topup_cancelled" };

export function BidForm({
  liveMode,
  user,
}: {
  liveMode: boolean;
  user: { name: string; email: string } | null;
}) {
  const [line, setLine] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [displayUrl, setDisplayUrl] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [maxCpmDollars, setMaxCpmDollars] = useState("2.00");
  const [budgetDollars, setBudgetDollars] = useState("50");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Reflect the Stripe Checkout return (?topup=success|cancelled) without pulling
  // in useSearchParams (which would force a Suspense boundary).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("topup");
    const next = p === "success" ? "topup_success" : p === "cancelled" ? "topup_cancelled" : null;
    // One-shot read of a browser-only value after mount (the Stripe return param).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next) setStatus({ kind: next });
  }, []);

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
        if (bidRes.status === 401) {
          window.location.href = `/sign-in?redirect=${encodeURIComponent("/bid")}`;
          return;
        }
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
        {user ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <p className="font-mono text-[11px] text-ink-dim">
            Signed in as <span className="text-ink">{user.email}</span>. Bids are billed to this account.
          </p>
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
          {/* Not a <label>: a label wrapping the picker's input + button grid
              hijacks clicks/focus, trapping the user inside the popover. */}
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">Icon</span>
            <EmojiField value={icon} onChange={setIcon} />
            <span className="font-mono text-[11px] text-ink-faint">
              Optional. An emoji shown left of your line.
            </span>
          </div>

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
            <Field label="Budget" hint="You fund this now. Min $5.">
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
          {!liveMode && (
            <p className="font-mono text-[11px] text-ink-faint">
              Test mode — use card 4242 4242 4242 4242, any future date, any CVC.
            </p>
          )}
        </form>
        ) : (
          <div className="rounded-lg border border-wire bg-panel/30 p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal">sign in required</p>
            <p className="mt-2 text-ink-dim">
              You need an advertiser account to place a bid. Sign in or create one — it takes a
              minute — then come back to fund your banner.
            </p>
            <Link
              href={`/sign-in?redirect=${encodeURIComponent("/bid")}`}
              className="mt-4 inline-block rounded-sm bg-signal px-5 py-3 font-mono text-sm font-semibold text-canvas transition-opacity hover:opacity-90"
            >
              sign in to place a bid →
            </Link>
          </div>
        )}

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
              {icon && <span className="shrink-0 text-[13px] leading-none">{icon}</span>}
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

// Headless emoji picker (frimousse) styled with the form's own tokens. The chosen
// glyph is stored verbatim and re-validated server-side (one emoji, sanitize.ts).
function EmojiField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (emoji: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Anchor the portaled popover under the trigger, and close on Escape. The
  // popover is portaled to <body> so it escapes this field's DOM (and any
  // clipping/stacking ancestor) — clicks and focus stay free.
  useEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: r.left });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex items-center gap-3">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Choose an emoji"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-sm border border-wire-bright bg-panel/40 text-lg leading-none outline-none transition-colors hover:border-signal focus:border-signal"
      >
        {value ?? <span className="font-mono text-base text-ink-faint">+</span>}
      </button>
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          className="font-mono text-[11px] text-ink-faint underline-offset-2 hover:text-ink"
        >
          clear
        </button>
      )}

      {open &&
        pos &&
        createPortal(
          <>
            {/* click-away */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-sm border border-wire-bright bg-panel shadow-2xl shadow-black/40"
            >
              <EmojiPicker.Root
              className="isolate flex h-80 w-full flex-col bg-panel"
              onEmojiSelect={({ emoji }) => {
                onChange(emoji);
                setOpen(false);
              }}
            >
              <EmojiPicker.Search
                autoFocus
                placeholder="search emoji"
                className="m-2 rounded-sm border border-wire-bright bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink-faint focus:border-signal"
              />
              <EmojiPicker.Viewport className="relative flex-1 outline-none">
                <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center font-mono text-xs text-ink-faint">
                  loading…
                </EmojiPicker.Loading>
                <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center font-mono text-xs text-ink-faint">
                  no emoji found
                </EmojiPicker.Empty>
                <EmojiPicker.List
                  className="select-none pb-1.5"
                  components={{
                    CategoryHeader: ({ category, ...props }) => (
                      <div
                        {...props}
                        className="bg-panel px-2 pt-2 pb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint"
                      >
                        {category.label}
                      </div>
                    ),
                    Row: ({ children, ...props }) => (
                      <div {...props} className="scroll-my-1 px-1">
                        {children}
                      </div>
                    ),
                    Emoji: ({ emoji, ...props }) => (
                      <button
                        {...props}
                        className="flex h-8 w-8 items-center justify-center rounded-sm text-lg leading-none data-[active]:bg-wire-bright"
                      >
                        {emoji.emoji}
                      </button>
                    ),
                  }}
                />
              </EmojiPicker.Viewport>
            </EmojiPicker.Root>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
