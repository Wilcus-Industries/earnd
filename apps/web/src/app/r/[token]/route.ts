import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ads, clicks } from "@/db/schema";
import { serverEnv } from "@/env";
import { verifyClickToken } from "@/lib/tokens";

export const runtime = "nodejs";

// GET /r/<token> — the ONLY click path. The banner never emits a raw advertiser
// URL into the terminal; it links here. We verify the signed token, validate the
// destination is https, record the click (deduped, attribution only — not billed
// in v1), then 302 to the advertiser. Invalid/expired → home, never an open redirect.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const base = serverEnv().NEXT_PUBLIC_BASE_URL;
  const home = () => Response.redirect(base, 302);

  const { token } = await ctx.params;
  const payload = verifyClickToken(token);
  if (!payload) return home();

  const db = getDb();
  const [ad] = await db
    .select({ id: ads.id, targetUrl: ads.targetUrl, moderation: ads.moderation })
    .from(ads)
    .where(eq(ads.id, payload.adId))
    .limit(1);
  if (!ad || ad.moderation !== "approved") return home();

  // Defense in depth: the destination must be a well-formed https URL even though
  // moderation already enforced this. Never redirect to javascript:/data:/http:.
  let dest: URL;
  try {
    dest = new URL(ad.targetUrl);
  } catch {
    return home();
  }
  if (dest.protocol !== "https:") return home();

  // Record the click. The token's per-issue seed is the dedupe key, so repeatedly
  // hitting the same link counts once while every hit still redirects.
  await db
    .insert(clicks)
    .values({
      adId: ad.id,
      impressionId: payload.impressionId ?? null,
      dedupeKey: payload.seed,
    })
    .onConflictDoNothing({ target: clicks.dedupeKey });

  return Response.redirect(dest.toString(), 302);
}
