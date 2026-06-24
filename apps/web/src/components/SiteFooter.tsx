import Link from "next/link";
import { stripeLiveMode } from "@/lib/stripe";

export function SiteFooter() {
  const liveMode = stripeLiveMode();
  return (
    <footer className="border-t border-wire">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[13px] text-ink-faint sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono">
          earn<span className="text-signal">d</span> · a terminal ad network
          {!liveMode && " · test mode"}
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono">
          <Link href="/market" className="hover:text-ink-dim">market</Link>
          <Link href="/bid" className="hover:text-ink-dim">advertise</Link>
          <Link href="/publisher" className="hover:text-ink-dim">earn</Link>
          <Link href="/privacy" className="hover:text-ink-dim">what we send</Link>
        </div>
      </div>
    </footer>
  );
}
