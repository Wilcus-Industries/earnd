/**
 * Stripe Connect for publisher payouts. Publishers are RECIPIENTS only — they
 * receive funds via separate Transfers, they never act as merchant of record
 * (earnd is). Per the Stripe best-practices skill we use the Accounts v2 API with
 * a `recipient` configuration and controller/responsibility settings, never the
 * legacy Express/Custom/Standard account types.
 *
 * v2 account status changes are delivered through event destinations (thin events),
 * not the classic v1 webhook. For test-mode v1 we POLL the account on demand
 * (`fetchPayoutsEnabled`) instead of wiring an event destination — simpler and
 * sufficient, since we only need fresh status when rendering the dashboard or
 * running a payout.
 */
import { serverEnv } from "@/env";
import { getStripe } from "@/lib/stripe";

/** Create a recipient-only connected account for a publisher. Returns its id. */
export async function createConnectAccount(email: string): Promise<string> {
  const account = await getStripe().v2.core.accounts.create({
    contact_email: email,
    display_name: "earnd publisher",
    // Stripe v2 requires identity.country before defaults.currency can be set.
    // earnd settles in USD, so publishers onboard as US recipients for now.
    identity: { country: "US" },
    // Recipients don't need a Stripe dashboard; earnd is their interface.
    dashboard: "none",
    defaults: {
      currency: "usd",
      responsibilities: {
        // earnd is the platform/merchant of record: it collects fees and owns losses.
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    configuration: {
      recipient: {
        capabilities: {
          // Lets the account RECEIVE /v1/transfers into its Stripe balance — the
          // capability that gates whether we may Transfer publisher earnings to it.
          stripe_balance: { stripe_transfers: { requested: true } },
        },
      },
    },
    include: ["configuration.recipient"],
  });
  return account.id;
}

/** Create a Stripe-hosted onboarding link (single-use) for KYC collection. */
export async function createOnboardingLink(
  accountId: string,
  base: string,
  publisherId: string,
): Promise<string> {
  const link = await getStripe().v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        // Both bounce to the dashboard PAGE (not a mutating API GET). On ?reconnect=1
        // the authenticated page re-POSTs to mint a fresh link.
        refresh_url: `${base}/publisher/${publisherId}?reconnect=1`,
        return_url: `${base}/publisher/${publisherId}?onboarding=done`,
      },
    },
  });
  return link.url;
}

/**
 * Poll the connected account and report whether we may transfer to it (KYC done +
 * the recipient `stripe_transfers` capability is active). This is the
 * authoritative gate before any Transfer.
 */
export async function fetchPayoutsEnabled(accountId: string): Promise<boolean> {
  const account = await getStripe().v2.core.accounts.retrieve(accountId, {
    include: ["configuration.recipient"],
  });
  const status =
    account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
  return status === "active";
}

export function baseUrl(): string {
  return serverEnv().NEXT_PUBLIC_BASE_URL;
}
