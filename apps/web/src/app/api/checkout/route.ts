import { eq } from "drizzle-orm";
import { z } from "zod";
import { ECONOMICS, MILLICENTS_PER_CENT } from "@earnd/contracts/config";
import { getDb } from "@/db";
import { advertisers } from "@/db/schema";
import { serverEnv } from "@/env";
import { badRequest, json, readJson } from "@/lib/api";
import { getSessionUser } from "@/lib/sessionAuth";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

const minDollars = ECONOMICS.minTopUpMillicents / MILLICENTS_PER_CENT / 100;

const schema = z.object({
  advertiserId: z.string().uuid(),
  // Whole-dollar (or finer) top-up amount; floored to whole cents by Stripe.
  amountDollars: z.number().positive().max(100_000),
});

// POST /api/checkout — create a Stripe Checkout Session to top up an advertiser
// balance. NO money is credited here: the ledger is credited ONLY by the verified
// `checkout.session.completed` webhook (see /api/webhooks/stripe). This route just
// hands the user a hosted payment page.
//
// Requires a signed-in advertiser (better-auth session) who OWNS the target
// advertiser row. Without this gate any caller could create Stripe Customers and
// hosted payment pages for any advertiser UUID, and probe which UUIDs exist.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return json({ error: "sign in required" }, { status: 401 });

  const parsed = await readJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const { advertiserId, amountDollars } = parsed.data;

  const unitAmountCents = Math.round(amountDollars * 100);
  if (unitAmountCents * MILLICENTS_PER_CENT < ECONOMICS.minTopUpMillicents) {
    return badRequest(`Minimum top-up is $${minDollars.toFixed(2)}.`);
  }

  const db = getDb();
  const [advertiser] = await db
    .select()
    .from(advertisers)
    .where(eq(advertisers.id, advertiserId))
    .limit(1);
  if (!advertiser) return json({ error: "unknown advertiser" }, { status: 404 });
  // Ownership check. Return 404 (not 403) so this isn't an existence oracle for
  // advertisers the caller doesn't own.
  if (advertiser.userId !== user.id) {
    return json({ error: "unknown advertiser" }, { status: 404 });
  }

  const stripe = getStripe();

  // Reuse (or lazily create + persist) a Stripe Customer so refunds/disputes in
  // task 7 can be traced back to this advertiser.
  let customerId = advertiser.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: advertiser.email,
      name: advertiser.name,
      metadata: { advertiserId: advertiser.id },
    });
    customerId = customer.id;
    await db
      .update(advertisers)
      .set({ stripeCustomerId: customerId })
      .where(eq(advertisers.id, advertiser.id));
  }

  const base = serverEnv().NEXT_PUBLIC_BASE_URL;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    client_reference_id: advertiser.id,
    // Carried on both the session and the PaymentIntent so the webhook (and later
    // a charge.refunded clawback) can attribute the money to this advertiser.
    metadata: { advertiserId: advertiser.id, kind: "balance_topup" },
    payment_intent_data: {
      metadata: { advertiserId: advertiser.id, kind: "balance_topup" },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: ECONOMICS.currency,
          unit_amount: unitAmountCents,
          product_data: { name: "earnd ad balance top-up" },
        },
      },
    ],
    success_url: `${base}/bid?topup=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/bid?topup=cancelled`,
  });

  return json({ url: session.url, sessionId: session.id });
}
