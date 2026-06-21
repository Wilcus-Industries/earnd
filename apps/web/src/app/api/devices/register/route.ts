import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { devices, publishers } from "@/db/schema";
import { json, readJson } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Registration is unauthenticated and creates a publisher row, so cap it per IP
// to stop a flood from minting unbounded publishers (CWE-307). Longer term this
// should require a signed challenge proving Ed25519 key possession.
const REGISTER_LIMIT = 10;
const REGISTER_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const schema = z.object({
  publicKey: z.string().min(20),
  os: z.string().max(64).optional(),
  email: z.string().email().optional(),
});

// POST /api/devices/register — bind a per-install device key to a publisher.
// Idempotent on publicKey: re-registering the same key returns the same ids. The
// dashboardToken is the bearer secret for the publisher's earnings dashboard; the
// client stores it and prints it via `earnd status`.
export async function POST(req: Request) {
  const limit = await rateLimit(`register:${clientIp(req)}`, REGISTER_LIMIT, REGISTER_WINDOW_MS);
  if (!limit.ok) {
    return json(
      { error: "too many registration attempts; try again later" },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  const parsed = await readJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const { publicKey, os, email } = parsed.data;
  const db = getDb();

  const [existing] = await db
    .select({ deviceId: devices.id, publisherId: devices.publisherId, dashboardToken: publishers.dashboardToken })
    .from(devices)
    .innerJoin(publishers, eq(publishers.id, devices.publisherId))
    .where(eq(devices.publicKey, publicKey))
    .limit(1);
  if (existing) {
    return json(existing);
  }

  const [publisher] = await db
    .insert(publishers)
    .values({ email: email ?? `anon+${publicKey.slice(0, 12)}@earnd.local` })
    .returning({ id: publishers.id, dashboardToken: publishers.dashboardToken });

  const [device] = await db
    .insert(devices)
    .values({ publisherId: publisher.id, publicKey, os })
    .returning({ id: devices.id });

  return json(
    { deviceId: device.id, publisherId: publisher.id, dashboardToken: publisher.dashboardToken },
    { status: 201 },
  );
}
