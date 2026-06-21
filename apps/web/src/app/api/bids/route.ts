import { eq } from "drizzle-orm";
import { z } from "zod";
import { dollarsToMillicents, ECONOMICS } from "@earnd/contracts/config";
import { getDb } from "@/db";
import { advertisers, ads, bids, campaigns } from "@/db/schema";
import { badRequest, json, readJson } from "@/lib/api";
import { sanitizeCreative } from "@/lib/sanitize";

export const runtime = "nodejs";

const minBidDollars = ECONOMICS.minBidCpmMillicents / 100_000;
const minBudgetDollars = ECONOMICS.minTopUpMillicents / 100_000;

// Note: `line`/`targetUrl`/`displayUrl`/`icon` are validated by zod for SHAPE
// only. The authoritative trust boundary is `sanitizeCreative` below — it strips
// control/escape/bidi bytes, enforces the https-only URL policy, and requires the
// icon to be a single emoji glyph. Never persist raw advertiser bytes that bypass it.
const schema = z.object({
  advertiserName: z.string().min(1).max(120),
  email: z.string().email().max(254),
  campaignName: z.string().min(1).max(120).optional(),
  line: z.string().min(1).max(400),
  targetUrl: z.string().min(1).max(2048),
  displayUrl: z.string().max(200).optional(),
  // A single emoji glyph; sanitizeCreative is the authoritative check.
  icon: z.string().max(64).optional(),
  // CPM in whole dollars per 1,000 impressions.
  maxCpmDollars: z.number().positive().max(1_000),
  // Budget you fund now (becomes the top-up amount), whole dollars.
  budgetDollars: z.number().positive().max(100_000),
});

// POST /api/bids — stand up a campaign: advertiser (find-or-create by email) +
// campaign + ad (moderation: "pending") + active bid. Creates NO money — the
// client follows this with POST /api/checkout to fund the returned advertiser.
// The ad cannot serve until a moderator approves it (see /api/moderation).
export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const clean = sanitizeCreative({
    line: body.line,
    displayUrl: body.displayUrl,
    targetUrl: body.targetUrl,
    icon: body.icon,
  });
  if (!clean.ok) return badRequest(clean.error);

  const maxCpmMillicents = dollarsToMillicents(body.maxCpmDollars);
  if (maxCpmMillicents < ECONOMICS.minBidCpmMillicents) {
    return badRequest(`Minimum bid is $${minBidDollars.toFixed(2)} per 1,000 impressions.`);
  }

  const budgetMillicents = dollarsToMillicents(body.budgetDollars);
  if (budgetMillicents < ECONOMICS.minTopUpMillicents) {
    return badRequest(`Minimum budget is $${minBudgetDollars.toFixed(2)}.`);
  }

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    // Find-or-create the advertiser by email (one account per email).
    const [existing] = await tx
      .select()
      .from(advertisers)
      .where(eq(advertisers.email, body.email))
      .limit(1);

    let advertiserId: string;
    if (existing) {
      advertiserId = existing.id;
    } else {
      // Race-safe upsert: a concurrent first-time bid with the same email blocks on
      // the unique index, then this returns 0 rows and we re-read the winner — so two
      // requests can never split a balance across two advertiser rows.
      const [created] = await tx
        .insert(advertisers)
        .values({ email: body.email, name: body.advertiserName })
        .onConflictDoNothing({ target: advertisers.email })
        .returning({ id: advertisers.id });
      if (created) {
        advertiserId = created.id;
      } else {
        const [row] = await tx
          .select({ id: advertisers.id })
          .from(advertisers)
          .where(eq(advertisers.email, body.email))
          .limit(1);
        advertiserId = row!.id;
      }
    }

    const [campaign] = await tx
      .insert(campaigns)
      .values({ advertiserId, name: body.campaignName?.trim() || clean.value.displayUrl })
      .returning({ id: campaigns.id });

    const [ad] = await tx
      .insert(ads)
      .values({
        campaignId: campaign.id,
        line: clean.value.line,
        displayUrl: clean.value.displayUrl,
        targetUrl: clean.value.targetUrl,
        icon: clean.value.icon,
        moderation: "pending",
      })
      .returning({ id: ads.id });

    const [bid] = await tx
      .insert(bids)
      .values({
        campaignId: campaign.id,
        adId: ad.id,
        advertiserId,
        maxCpmMillicents,
        budgetMillicents,
        status: "active",
      })
      .returning({ id: bids.id });

    return { advertiserId, campaignId: campaign.id, adId: ad.id, bidId: bid.id };
  });

  return json({
    ...result,
    // Echo the funding amount the client should now top up to activate the bid.
    fundDollars: body.budgetDollars,
    moderation: "pending",
  });
}
