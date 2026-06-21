/**
 * The money ledger. Append-only, double-entry. A balance is ALWAYS a SUM over
 * ledger entries — never a cached column — and money-moving operations run inside
 * a transaction that first row-locks the advertiser, so concurrent impression
 * settlements can never overspend a balance.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, isNull, sql, type ExtractTablesWithRelations } from "drizzle-orm";
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
 * Total billed spend attributed to an ad (= a bid's creative), in millicents.
 * Held/SIVT impressions are stored with chargeMillicents=0, so summing the column
 * yields billed spend only. Pass `since` to scope it to a window (daily-cap pacing).
 * Authoritative when read under the advertiser row lock: the ad belongs to a single
 * advertiser, so concurrent redeems for it serialize on that lock and can't each
 * read the same stale spend and both slip past the budget.
 */
export async function adSpentMillicents(tx: Tx, adId: string, since?: Date): Promise<number> {
  const rows = await tx
    .select({ total: sql<string>`COALESCE(SUM(${schema.impressions.chargeMillicents}), 0)` })
    .from(schema.impressions)
    .where(
      and(
        eq(schema.impressions.adId, adId),
        since ? gte(schema.impressions.redeemedAt, since) : undefined,
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

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

  // Split the indivisible leftover millicent ~50/50 across impressions, keyed
  // deterministically on the impression id, instead of always flooring it to the
  // platform (the uuid's last hex nibble is uniform, so this is ~unbiased).
  const roundUp = (parseInt(args.impressionId.replace(/-/g, "").slice(-1), 16) & 1) === 1;
  const accrual = publisherAccrualMillicents(args.chargeMillicents, roundUp);
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
