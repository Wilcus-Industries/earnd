import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { advertisers, ads, campaigns } from "@/db/schema";
import { badRequest, json, readJson } from "@/lib/api";
import { isAdmin } from "@/lib/admin";

export const runtime = "nodejs";

// GET /api/moderation — the pending review queue (most recent first).
export async function GET(req: Request) {
  if (!isAdmin(req)) return json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();
  const rows = await db
    .select({
      adId: ads.id,
      line: ads.line,
      displayUrl: ads.displayUrl,
      targetUrl: ads.targetUrl,
      icon: ads.icon,
      createdAt: ads.createdAt,
      advertiser: advertisers.name,
      email: advertisers.email,
    })
    .from(ads)
    .innerJoin(campaigns, eq(ads.campaignId, campaigns.id))
    .innerJoin(advertisers, eq(campaigns.advertiserId, advertisers.id))
    .where(eq(ads.moderation, "pending"))
    .orderBy(desc(ads.createdAt))
    .limit(200);

  return json({ pending: rows });
}

const decisionSchema = z.object({
  adId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});

// POST /api/moderation — approve or reject one pending creative.
export async function POST(req: Request) {
  if (!isAdmin(req)) return json({ error: "unauthorized" }, { status: 401 });

  const parsed = await readJson(req, decisionSchema);
  if (!parsed.ok) return parsed.res;
  const { adId, action } = parsed.data;

  const db = getDb();
  const [updated] = await db
    .update(ads)
    .set({ moderation: action === "approve" ? "approved" : "rejected" })
    .where(eq(ads.id, adId))
    .returning({ id: ads.id, moderation: ads.moderation });

  if (!updated) return badRequest("unknown ad");
  return json({ adId: updated.id, moderation: updated.moderation });
}
