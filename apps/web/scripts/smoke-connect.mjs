// Smoke-test the Stripe Connect surface (publisher payouts) against test mode.
// Mirrors lib/connect.ts call shapes EXACTLY so we catch any v2 API mismatch.
import { readFileSync } from "node:fs";
import Stripe from "stripe";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2026-05-27.dahlia" });
const base = env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

const step = (n, s) => console.log(`\n[${n}] ${s}`);

try {
  // 1) createConnectAccount — recipient-only v2 account
  step(1, "v2.core.accounts.create (recipient, stripe_transfers requested)");
  const account = await stripe.v2.core.accounts.create({
    contact_email: "publisher-smoke@test.example",
    display_name: "earnd publisher",
    dashboard: "none",
    defaults: {
      currency: "usd",
      responsibilities: { fees_collector: "application", losses_collector: "application" },
    },
    configuration: {
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    include: ["configuration.recipient"],
  });
  console.log("    OK  account:", account.id);
  const cap0 = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
  console.log("    stripe_transfers status (fresh):", cap0);

  // 2) createOnboardingLink — hosted KYC link
  step(2, "v2.core.accountLinks.create (account_onboarding, recipient)");
  const link = await stripe.v2.core.accountLinks.create({
    account: account.id,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        refresh_url: `${base}/publisher/SMOKE?reconnect=1`,
        return_url: `${base}/publisher/SMOKE?onboarding=done`,
      },
    },
  });
  console.log("    OK  onboarding url present:", !!link.url);
  console.log("    url host:", new URL(link.url).host);

  // 3) fetchPayoutsEnabled — capability poll (expected: not active pre-KYC)
  step(3, "v2.core.accounts.retrieve -> stripe_transfers active?");
  const fetched = await stripe.v2.core.accounts.retrieve(account.id, {
    include: ["configuration.recipient"],
  });
  const status = fetched.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
  console.log("    capability status:", status, "=> payoutsEnabled:", status === "active");

  console.log("\nRESULT: Connect API surface OK. accountId=" + account.id);
  console.log("KYC is", status === "active" ? "ACTIVE" : "PENDING (expected; needs hosted onboarding to flip active)");
} catch (e) {
  console.error("\nSMOKE FAILED:", e.message);
  if (e.raw) console.error("raw:", JSON.stringify(e.raw).slice(0, 400));
  process.exit(1);
}
