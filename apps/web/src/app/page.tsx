import Link from "next/link";
import { LiveStrip } from "@/components/LiveStrip";

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      {/* Hero — the thesis, stated plainly and large. */}
      <section className="grid gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-24">
        <div>
          <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-dim">
            terminal ad network
            <span className="mx-2 text-wire-bright">/</span>
            <span className="text-signal">on air</span>
          </p>
          <h1 className="font-display text-5xl font-bold leading-[0.98] tracking-tight text-ink sm:text-6xl lg:text-7xl">
            The terminal&apos;s
            <br />
            top row is
            <br />
            <span className="text-signal">inventory.</span>
          </h1>
          <p className="mt-7 max-w-md text-lg leading-relaxed text-ink-dim">
            One sanitized line, pinned above your prompt while you work. Advertisers
            bid for it by the thousand. The developer who runs the banner keeps
            <span className="text-ink"> 50% </span>
            of every impression it earns.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3 font-mono text-sm">
            <Link
              href="/bid"
              className="rounded-sm bg-signal px-5 py-2.5 font-semibold text-canvas transition-opacity hover:opacity-90"
            >
              place a bid →
            </Link>
            <Link
              href="/publisher"
              className="rounded-sm border border-wire-bright px-5 py-2.5 text-ink-dim transition-colors hover:border-ink-faint hover:text-ink"
            >
              install &amp; earn
            </Link>
          </div>
        </div>

        {/* A faithful mock of the running terminal: row 1 is the pinned banner. */}
        <TerminalMock />
      </section>

      <LiveStrip />

      {/* How it works — three honest steps, not decorative numbering. */}
      <section className="grid gap-px overflow-hidden rounded-md border border-wire bg-wire py-0 sm:grid-cols-3">
        <Step
          k="bid"
          title="Advertisers bid"
          body="Set a max CPM and a budget, fund it with a card. Creatives are moderated before they can serve. A bid-weighted second-price auction clears every impression."
        />
        <Step
          k="serve"
          title="earnd serves one line"
          body="A tiny client pins the winning creative to row 1 at each prompt — hidden when you're offline, in full-screen apps, or toggled off. Output scrolls underneath."
        />
        <Step
          k="earn"
          title="Developers earn"
          body="Every server-confirmed impression accrues 50% to the developer running it. Paid out via Stripe Connect after a hold. No artificial cap on what a machine earns."
        />
      </section>

      <section className="flex flex-col items-start gap-4 py-16">
        <h2 className="font-display text-2xl font-semibold text-ink">
          The market is public.
        </h2>
        <p className="max-w-xl text-ink-dim">
          Top bidders over time and a live clearing-price leaderboard — aggregated
          and slightly delayed, so the auction stays honest.
        </p>
        <Link
          href="/market"
          className="font-mono text-sm text-signal underline-offset-4 hover:underline"
        >
          open the market →
        </Link>
      </section>
    </div>
  );
}

function Step({ k, title, body }: { k: string; title: string; body: string }) {
  return (
    <div className="bg-canvas p-6">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">{k}</span>
      <h3 className="mt-3 font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-dim">{body}</p>
    </div>
  );
}

function TerminalMock() {
  return (
    <div className="overflow-hidden rounded-lg border border-wire bg-[#070A07] shadow-2xl shadow-black/40">
      <div className="flex items-center gap-1.5 border-b border-wire px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-wire-bright" />
        <span className="h-2.5 w-2.5 rounded-full bg-wire-bright" />
        <span className="h-2.5 w-2.5 rounded-full bg-wire-bright" />
        <span className="ml-2 font-mono text-[11px] text-ink-faint">zsh — 80×24</span>
      </div>
      {/* Row 1: the pinned banner (amber on-air). */}
      <div className="flex items-center gap-2 border-b border-wire bg-panel px-4 py-1.5 font-mono text-[12px]">
        <span className="onair-dot h-2 w-2 shrink-0 rounded-full bg-signal" />
        <span className="truncate text-ink-dim">
          Sentry · ship with confidence — error monitoring → sentry.io
        </span>
      </div>
      {/* The shell, scrolling beneath it. */}
      <div className="space-y-1.5 p-4 font-mono text-[12px] leading-relaxed text-ink-dim">
        <p><span className="text-signal">~/code/earnd</span> $ go build ./...</p>
        <p className="text-ink-faint">building client…</p>
        <p><span className="text-signal">~/code/earnd</span> $ git push</p>
        <p className="text-ink-faint">Enumerating objects: 42, done.</p>
        <p>
          <span className="text-signal">~/code/earnd</span> ${" "}
          <span className="inline-block h-3.5 w-1.5 translate-y-0.5 bg-ink" />
        </p>
      </div>
    </div>
  );
}
