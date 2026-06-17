import { desc, eq } from "drizzle-orm";
import { ECONOMICS } from "@earnd/contracts/config";
import { getDb } from "@/db";
import { escrowBalanceMillicents, maturedEscrowMillicents } from "@/db/payouts";
import { payoutAccounts, payouts } from "@/db/schema";
import { json } from "@/lib/api";
import { authedPublisher } from "@/lib/publisherAuth";

export const runtime = "nodejs";

// GET /api/publisher/:id — the publisher's own earnings summary for the dashboard.
// The id in the path is only a routing key; the actual credential is the
// `dashboardToken` bearer (constant-time checked). Without it this returns 401, so
// learning a publisher id (from a log, Referer, or history) does not leak earnings.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const publisher = await authedPublisher(req, id);
  if (!publisher) return json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();
  const cutoff = new Date(Date.now() - ECONOMICS.escrowHoldDays * 86_400_000);

  const { escrow, matured } = await db.transaction(async (tx) => ({
    escrow: await escrowBalanceMillicents(tx, id),
    matured: await maturedEscrowMillicents(tx, id, cutoff),
  }));

  const [account] = await db
    .select()
    .from(payoutAccounts)
    .where(eq(payoutAccounts.publisherId, id))
    .limit(1);

  const history = await db
    .select({
      amountMillicents: payouts.amountMillicents,
      status: payouts.status,
      stripeTransferId: payouts.stripeTransferId,
      createdAt: payouts.createdAt,
    })
    .from(payouts)
    .where(eq(payouts.publisherId, id))
    .orderBy(desc(payouts.createdAt))
    .limit(20);

  return json({
    publisherId: id,
    escrowMillicents: escrow,
    maturedMillicents: matured,
    payoutThresholdMillicents: ECONOMICS.payoutThresholdMillicents,
    escrowHoldDays: ECONOMICS.escrowHoldDays,
    hasAccount: Boolean(account),
    payoutsEnabled: account?.payoutsEnabled ?? false,
    payouts: history,
  });
}
