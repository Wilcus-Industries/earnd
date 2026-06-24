import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { advertisers, ads, bids, campaigns, impressions } from "@/db/schema";
import { json } from "@/lib/api";
import { getSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

// GET /api/advertiser/ads — every ad the signed-in advertiser has placed, with
// live spend + impression counts and bid/creative details. Spend is summed from
// impressions.chargeMillicents (held/SIVT impressions store 0, so this is billed
// spend only — same approach as ledger.adSpentMillicents).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();

  const [advertiser] = await db
    .select({ id: advertisers.id })
    .from(advertisers)
    .where(eq(advertisers.userId, user.id))
    .limit(1);

  if (!advertiser) return json({ ads: [] });

  const rows = await db
    .select({
      adId: ads.id,
      line: ads.line,
      displayUrl: ads.displayUrl,
      targetUrl: ads.targetUrl,
      icon: ads.icon,
      moderation: ads.moderation,
      adCreatedAt: ads.createdAt,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      bidId: bids.id,
      maxCpmMillicents: bids.maxCpmMillicents,
      budgetMillicents: bids.budgetMillicents,
      dailyCapMillicents: bids.dailyCapMillicents,
      bidStatus: bids.status,
      bidCreatedAt: bids.createdAt,
    })
    .from(ads)
    .innerJoin(campaigns, eq(ads.campaignId, campaigns.id))
    .innerJoin(bids, eq(bids.adId, ads.id))
    .where(eq(campaigns.advertiserId, advertiser.id))
    .orderBy(sql`${ads.createdAt} DESC`)
    .limit(100);

  const adIds = rows.map((r) => r.adId);
  if (adIds.length === 0) return json({ ads: [] });

  const stats = await db
    .select({
      adId: impressions.adId,
      views: sql<string>`COUNT(*)`,
      spend: sql<string>`COALESCE(SUM(${impressions.chargeMillicents}), 0)`,
    })
    .from(impressions)
    .where(inArray(impressions.adId, adIds))
    .groupBy(impressions.adId);

  const statsByAd = new Map(
    stats.map((s) => [s.adId, { views: Number(s.views), spendMillicents: Number(s.spend) }]),
  );

  return json({
    ads: rows.map((row) => {
      const s = statsByAd.get(row.adId) ?? { views: 0, spendMillicents: 0 };
      return {
        adId: row.adId,
        line: row.line,
        displayUrl: row.displayUrl,
        targetUrl: row.targetUrl,
        icon: row.icon,
        moderation: row.moderation,
        adCreatedAt: row.adCreatedAt,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        bidId: row.bidId,
        maxCpmMillicents: Number(row.maxCpmMillicents),
        budgetMillicents: Number(row.budgetMillicents),
        dailyCapMillicents: row.dailyCapMillicents ? Number(row.dailyCapMillicents) : null,
        bidStatus: row.bidStatus,
        bidCreatedAt: row.bidCreatedAt,
        views: s.views,
        spendMillicents: s.spendMillicents,
      };
    }),
  });
}
