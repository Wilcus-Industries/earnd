"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

type Mode = "signin" | "signup";

const inputCls =
  "w-full rounded-sm border border-wire-bright bg-panel/40 px-3 py-2.5 font-mono text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-signal";

/**
 * Single form for both sign-in and account creation. A mode toggle (not two
 * pages) keeps the advertiser entry point to one screen. `autoSignIn` on the
 * server means a successful sign-up also establishes the session, so after
 * either path we redirect to `?redirect` (default /advertiser).
 */
export function SignIn() {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function redirect() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("redirect") ?? "/advertiser";
    window.location.href = next;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "signin"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name });
      if (res.error) {
        setError(res.error.message ?? "Could not continue. Try again.");
        setBusy(false);
        return;
      }
      redirect();
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-wire bg-panel/30 p-6">
      <div className="mb-5 flex rounded-sm border border-wire p-0.5 font-mono text-[12px]">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`flex-1 rounded-sm px-3 py-1.5 transition-colors ${
              mode === m ? "bg-signal text-canvas" : "text-ink-dim hover:text-ink"
            }`}
          >
            {m === "signin" ? "sign in" : "create account"}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {mode === "signup" && (
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder="Acme Inc."
              autoComplete="name"
            />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
            placeholder="ads@acme.com"
            autoComplete="email"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">Password</span>
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
            placeholder="••••••••"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={8}
          />
          {mode === "signup" && (
            <span className="font-mono text-[11px] text-ink-faint">At least 8 characters.</span>
          )}
        </label>

        {error && (
          <p className="font-mono text-[12px] text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded-sm bg-signal px-5 py-3 font-mono text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? "…"
            : mode === "signin"
              ? "sign in →"
              : "create account →"}
        </button>
      </form>

      <p className="mt-5 font-mono text-[11px] leading-relaxed text-ink-faint">
        By continuing you agree to manage only your own ads.{" "}
        <Link href="/" className="text-ink-dim underline-offset-2 hover:underline">
          Back home
        </Link>
        .
      </p>
    </div>
  );
}
