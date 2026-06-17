import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { MILLICENTS_PER_CENT } from "@earnd/contracts/config";
import { getDb } from "@/db";
import { lockAdvertiser, postTopup } from "@/db/ledger";
import { postRefundReversal, reversedForSourceMillicents } from "@/db/payouts";
import { advertisers, payoutAccounts, processedWebhookEvents } from "@/db/schema";
import { serverEnv } from "@/env";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

// POST /api/webhooks/stripe — the ONLY path that credits an advertiser balance.
// Server-authoritative money entry: a client can never credit itself; only a
// Stripe-signed event does, and only once (idempotent on event.id).
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });

  // Signature is verified against the RAW body — never the parsed JSON.
  const raw = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      raw,
      sig,
      serverEnv().STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Card top-ups are `paid` immediately; async methods fire the dedicated
        // success event later. Only credit on confirmed payment.
        if (session.payment_status === "paid") {
          await creditTopup(event, session);
        }
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId = idOf(charge.payment_intent);
        // Throws on a transient PI-lookup failure → 500 → Stripe retries (we must
        // NOT record the event as processed when attribution merely failed).
        const advertiserId = await advertiserFromPaymentIntent(stripe, piId);
        // `amount_refunded` is cumulative across partial refunds; reverse only the
        // not-yet-reversed delta, keyed on the CHARGE (separate from disputes).
        await clawback(event, {
          advertiserId,
          refType: "stripe_charge",
          refId: charge.id,
          desiredMillicents: (charge.amount_refunded ?? 0) * MILLICENTS_PER_CENT,
          reason: "refund",
        });
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        const piId = idOf(dispute.payment_intent);
        const advertiserId = await advertiserFromPaymentIntent(stripe, piId);
        // Keyed on the DISPUTE id — a charge can be both refunded AND disputed, and
        // the two reversals must not draw down a shared per-charge counter.
        await clawback(event, {
          advertiserId,
          refType: "stripe_dispute",
          refId: dispute.id,
          desiredMillicents: (dispute.amount ?? 0) * MILLICENTS_PER_CENT,
          reason: "clawback",
        });
        break;
      }

      case "account.updated": {
        // v1 Connect accounts report status here; v2 recipient accounts are polled
        // (see lib/connect). Setting the flag is idempotent, so no dedupe needed.
        const account = event.data.object as Stripe.Account;
        await getDb()
          .update(payoutAccounts)
          .set({ payoutsEnabled: account.payouts_enabled ?? false })
          .where(eq(payoutAccounts.stripeAccountId, account.id));
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // Surface a 500 so Stripe retries on transient failures (DB blip, etc.).
    console.error("stripe webhook handler failed", event.id, err);
    return new Response("handler error", { status: 500 });
  }

  return Response.json({ received: true });
}

/**
 * Credit a verified top-up to the advertiser's ledger balance, exactly once.
 * Idempotency + the credit are one atomic transaction: insert the event id (PK)
 * with ON CONFLICT DO NOTHING; if it was already there, a replayed webhook is a
 * no-op. The amount is taken from Stripe (`amount_total`), never the client.
 */
async function creditTopup(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const advertiserId = session.metadata?.advertiserId ?? session.client_reference_id ?? null;
  const amountTotalCents = session.amount_total; // smallest currency unit (USD cents)
  if (!advertiserId || amountTotalCents == null) {
    console.error("topup webhook missing advertiserId/amount_total", event.id);
    return; // unattributable; nothing safe to credit
  }
  const amountMillicents = amountTotalCents * MILLICENTS_PER_CENT;

  await getDb().transaction(async (tx) => {
    const recorded = await tx
      .insert(processedWebhookEvents)
      .values({ eventId: event.id, type: event.type, payload: event as unknown as object })
      .onConflictDoNothing({ target: processedWebhookEvents.eventId })
      .returning({ eventId: processedWebhookEvents.eventId });
    if (recorded.length === 0) return; // already processed — idempotent no-op

    const [advertiser] = await tx
      .select({ id: advertisers.id })
      .from(advertisers)
      .where(eq(advertisers.id, advertiserId))
      .limit(1);
    if (!advertiser) {
      // Our own checkout route always sets a valid id, so this is a hard error.
      // Throwing rolls back the dedupe insert so a fix + retry can still credit.
      throw new Error(`topup for unknown advertiser ${advertiserId}`);
    }

    await lockAdvertiser(tx, advertiserId);
    await postTopup(tx, { advertiserId, amountMillicents, stripeEventId: event.id });
  });
}

/** Narrow a Stripe expandable field (string id | object | null) to its id. */
function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

/**
 * Resolve the advertiser behind a charge via its PaymentIntent metadata. We set
 * `advertiserId` on the PaymentIntent at checkout; charges don't inherit PI metadata,
 * so we retrieve the PI. Returns null ONLY when the PI genuinely carries no
 * advertiserId (a terminal, unattributable state). A retrieve FAILURE propagates as
 * a throw so the caller returns 500 and Stripe retries — a transient lookup error
 * must never be mistaken for "no advertiser" and silently swallow a reversal.
 */
async function advertiserFromPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string | null,
): Promise<string | null> {
  if (!paymentIntentId) return null;
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  return pi.metadata?.advertiserId ?? null;
}

/**
 * Reverse refunded/disputed money from the advertiser's balance. Idempotent two
 * ways: the event id is recorded (a replayed event is a no-op), and the reversal
 * amount is the per-source delta (`desired − alreadyReversed`) keyed on
 * (refType, refId), so cumulative amounts across distinct events reconcile exactly
 * once and refunds vs disputes never cancel each other.
 */
async function clawback(
  event: Stripe.Event,
  args: {
    advertiserId: string | null;
    refType: string;
    refId: string;
    desiredMillicents: number;
    reason: "refund" | "clawback";
  },
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const recorded = await tx
      .insert(processedWebhookEvents)
      .values({ eventId: event.id, type: event.type, payload: event as unknown as object })
      .onConflictDoNothing({ target: processedWebhookEvents.eventId })
      .returning({ eventId: processedWebhookEvents.eventId });
    if (recorded.length === 0) return; // already processed

    if (!args.advertiserId) {
      // The PI genuinely has no advertiserId — nothing to attribute. Recorded so
      // Stripe stops retrying a permanently unattributable event.
      console.error("clawback unattributable", event.id, args.refType, args.refId);
      return;
    }

    await lockAdvertiser(tx, args.advertiserId);
    const already = await reversedForSourceMillicents(tx, args.refType, args.refId);
    const delta = args.desiredMillicents - already;
    if (delta <= 0) return; // nothing new to reverse

    await postRefundReversal(tx, {
      advertiserId: args.advertiserId,
      amountMillicents: delta,
      refType: args.refType,
      refId: args.refId,
      reason: args.reason,
    });
  });
}
