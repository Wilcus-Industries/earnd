"use client";

import { useState } from "react";

// A copy-to-clipboard affordance for the install command. Keeps the surrounding
// page a server component.
export function CopyButton({ value, label = "copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context) — no-op; the text is selectable.
    }
  }

  return (
    <button
      onClick={copy}
      className="shrink-0 rounded-sm border border-wire-bright px-3 py-1.5 font-mono text-xs text-ink-dim transition-colors hover:border-signal hover:text-signal"
    >
      {copied ? "copied ✓" : label}
    </button>
  );
}
