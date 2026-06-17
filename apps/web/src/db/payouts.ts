/**
 * Payout + clawback ledger operations. Same invariants as ledger.ts: append-only,
 * double-entry, balances are SUMs. Publisher escrow matures after a 30-day hold
 * (the clawback window) before any of it can be transferred out.
 */
import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Tx } from "./ledger";
import { ledgerEntries } from "./schema";

/** Row-lock the publisher so concurrent payout runs can't double-spend escrow. */
export async function lockPublisher(tx: Tx, publisherId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM publishers WHERE id = ${publisherId} FOR UPDATE`);
}

async function sumEscrow(
  tx: Tx,
  publisherId: string,
  direction: "credit" | "debit",
  maturedBefore?: Date,
): Promise<number> {
  const rows = await tx
    .select({
      total: sql<string>`COALESCE(SUM(${ledgerEntries.amountMillicents}), 0)`,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.account, "publisher_escrow"),
        eq(ledgerEntries.ownerId, publisherId),
        eq(ledgerEntries.direction, direction),
        maturedBefore ? lt(ledgerEntries.createdAt, maturedBefore) : undefined,
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Escrow that has cleared the hold and is eligible to pay out:
 *   (accrual credits older than `maturedBefore`) − (all payout debits to date).
 * Payouts always draw from matured funds, so subtracting all debits can't make this
 * over-count. Returns >= 0.
 */
export async function maturedEscrowMillicents(
  tx: Tx,
  publisherId: string,
  maturedBefore: Date,
): Promise<number> {
  const credits = await sumEscrow(tx, publisherId, "credit", maturedBefore);
  const debits = await sumEscrow(tx, publisherId, "debit");
  return Math.max(0, credits - debits);
}

/** Total current escrow balance (credits − debits, all time), for display. */
export async function escrowBalanceMillicents(tx: Tx, publisherId: string): Promise<number> {
  const credits = await sumEscrow(tx, publisherId, "credit");
  const debits = await sumEscrow(tx, publisherId, "debit");
  return credits - debits;
}

/**
 * How much has already been reversed against a given source (millicents). The source
 * is the (refType, refId) pair — e.g. ("stripe_charge", chargeId) for refunds, or
 * ("stripe_dispute", disputeId) for disputes. Keeping refunds and disputes in
 * SEPARATE namespaces is essential: a charge can be both partially refunded AND
 * disputed, and the two reversals must not draw down a shared counter.
 */
export async function reversedForSourceMillicents(
  tx: Tx,
  refType: string,
  refId: string,
): Promise<number> {
  const rows = await tx
    .select({ total: sql<string>`COALESCE(SUM(${ledgerEntries.amountMillicents}), 0)` })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.account, "advertiser_balance"),
        eq(ledgerEntries.direction, "debit"),
        eq(ledgerEntries.refType, refType),
        eq(ledgerEntries.refId, refId),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Reverse money that left the system via a Stripe refund or dispute: debit the
 * advertiser's balance, credit `external`. Keyed on the SOURCE (`refType`/`refId`),
 * so a cumulative amount across several events reconciles to the right delta (the
 * caller posts only `desired − alreadyReversed`). The advertiser balance may go
 * negative if they already spent it — that's a recorded platform loss, not something
 * we silently absorb.
 */
export async function postRefundReversal(
  tx: Tx,
  args: {
    advertiserId: string;
    amountMillicents: number;
    refType: string;
    refId: string;
    reason: "refund" | "clawback";
  },
): Promise<void> {
  const groupId = randomUUID();
  await tx.insert(ledgerEntries).values([
    {
      groupId,
      account: "advertiser_balance",
      ownerId: args.advertiserId,
      direction: "debit",
      amountMillicents: args.amountMillicents,
      reason: args.reason,
      refType: args.refType,
      refId: args.refId,
    },
    {
      groupId,
      account: "external",
      ownerId: null,
      direction: "credit",
      amountMillicents: args.amountMillicents,
      reason: args.reason,
      refType: args.refType,
      refId: args.refId,
    },
  ]);
}

/**
 * Record a publisher payout in the ledger: debit `publisher_escrow`, credit
 * `external` (money leaving to the connected account). Keyed on the PAYOUT INTENT
 * id (not the Stripe transfer id), because the debit is posted BEFORE the Stripe
 * call so that escrow drops atomically under the publisher lock — no concurrent run
 * can double-spend it, and the matured amount can't be transferred from a stale
 * read. MUST be called after `lockPublisher`.
 */
export async function postPayout(
  tx: Tx,
  args: { publisherId: string; amountMillicents: number; payoutId: string },
): Promise<void> {
  const groupId = randomUUID();
  await tx.insert(ledgerEntries).values([
    {
      groupId,
      account: "publisher_escrow",
      ownerId: args.publisherId,
      direction: "debit",
      amountMillicents: args.amountMillicents,
      reason: "payout",
      refType: "payout",
      refId: args.payoutId,
    },
    {
      groupId,
      account: "external",
      ownerId: null,
      direction: "credit",
      amountMillicents: args.amountMillicents,
      reason: "payout",
      refType: "payout",
      refId: args.payoutId,
    },
  ]);
}
