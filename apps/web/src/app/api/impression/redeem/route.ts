import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { ImpressionRedeemResponse } from "@earnd/contracts";
import { ECONOMICS, impressionChargeMillicents } from "@earnd/contracts/config";
import { getDb } from "@/db";
import { bidHistory, bids, impressions, publishers } from "@/db/schema";
import {
  adSpentMillicents,
  advertiserBalanceMillicents,
  lockAdvertiser,
  settleImpression,
} from "@/db/ledger";
import type { Tx } from "@/db/ledger";
import { json, readJson } from "@/lib/api";
import { classifyRedemption } from "@/lib/antifraud";
import { verifyImpressionToken } from "@/lib/tokens";

export const runtime = "nodejs";

const schema = z.object({
  impressionToken: z.string().min(1),
  displayedSeconds: z.number().min(0),
});

function deny(reason: string): Response {
  const res: ImpressionRedeemResponse = { recorded: false, reason };
  return json(res);
}

async function countImpressions(tx: Tx, where: ReturnType<typeof and>): Promise<number> {
  const [row] = await tx.select({ n: sql<string>`count(*)` }).from(impressions).where(where);
  return Number(row?.n ?? 0);
}

// POST /api/impression/redeem — the only path that records + bills an impression.
// Server-authoritative throughout: the client cannot self-report a count, only
// redeem a single-use signed token, and only if every gate passes.
export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const { impressionToken, displayedSeconds } = parsed.data;

  // 1. Signature + expiry.
  const p = verifyImpressionToken(impressionToken);
  if (!p) return deny("expired");

  // 2. Dwell gate (viewability analog).
  if (displayedSeconds < p.minDwellSeconds) return deny("dwell_unmet");

  const now = Date.now();
  const since1h = new Date(now - 60 * 60 * 1000);
  const sinceSivt = new Date(now - ECONOMICS.sivtHoldWindowHours * 60 * 60 * 1000);

  // Everything that reads rate counts and then inserts MUST happen inside one
  // transaction, serialized by advisory locks keyed on the publisher and the device
  // — otherwise many distinct valid tokens fired concurrently would each read the
  // same stale count and all pass the ceiling (a trivial inflation bypass). Lock
  // order is fixed (publisher → device → advertiser) to avoid deadlock.
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('pub:' || ${p.publisherId})::bigint)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('dev:' || ${p.deviceId})::bigint)`);
    await lockAdvertiser(tx, p.advertiserId);

    // Counts read under the locks → authoritative.
    const deviceRecent = await countImpressions(
      tx,
      and(
        eq(impressions.deviceId, p.deviceId),
        eq(impressions.surface, p.surface),
        gte(impressions.redeemedAt, since1h),
      ),
    );
    const publisherRecent = await countImpressions(
      tx,
      and(eq(impressions.publisherId, p.publisherId), gte(impressions.redeemedAt, since1h)),
    );
    const publisherRecentSivt = await countImpressions(
      tx,
      and(
        eq(impressions.publisherId, p.publisherId),
        sql`${impressions.validation} <> 'valid'`,
        gte(impressions.redeemedAt, sinceSivt),
      ),
    );

    // 3. Hard physical ceilings (GIVT) — reject outright, at both grains.
    if (
      deviceRecent >= ECONOMICS.maxRedemptionsPerHourPerSurface ||
      publisherRecent >= ECONOMICS.maxRedemptionsPerHourPerPublisher
    ) {
      return { status: "rate_exceeded" as const };
    }

    // 4. Anomaly classification → valid (bill) or SIVT (record, hold, don't bill).
    const verdict = classifyRedemption({
      deviceRecent,
      publisherRecent,
      publisherRecentSivt,
      displayedSeconds,
      minDwellSeconds: p.minDwellSeconds,
    });

    // A held (SIVT) impression bills nothing, so balance + budget only gate billing.
    let bidForAd:
      | { id: string; budgetMillicents: number; dailyCapMillicents: number | null }
      | undefined;
    if (verdict.bill) {
      const balance = await advertiserBalanceMillicents(tx, p.advertiserId);
      if (balance < p.chargeMillicents) {
        return { status: "insufficient_balance" as const };
      }

      // Authoritative per-bid budget + daily-cap stop (the auction filters these
      // best-effort; this is the row-locked truth). Spend is summed under the
      // advertiser lock, so concurrent redeems for this ad can't both slip past.
      const [bidRow] = await tx
        .select({
          id: bids.id,
          budgetMillicents: bids.budgetMillicents,
          dailyCapMillicents: bids.dailyCapMillicents,
        })
        .from(bids)
        .where(eq(bids.adId, p.adId))
        .limit(1);
      if (bidRow) {
        bidForAd = bidRow;
        const spent = await adSpentMillicents(tx, p.adId);
        if (spent + p.chargeMillicents > bidRow.budgetMillicents) {
          return { status: "budget_exhausted" as const };
        }
        if (bidRow.dailyCapMillicents != null) {
          const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
          const today = await adSpentMillicents(tx, p.adId, dayAgo);
          if (today + p.chargeMillicents > bidRow.dailyCapMillicents) {
            return { status: "daily_cap_reached" as const };
          }
        }
      }
    }

    // Single-use: the unique nonce makes a replay insert a no-op. SIVT impressions
    // are recorded too (charge 0) so they count toward the public IVT rate.
    const inserted = await tx
      .insert(impressions)
      .values({
        nonce: p.nonce,
        deviceId: p.deviceId,
        publisherId: p.publisherId,
        adId: p.adId,
        advertiserId: p.advertiserId,
        surface: p.surface,
        clearingCpmMillicents: p.clearingCpmMillicents,
        chargeMillicents: verdict.bill ? p.chargeMillicents : 0,
        dwellSeconds: Math.floor(displayedSeconds),
        validation: verdict.validation,
      })
      .onConflictDoNothing({ target: impressions.nonce })
      .returning({ id: impressions.id });

    if (inserted.length === 0) {
      return { status: "replay" as const };
    }
    const impressionId = inserted[0].id;

    if (!verdict.bill) {
      // Held: no money moves. Bump the audit fraud score (the serving hold itself
      // keys off the decaying windowed SIVT count, not this monotonic value).
      await tx
        .update(publishers)
        .set({ fraudScore: sql`${publishers.fraudScore} + ${ECONOMICS.fraudScoreIncrementOnSivt}` })
        .where(eq(publishers.id, p.publisherId));
      return { status: "held" as const, reason: verdict.reason ?? "flagged" };
    }

    const settled = await settleImpression(tx, {
      advertiserId: p.advertiserId,
      publisherId: p.publisherId,
      chargeMillicents: p.chargeMillicents,
      impressionId,
    });
    if (!settled.ok) {
      // Defensive: balance was already checked under the lock, so this is unreachable;
      // throwing rolls back the impression insert if it ever happens.
      throw new Error("settlement_failed_after_balance_check");
    }

    // Sample the clearing price into the public market series (validated only).
    await tx.insert(bidHistory).values({
      advertiserId: p.advertiserId,
      cpmMillicents: p.clearingCpmMillicents,
      clearingCpmMillicents: p.clearingCpmMillicents,
    });

    // Retire the bid once its remaining budget can't fund even a floor-priced
    // impression, so a depleted campaign stops competing in the auction instead of
    // lingering as a perpetual no-win candidate.
    if (bidForAd) {
      const spentAfter = await adSpentMillicents(tx, p.adId);
      const minCharge = impressionChargeMillicents(ECONOMICS.minBidCpmMillicents);
      if (bidForAd.budgetMillicents - spentAfter < minCharge) {
        await tx.update(bids).set({ status: "depleted" }).where(eq(bids.id, bidForAd.id));
      }
    }

    return { status: "ok" as const };
  });

  if (result.status === "ok") {
    const res: ImpressionRedeemResponse = { recorded: true };
    return json(res);
  }
  if (result.status === "held") {
    // Recorded but not credited — the client can't act on this, it just re-auctions.
    return deny(result.reason);
  }
  return deny(result.status);
}
