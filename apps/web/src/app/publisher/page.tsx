import Link from "next/link";
import type { Metadata } from "next";
import { CopyButton } from "@/components/CopyButton";
import { JsonLd } from "@/components/JsonLd";
import { GITHUB_URL, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Run the banner — earn from your terminal",
  description:
    "Install the open-source earnd client and keep 50% of every server-confirmed impression your terminal earns. A tiny Go client, one sanitized line, no artificial cap.",
  path: "/publisher",
});

// The Go client is a downloadable developer tool — describe it as a
// SoftwareApplication so it can surface in software/app rich results.
const appSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "earnd client",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux, Windows",
  description:
    "A security-hardened terminal banner client. Pins one sanitized ad line above your shell prompt and earns you 50% of every server-confirmed impression.",
  downloadUrl: GITHUB_URL,
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

// Point the installed client at the deployed origin. Falls back to local dev so
// `next build` and localhost work without env. install.sh enforces https for any
// non-loopback --api-base, so the prod value must be the real https origin.
const API_BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
const INSTALL = `git clone https://github.com/Wilcus-Industries/earnd && ./earnd/client/install.sh --api-base ${API_BASE}`;

export default function PublisherPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <JsonLd data={appSchema} />
      <header className="mb-8 flex flex-col gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">run the banner</p>
        <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          Your idle top row, earning.
        </h1>
        <p className="max-w-xl text-ink-dim">
          A tiny Go client pins one sanitized line above your shell prompt. You keep
          <span className="text-ink"> 50% </span>
          of every impression a server confirms it displayed. No artificial cap on what a
          machine earns.
        </p>
      </header>

      {/* The install command is the hero — this page is for people at a terminal. */}
      <div className="mb-3 flex items-start gap-3 rounded-md border border-wire bg-[#070A07] px-4 py-3 font-mono text-sm">
        <span className="text-ink-faint">$</span>
        <code className="flex-1 whitespace-pre-wrap break-all text-ink">{INSTALL}</code>
        <CopyButton value={INSTALL} />
      </div>
      <p className="mb-10 font-mono text-[11px] text-ink-faint">
        Clones the repo, builds from source (needs Go), installs a shell shim (bash/zsh/fish),
        registers this device, and prints exactly what it sends. Open source and auditable.
      </p>

      <div className="grid gap-px overflow-hidden rounded-md border border-wire bg-wire sm:grid-cols-2">
        <Cell title="Server counts, not you">
          The client never reports impression counts. It redeems single-use, server-signed
          tokens after a confirmed dwell. You can&apos;t inflate what you earn.
        </Cell>
        <Cell title="50% share, held 30 days">
          Each confirmed impression accrues half its clearing price to your escrow. Earnings
          settle after a 30-day clawback window, paid out via Stripe Connect.
        </Cell>
        <Cell title="Off means off">
          <code className="text-signal">earnd off</code> clears row 1 instantly and resets the
          terminal. The setting persists across shells until you turn it back on.
        </Cell>
        <Cell title="Never when offline">
          No connection, a full-screen app (vim, less, htop), or a non-interactive shell — the
          banner hides and bills nothing. It returns on the next prompt.
        </Cell>
      </div>

      <section className="mt-10 flex flex-col gap-3">
        <h2 className="font-display text-xl font-semibold text-ink">After you install</h2>
        <ul className="flex flex-col gap-2 font-mono text-sm text-ink-dim">
          <Cmd cmd="earnd status" note="show toggle, online state, and this device id" />
          <Cmd cmd="earnd off" note="stop immediately; reset the terminal" />
          <Cmd cmd="earnd on" note="resume" />
          <Cmd cmd="Ctrl-G" note="open the current banner's link" />
        </ul>
      </section>

      <p className="mt-10 font-mono text-[12px] leading-relaxed text-ink-faint">
        Payouts require Stripe Connect onboarding (identity verification) and a $25 minimum
        balance. We send only your device id, OS, surface type, and display-dwell timing —{" "}
        <Link href="/privacy" className="text-ink-dim underline-offset-2 hover:text-signal hover:underline">
          never command contents or keystrokes
        </Link>
        .
      </p>
    </div>
  );
}

function Cell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-canvas p-5">
      <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-dim">{children}</p>
    </div>
  );
}

function Cmd({ cmd, note }: { cmd: string; note: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3">
      <code className="text-signal">{cmd}</code>
      <span className="text-ink-faint">— {note}</span>
    </li>
  );
}
