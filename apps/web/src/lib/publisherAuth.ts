import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { publishers } from "@/db/schema";
import { bearerToken, constantTimeEqual } from "@/lib/admin";

export type PublisherRow = typeof publishers.$inferSelect;

/**
 * Authorize a request for a specific publisher's private data. The publisher id in
 * the URL is only a routing key — the real credential is the `dashboardToken` bearer
 * (printed by `earnd status`), compared in constant time. Returns the publisher row
 * on success, or null (caller returns 401). This is what stops anyone who merely
 * learns a publisher id — from a log, a Referer, browser history — from reading
 * another publisher's earnings.
 */
export async function authedPublisher(
  req: Request,
  publisherId: string,
): Promise<PublisherRow | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const [pub] = await getDb()
    .select()
    .from(publishers)
    .where(eq(publishers.id, publisherId))
    .limit(1);
  if (!pub) return null;
  if (!constantTimeEqual(token, pub.dashboardToken)) return null;
  return pub;
}
