/**
 * The money ledger. Append-only, double-entry. A balance is ALWAYS a SUM over
 * ledger entries — never a cached column — and money-moving operations run inside
 * a transaction that first row-locks the advertiser, so concurrent impression
 * settlements can never overspend a balance.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { publisherAccrualMillicents } from "@earnd/contracts/config";
import * as schema from "./schema";
import { ledgerAccount, ledgerEntries } from "./schema";

// The transaction type both `db.transaction(tx => ...)` callbacks receive.
export type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

type Account = (typeof ledgerAccount.enumValues)[number];

/** Row-lock the advertiser so concurrent settlements serialize. Call before reading balance. */
export async function lockAdvertiser(tx: Tx, advertiserId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM advertisers WHERE id = ${advertiserId} FOR UPDATE`);
}

/** Balance of an owned account = sum(credits) - sum(debits), in millicents. */
export async function accountBalanceMillicents(
  tx: Tx,
  account: Account,
  ownerId: string | null,
): Promise<number> {
  const rows = await tx
    .select({
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'credit' THEN ${ledgerEntries.amountMillicents} ELSE 0 END), 0)`,
      debit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'debit' THEN ${ledgerEntries.amountMillicents} ELSE 0 END), 0)`,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.account, account),
        ownerId === null ? isNull(ledgerEntries.ownerId) : eq(ledgerEntries.ownerId, ownerId),
      ),
    );
  const r = rows[0] ?? { credit: "0", debit: "0" };
  return Number(r.credit) - Number(r.debit);
}

export const advertiserBalanceMillicents = (tx: Tx, advertiserId: string) =>
  accountBalanceMillicents(tx, "advertiser_balance", advertiserId);

export const publisherEscrowMillicents = (tx: Tx, publisherId: string) =>
  accountBalanceMillicents(tx, "publisher_escrow", publisherId);

/**
 * Credit an advertiser's balance from a verified Stripe top-up. Balanced by an
 * `external` debit (money entering the system). Idempotency is the caller's job
 * (the webhook handler dedupes on Stripe event.id).
 */
export async function postTopup(
  tx: Tx,
  args: { advertiserId: string; amountMillicents: number; stripeEventId: string },
): Promise<void> {
  const groupId = randomUUID();
  await tx.insert(ledgerEntries).values([
    {
      groupId,
      account: "advertiser_balance",
      ownerId: args.advertiserId,
      direction: "credit",
      amountMillicents: args.amountMillicents,
      reason: "topup",
      refType: "stripe_event",
      refId: args.stripeEventId,
    },
    {
      groupId,
      account: "external",
      ownerId: null,
      direction: "debit",
      amountMillicents: args.amountMillicents,
      reason: "topup",
      refType: "stripe_event",
      refId: args.stripeEventId,
    },
  ]);
}

export type SettlementResult =
  | { ok: true }
  | { ok: false; reason: "insufficient_balance" };

/**
 * Settle one impression: debit the advertiser by `chargeMillicents`, credit the
 * publisher's escrow with their 50% accrual, and credit platform_revenue with the
 * remainder. MUST be called after `lockAdvertiser`. Rejects (without posting) if
 * the advertiser can't cover the charge — the authoritative "depleted advertiser
 * stops winning" stop.
 */
export async function settleImpression(
  tx: Tx,
  args: {
    advertiserId: string;
    publisherId: string;
    chargeMillicents: number;
    impressionId: string;
  },
): Promise<SettlementResult> {
  const balance = await advertiserBalanceMillicents(tx, args.advertiserId);
  if (balance < args.chargeMillicents) {
    return { ok: false, reason: "insufficient_balance" };
  }

  const accrual = publisherAccrualMillicents(args.chargeMillicents);
  const platformFee = args.chargeMillicents - accrual; // remainder to platform
  const groupId = randomUUID();

  await tx.insert(ledgerEntries).values([
    {
      groupId,
      account: "advertiser_balance",
      ownerId: args.advertiserId,
      direction: "debit",
      amountMillicents: args.chargeMillicents,
      reason: "impression_charge",
      refType: "impression",
      refId: args.impressionId,
    },
    {
      groupId,
      account: "publisher_escrow",
      ownerId: args.publisherId,
      direction: "credit",
      amountMillicents: accrual,
      reason: "impression_accrual",
      refType: "impression",
      refId: args.impressionId,
    },
    {
      groupId,
      account: "platform_revenue",
      ownerId: null,
      direction: "credit",
      amountMillicents: platformFee,
      reason: "platform_fee",
      refType: "impression",
      refId: args.impressionId,
    },
  ]);

  return { ok: true };
}
