import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { payoutAccounts } from "@/db/schema";
import { badRequest, json, readJson } from "@/lib/api";
import { authedPublisher } from "@/lib/publisherAuth";
import { baseUrl, createConnectAccount, createOnboardingLink, fetchPayoutsEnabled } from "@/lib/connect";

export const runtime = "nodejs";

async function existingAccount(publisherId: string): Promise<string | null> {
  const [row] = await getDb()
    .select()
    .from(payoutAccounts)
    .where(eq(payoutAccounts.publisherId, publisherId))
    .limit(1);
  return row?.stripeAccountId ?? null;
}

const schema = z.object({ publisherId: z.string().uuid() });

// POST /api/connect — start (or resume) Stripe Connect onboarding. Bearer-gated by
// the publisher's dashboard token. This is the ONLY path that creates a connected
// account (account creation is a mutation — never on GET).
export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const { publisherId } = parsed.data;

  const pub = await authedPublisher(req, publisherId);
  if (!pub) return json({ error: "unauthorized" }, { status: 401 });

  let accountId = await existingAccount(publisherId);
  if (!accountId) {
    const created = await createConnectAccount(pub.email);
    // Race-safe: the unique index on publisherId means a concurrent onboarding can't
    // persist a second account. If we lost the race, fall back to the winning row
    // (the account we just created at Stripe is abandoned — rare, and never billed).
    const [row] = await getDb()
      .insert(payoutAccounts)
      .values({ publisherId, stripeAccountId: created })
      .onConflictDoNothing({ target: payoutAccounts.publisherId })
      .returning({ stripeAccountId: payoutAccounts.stripeAccountId });
    accountId = row?.stripeAccountId ?? (await existingAccount(publisherId))!;
  }

  const url = await createOnboardingLink(accountId, baseUrl(), publisherId);
  return json({ url });
}

// GET /api/connect?publisherId=… — read-only status poll (bearer-gated). Never
// creates anything: if there's no connected account yet, it just reports that.
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("publisherId") ?? "";
  const parsed = schema.safeParse({ publisherId: raw });
  if (!parsed.success) return badRequest("invalid publisherId");
  const { publisherId } = parsed.data;

  const pub = await authedPublisher(req, publisherId);
  if (!pub) return json({ error: "unauthorized" }, { status: 401 });

  const accountId = await existingAccount(publisherId);
  if (!accountId) return json({ hasAccount: false, payoutsEnabled: false });

  const enabled = await fetchPayoutsEnabled(accountId);
  await getDb()
    .update(payoutAccounts)
    .set({ payoutsEnabled: enabled })
    .where(eq(payoutAccounts.publisherId, publisherId));

  return json({ hasAccount: true, payoutsEnabled: enabled });
}
