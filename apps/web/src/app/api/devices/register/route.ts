import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { devices, publishers } from "@/db/schema";
import { json, readJson } from "@/lib/api";

export const runtime = "nodejs";

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
