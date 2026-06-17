import { and, eq, gte, sql } from "drizzle-orm";
import type { MarketLeaderRow, MarketSeries, MarketSnapshot } from "@earnd/contracts";
import { getDb } from "@/db";
import { ads, advertisers, bidHistory, bids, impressions } from "@/db/schema";

export const runtime = "nodejs";

// Anti-sniping: publish only AGGREGATED, ROUNDED, slightly DELAYED data. Never an
// advertiser's exact live max bid. Round displayed CPM to a coarse band and stamp
// the snapshot a few seconds in the past.
const LEADER_BAND = 25_000; // $0.25 in millicents
const SERIES_BAND = 10_000; // $0.10
const DELAY_MS = 30_000; // publish as-of 30s ago
const SERIES_WINDOW_MS = 60 * 60 * 1000; // last hour
const TOP_N = 8;

const band = (mc: number, step: number) => Math.round(mc / step) * step;

// GET /api/market — the public read model for the market page + the site's own
// live banner. Cheap aggregates; cached briefly at the edge.
export async function GET() {
  const db = getDb();
  const now = Date.now();
  const sinceSeries = new Date(now - SERIES_WINDOW_MS);
  const since10m = new Date(now - 10 * 60 * 1000);

  // Top active+approved bids, highest CPM first; one representative line per bid.
  const activeBids = await db
    .select({
      advertiserId: advertisers.id,
      advertiser: advertisers.name,
      cpm: bids.maxCpmMillicents,
      line: ads.line,
    })
    .from(bids)
    .innerJoin(advertisers, eq(advertisers.id, bids.advertiserId))
    .innerJoin(ads, eq(ads.id, bids.adId))
    .where(and(eq(bids.status, "active"), eq(ads.moderation, "approved")))
    .orderBy(sql`${bids.maxCpmMillicents} DESC`);

  // Lifetime spend per advertiser (sum of billed impression charges).
  const spendRows = await db
    .select({
      advertiserId: impressions.advertiserId,
      spend: sql<string>`COALESCE(SUM(${impressions.chargeMillicents}), 0)`,
    })
    .from(impressions)
    .groupBy(impressions.advertiserId);
  const spendByAdv = new Map(spendRows.map((r) => [r.advertiserId, Number(r.spend)]));

  // Collapse to one row per advertiser (their strongest bid), then rank.
  const seen = new Set<string>();
  const leaderboard: MarketLeaderRow[] = [];
  for (const b of activeBids) {
    if (seen.has(b.advertiserId)) continue;
    seen.add(b.advertiserId);
    leaderboard.push({
      rank: leaderboard.length + 1,
      advertiser: b.advertiser,
      cpmMillicents: band(Number(b.cpm), LEADER_BAND),
      line: b.line,
      spendMillicents: spendByAdv.get(b.advertiserId) ?? 0,
    });
    if (leaderboard.length >= TOP_N) break;
  }
  const topAdvertisers = new Set(leaderboard.map((r) => r.advertiser));

  // Clearing-price history (public series) for the leaderboard advertisers only.
  const history = await db
    .select({
      advertiser: advertisers.name,
      cpm: bidHistory.cpmMillicents,
      clearing: bidHistory.clearingCpmMillicents,
      at: bidHistory.at,
    })
    .from(bidHistory)
    .innerJoin(advertisers, eq(advertisers.id, bidHistory.advertiserId))
    .where(gte(bidHistory.at, sinceSeries))
    .orderBy(bidHistory.at);

  const seriesByAdv = new Map<string, MarketSeries>();
  for (const h of history) {
    if (!topAdvertisers.has(h.advertiser)) continue;
    let s = seriesByAdv.get(h.advertiser);
    if (!s) {
      s = { advertiser: h.advertiser, points: [] };
      seriesByAdv.set(h.advertiser, s);
    }
    const cpm = Number(h.clearing ?? h.cpm);
    s.points.push({ t: h.at.getTime(), cpmMillicents: band(cpm, SERIES_BAND) });
  }

  // Throughput + live-campaign count.
  const [{ n: impr10 } = { n: "0" }] = await db
    .select({ n: sql<string>`count(*)` })
    .from(impressions)
    .where(gte(impressions.redeemedAt, since10m));
  const [{ n: live } = { n: "0" }] = await db
    .select({ n: sql<string>`count(DISTINCT ${bids.campaignId})` })
    .from(bids)
    .where(eq(bids.status, "active"));

  // Residual IVT rate over the trailing 24h: held (non-valid) / total recorded.
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const [ivt = { total: "0", invalid: "0" }] = await db
    .select({
      total: sql<string>`count(*)`,
      invalid: sql<string>`count(*) FILTER (WHERE ${impressions.validation} <> 'valid')`,
    })
    .from(impressions)
    .where(gte(impressions.redeemedAt, since24h));
  const ivtTotal = Number(ivt.total);
  const ivtRate = ivtTotal > 0 ? Number(ivt.invalid) / ivtTotal : 0;

  const snapshot: MarketSnapshot = {
    asOf: now - DELAY_MS,
    impressionsPerMinute: Math.round(Number(impr10) / 10),
    liveCampaigns: Number(live),
    ivtRate,
    leaderboard,
    series: [...seriesByAdv.values()],
  };

  return Response.json(snapshot, {
    headers: { "cache-control": "public, max-age=3, s-maxage=3" },
  });
}
