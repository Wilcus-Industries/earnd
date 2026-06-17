import { and, eq, isNull } from "drizzle-orm";
import { ECONOMICS, MILLICENTS_PER_CENT } from "@earnd/contracts/config";
import { getDb } from "@/db";
import { lockPublisher, maturedEscrowMillicents, postPayout } from "@/db/payouts";
import { payoutAccounts, payouts } from "@/db/schema";
import { json } from "@/lib/api";
import { isAdmin } from "@/lib/admin";
import { fetchPayoutsEnabled } from "@/lib/connect";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
// Long-running fan-out over publishers; allow generous time when run by a cron.
export const maxDuration = 300;

interface Outcome {
  publisherId: string;
  status: "paid" | "skipped" | "error";
  reason?: string;
  amountMillicents?: number;
  transferId?: string;
}

// POST /api/payouts/run — settle matured publisher escrow via Stripe Connect
// Transfers. Admin-gated; intended for a scheduled job. Exactly-once by construction:
//
//  Phase 1 (intent): under the publisher row lock, check maturity + KYC, insert a
//    `pending` payout row, and DEBIT escrow immediately. Because escrow drops inside
//    the lock, a concurrent run can't double-spend it, and the payable amount is read
//    once under the lock (no stale-read transfer).
//  Phase 2 (execute): for every `pending` row (including ones a prior run created but
//    failed to send), create the Stripe Transfer with the PAYOUT ROW ID as the
//    idempotency key. A retry of the same row always dedupes at Stripe — a
//    transfer-succeeds-but-DB-write-fails crash can never produce a second transfer.
//
// A payout is issued only when KYC is complete (transfers capability active), the
// 30-day escrow maturity is met, and the matured amount clears the $25 threshold.
export async function POST(req: Request) {
  if (!isAdmin(req)) return json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();
  const stripe = getStripe();
  const cutoff = new Date(Date.now() - ECONOMICS.escrowHoldDays * 86_400_000);
  const outcomes: Outcome[] = [];

  // ── Phase 1: create payout intents (debit escrow under the publisher lock) ──
  const accounts = await db
    .select()
    .from(payoutAccounts)
    .where(eq(payoutAccounts.payoutsEnabled, true));

  for (const acct of accounts) {
    try {
      // Re-confirm KYC live — the cached flag could be stale (capability revoked).
      const enabled = await fetchPayoutsEnabled(acct.stripeAccountId);
      if (!enabled) {
        await db
          .update(payoutAccounts)
          .set({ payoutsEnabled: false })
          .where(eq(payoutAccounts.publisherId, acct.publisherId));
        outcomes.push({ publisherId: acct.publisherId, status: "skipped", reason: "kyc_inactive" });
        continue;
      }

      await db.transaction(async (tx) => {
        await lockPublisher(tx, acct.publisherId);
        const matured = await maturedEscrowMillicents(tx, acct.publisherId, cutoff);
        if (matured < ECONOMICS.payoutThresholdMillicents) return;

        // Whole-cent Transfer amount; the sub-cent remainder stays in escrow.
        const amountCents = Math.floor(matured / MILLICENTS_PER_CENT);
        const amountMillicents = amountCents * MILLICENTS_PER_CENT;
        if (amountCents <= 0) return;

        const [row] = await tx
          .insert(payouts)
          .values({ publisherId: acct.publisherId, amountMillicents, status: "pending" })
          .returning({ id: payouts.id });

        // Debit escrow now (keyed on the intent id) so it can't be paid twice.
        await postPayout(tx, { publisherId: acct.publisherId, amountMillicents, payoutId: row.id });
      });
    } catch (err) {
      console.error("payout intent failed for publisher", acct.publisherId, err);
      outcomes.push({
        publisherId: acct.publisherId,
        status: "error",
        reason: err instanceof Error ? err.message : "intent_failed",
      });
    }
  }

  // ── Phase 2: execute every pending intent (idempotent on the intent id) ──
  const pending = await db
    .select({
      payoutId: payouts.id,
      publisherId: payouts.publisherId,
      amountMillicents: payouts.amountMillicents,
      stripeAccountId: payoutAccounts.stripeAccountId,
    })
    .from(payouts)
    .innerJoin(payoutAccounts, eq(payoutAccounts.publisherId, payouts.publisherId))
    .where(and(eq(payouts.status, "pending"), isNull(payouts.stripeTransferId)));

  for (const p of pending) {
    try {
      const transfer = await stripe.transfers.create(
        {
          amount: Math.round(p.amountMillicents / MILLICENTS_PER_CENT),
          currency: ECONOMICS.currency,
          destination: p.stripeAccountId,
          metadata: { payoutId: p.payoutId, publisherId: p.publisherId },
        },
        // Stable key = the DB intent id. Any retry of this row dedupes at Stripe.
        { idempotencyKey: `payout:${p.payoutId}` },
      );

      await db
        .update(payouts)
        .set({ stripeTransferId: transfer.id, status: "in_transit" })
        .where(eq(payouts.id, p.payoutId));

      outcomes.push({
        publisherId: p.publisherId,
        status: "paid",
        amountMillicents: p.amountMillicents,
        transferId: transfer.id,
      });
    } catch (err) {
      // Escrow stays debited and the row stays `pending`; the next run retries with
      // the same idempotency key (safe). Surface it for monitoring.
      console.error("payout transfer failed for intent", p.payoutId, err);
      outcomes.push({
        publisherId: p.publisherId,
        status: "error",
        reason: err instanceof Error ? err.message : "transfer_failed",
      });
    }
  }

  return json({ count: outcomes.length, outcomes });
}
