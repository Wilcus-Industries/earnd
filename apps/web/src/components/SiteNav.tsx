import Link from "next/link";

// Primary navigation. The wordmark sets the type voice (display grotesk, lowercase,
// the daemon-style name) and the single amber CTA is the only loud thing here.
export function SiteNav() {
  return (
    <header className="sticky top-0 z-10 border-b border-wire bg-canvas/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-display text-lg font-bold tracking-tight text-ink">
          earn<span className="text-signal">d</span>
        </Link>
        <div className="flex items-center gap-1 font-mono text-[13px]">
          <Link
            href="/market"
            className="rounded px-3 py-1.5 text-ink-dim transition-colors hover:text-ink"
          >
            market
          </Link>
          <Link
            href="/publisher"
            className="rounded px-3 py-1.5 text-ink-dim transition-colors hover:text-ink"
          >
            earn
          </Link>
          <Link
            href="/bid"
            className="ml-1 rounded-sm bg-signal px-3 py-1.5 font-semibold text-canvas transition-opacity hover:opacity-90"
          >
            place a bid
          </Link>
        </div>
      </nav>
    </header>
  );
}
