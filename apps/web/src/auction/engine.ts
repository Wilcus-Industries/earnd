/**
 * The auction. Runs per impression `begin`. Among advertisers that are active,
 * moderation-approved, and funded enough to cover the charge, it picks a winner
 * weighted by bid (P(win) ∝ bid) and charges the GSP second price (next-highest
 * bid + increment, capped at the winner's own max, floored at the reserve).
 *
 * Balance here is a best-effort eligibility filter; the AUTHORITATIVE stop against
 * overspend happens at redeem inside a row-locked transaction (see ledger.ts).
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  ECONOMICS,
  impressionChargeMillicents,
} from "@earnd/contracts/config";
import { getDb } from "@/db";
import { ads, bids, impressions, ledgerEntries } from "@/db/schema";

export interface AuctionWinner {
  adId: string;
  advertiserId: string;
  line: string;
  displayUrl: string;
  targetUrl: string;
  icon: string | null;
  clearingCpmMillicents: number;
  chargeMillicents: number;
}

interface Candidate {
  adId: string;
  advertiserId: string;
  maxCpmMillicents: number;
  budgetMillicents: number;
  dailyCapMillicents: number | null;
  line: string;
  displayUrl: string;
  targetUrl: string;
  icon: string | null;
}

/** Map of advertiserId -> balance (millicents) for the given advertisers. */
async function balancesFor(advertiserIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (advertiserIds.length === 0) return out;
  const rows = await getDb()
    .select({
      ownerId: ledgerEntries.ownerId,
      balance: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'credit' THEN ${ledgerEntries.amountMillicents} ELSE -${ledgerEntries.amountMillicents} END), 0)`,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.account, "advertiser_balance"),
        inArray(ledgerEntries.ownerId, advertiserIds),
      ),
    )
    .groupBy(ledgerEntries.ownerId);
  for (const r of rows) {
    if (r.ownerId) out.set(r.ownerId, Number(r.balance));
  }
  return out;
}

/** Map of adId -> billed spend (millicents), optionally scoped to `since` for daily pacing. */
async function spendByAd(adIds: string[], since?: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (adIds.length === 0) return out;
  const rows = await getDb()
    .select({
      adId: impressions.adId,
      spent: sql<string>`COALESCE(SUM(${impressions.chargeMillicents}), 0)`,
    })
    .from(impressions)
    .where(
      and(
        inArray(impressions.adId, adIds),
        since ? gte(impressions.redeemedAt, since) : undefined,
      ),
    )
    .groupBy(impressions.adId);
  for (const r of rows) out.set(r.adId, Number(r.spent));
  return out;
}

/** Pick an element weighted by `weight(item)`. Assumes non-empty, positive weights. */
function weightedPick<T>(items: T[], weight: (t: T) => number): T {
  const total = items.reduce((s, it) => s + weight(it), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export async function runAuction(): Promise<AuctionWinner | null> {
  const db = getDb();
  const candidates: Candidate[] = await db
    .select({
      adId: ads.id,
      advertiserId: bids.advertiserId,
      maxCpmMillicents: bids.maxCpmMillicents,
      budgetMillicents: bids.budgetMillicents,
      dailyCapMillicents: bids.dailyCapMillicents,
      line: ads.line,
      displayUrl: ads.displayUrl,
      targetUrl: ads.targetUrl,
      icon: ads.icon,
    })
    .from(bids)
    .innerJoin(ads, eq(ads.id, bids.adId))
    .where(and(eq(bids.status, "active"), eq(ads.moderation, "approved")));

  if (candidates.length === 0) return null;

  const balances = await balancesFor([...new Set(candidates.map((c) => c.advertiserId))]);
  // Spend already attributed to each ad — total (lifetime budget) and last-24h
  // (daily pacing cap). Best-effort eligibility filter; redeem re-checks under the
  // advertiser lock as the authoritative stop.
  const adIds = candidates.map((c) => c.adId);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [totalSpent, todaySpent] = await Promise.all([
    spendByAd(adIds),
    spendByAd(adIds, dayAgo),
  ]);

  const eligible = candidates.filter((c) => {
    const charge = impressionChargeMillicents(c.maxCpmMillicents);
    if ((balances.get(c.advertiserId) ?? 0) < charge) return false;
    // Don't let an impression push lifetime spend past the budget the advertiser set.
    if ((totalSpent.get(c.adId) ?? 0) + charge > c.budgetMillicents) return false;
    if (
      c.dailyCapMillicents != null &&
      (todaySpent.get(c.adId) ?? 0) + charge > c.dailyCapMillicents
    ) {
      return false;
    }
    return true;
  });
  if (eligible.length === 0) return null;

  const winner = weightedPick(eligible, (c) => c.maxCpmMillicents);

  // GSP second price: highest competing bid (excluding the winner's own bid row).
  const competing = eligible.filter((c) => c !== winner).map((c) => c.maxCpmMillicents);
  const second = competing.length ? Math.max(...competing) : ECONOMICS.minBidCpmMillicents;
  const clearingCpmMillicents = Math.min(
    winner.maxCpmMillicents,
    Math.max(ECONOMICS.minBidCpmMillicents, second + ECONOMICS.gspIncrementMillicents),
  );

  return {
    adId: winner.adId,
    advertiserId: winner.advertiserId,
    line: winner.line,
    displayUrl: winner.displayUrl,
    targetUrl: winner.targetUrl,
    icon: winner.icon,
    clearingCpmMillicents,
    chargeMillicents: impressionChargeMillicents(clearingCpmMillicents),
  };
}
