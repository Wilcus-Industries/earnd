import { eq } from "drizzle-orm";
import { z } from "zod";
import { dollarsToMillicents, ECONOMICS } from "@earnd/contracts/config";
import { getDb } from "@/db";
import { advertisers, ads, bids, campaigns } from "@/db/schema";
import { badRequest, json, readJson } from "@/lib/api";
import { sanitizeCreative } from "@/lib/sanitize";
import { getSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

const minBidDollars = ECONOMICS.minBidCpmMillicents / 100_000;
const minBudgetDollars = ECONOMICS.minTopUpMillicents / 100_000;

// Note: `line`/`targetUrl`/`displayUrl`/`icon` are validated by zod for SHAPE
// only. The authoritative trust boundary is `sanitizeCreative` below — it strips
// control/escape/bidi bytes, enforces the https-only URL policy, and requires the
// icon to be a single emoji glyph. Never persist raw advertiser bytes that bypass it.
// Advertiser identity (email + name) comes from the signed-in session, not the
// request body — so a bid is always attributed to the authenticated user.
const schema = z.object({
  advertiserName: z.string().min(1).max(120).optional(),
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

// POST /api/bids — stand up a campaign: advertiser (find-or-create by session
// user) + campaign + ad (moderation: "pending") + active bid. Creates NO money —
// the client follows this with POST /api/checkout to fund the returned advertiser.
// The ad cannot serve until a moderator approves it (see /api/moderation).
// Requires a signed-in advertiser (better-auth session).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return json({ error: "sign in required" }, { status: 401 });
  }

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
  const advertiserName = body.advertiserName?.trim() || user.name;
  const result = await db.transaction(async (tx) => {
    // Find-or-create the advertiser for this session user. Identity is anchored to
    // user.id (not email) so the portal always resolves to one account per user.
    // The email unique index still catches the race where a pre-auth advertiser
    // row with this email already exists — on conflict we re-read by userId.
    const [existing] = await tx
      .select()
      .from(advertisers)
      .where(eq(advertisers.userId, user.id))
      .limit(1);

    let advertiserId: string;
    if (existing) {
      advertiserId = existing.id;
    } else {
      const [created] = await tx
        .insert(advertisers)
        .values({ email: user.email, name: advertiserName, userId: user.id })
        .onConflictDoNothing({ target: advertisers.email })
        .returning({ id: advertisers.id });
      if (created) {
        advertiserId = created.id;
      } else {
        // A pre-auth advertiser row with this email won the insert race. Claim it
        // by stamping our userId, then re-read. Single-winner: the email unique
        // index guarantees only one row.
        await tx
          .update(advertisers)
          .set({ userId: user.id, name: advertiserName })
          .where(eq(advertisers.email, user.email));
        const [row] = await tx
          .select({ id: advertisers.id })
          .from(advertisers)
          .where(eq(advertisers.userId, user.id))
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
