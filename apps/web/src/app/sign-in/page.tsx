import { SignIn } from "@/components/SignIn";

// Server component shell. The client <SignIn /> handles both sign-in and
// account creation and redirects to ?redirect (default /advertiser) on success.
export default function SignInPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <header className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">advertiser sign in</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink">
          Sign in to manage your ads
        </h1>
        <p className="mt-2 text-sm text-ink-dim">
          View live spend, impressions, and moderation status for every banner you&apos;ve placed.
        </p>
      </header>
      <SignIn />
    </div>
  );
}
