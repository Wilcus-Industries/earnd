import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "what we send",
  description:
    "Exactly what the earnd client transmits — device id, OS, surface, and display-dwell timing. Never command contents or keystrokes.",
};

const SENT = [
  ["device id", "A per-install random identifier bound to your publisher account."],
  ["OS + surface", "Operating system and which surface is showing the banner (shell, later tmux/vim)."],
  ["display-dwell timing", "How many seconds the banner was continuously displayed — the viewability signal."],
  ["terminal width", "Column count, so the line can be truncated to fit. Nothing about what's in those columns."],
];

const NEVER = [
  "Command contents or arguments",
  "Keystrokes or terminal output",
  "Working directory, file names, or environment variables",
  "Command history",
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8 flex flex-col gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">what we send</p>
        <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          The disclosure, in full.
        </h1>
        <p className="max-w-xl text-ink-dim">
          Developers are telemetry-sensitive, and rightly so. Here is the complete list of what
          the client transmits — and the firm boundary it never crosses. The client is open
          source, so you can verify every line of this.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-dim">
          what leaves your machine
        </h2>
        <dl className="divide-y divide-wire overflow-hidden rounded-md border border-wire">
          {SENT.map(([term, def]) => (
            <div key={term} className="grid gap-1 bg-panel/30 px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
              <dt className="font-mono text-sm text-signal">{term}</dt>
              <dd className="text-sm text-ink-dim">{def}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-dim">
          what never does
        </h2>
        <ul className="overflow-hidden rounded-md border border-red-500/30">
          {NEVER.map((item) => (
            <li
              key={item}
              className="flex items-center gap-3 border-b border-red-500/15 bg-panel/20 px-4 py-3 font-mono text-sm text-ink last:border-0"
            >
              <span className="text-red-400">✕</span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink-dim">
        <p>
          The background connectivity probe is a single TCP connect to the ad host — it carries
          no payload beyond establishing whether you&apos;re online, and its result is cached so
          the prompt path never blocks on the network.
        </p>
        <p>
          Installation is explicit opt-in and prints this disclosure before it registers. The{" "}
          <code className="font-mono text-ink">off</code> toggle is instant and persists across
          shells. Uninstalling removes the shim and the device key.
        </p>
      </div>
    </div>
  );
}
