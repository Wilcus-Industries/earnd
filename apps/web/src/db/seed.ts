/**
 * Dev seed: enough funded, approved inventory for the auction to clear and the
 * market page to have a chart. Run with `pnpm db:seed` after `pnpm db:push`.
 *
 * Self-contained on purpose — its own DB connection and inline ledger writes — so
 * it runs under plain `tsx` without the Next path-alias / app runtime in the way.
 * Idempotent-ish: it appends fresh advertisers each run; truncate if you want a
 * clean slate (`TRUNCATE advertisers CASCADE;` also clears campaigns/ads/bids).
 */
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

loadEnv({ path: ".env.local" });
loadEnv(); // also pick up plain .env if present

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("seed: DATABASE_URL is not set (put it in apps/web/.env.local)");
  process.exit(1);
}

const dollars = (usd: number) => Math.round(usd * 100_000); // → millicents

const ADVERTISERS = [
  {
    name: "Sentry",
    email: "ads@sentry.example",
    line: "Sentry · ship with confidence — error monitoring for devs → sentry.example",
    displayUrl: "sentry.example",
    targetUrl: "https://sentry.example/?utm_source=earnd",
    cpm: dollars(5.0),
    budget: dollars(50),
  },
  {
    name: "Neon",
    email: "ads@neon.example",
    line: "Neon · serverless Postgres with branching — try it free → neon.example",
    displayUrl: "neon.example",
    targetUrl: "https://neon.example/?ref=earnd",
    cpm: dollars(3.5),
    budget: dollars(50),
  },
  {
    name: "Linear",
    email: "ads@linear.example",
    line: "Linear · the issue tracker devs actually like → linear.example",
    displayUrl: "linear.example",
    targetUrl: "https://linear.example/?from=earnd",
    cpm: dollars(2.25),
    budget: dollars(50),
  },
];

async function main() {
  const sql = postgres(url!, { max: 1, prepare: false });
  const db = drizzle(sql, { schema });

  try {
    for (const a of ADVERTISERS) {
      const [advertiser] = await db
        .insert(schema.advertisers)
        .values({ name: a.name, email: a.email })
        .returning({ id: schema.advertisers.id });

      const [campaign] = await db
        .insert(schema.campaigns)
        .values({ advertiserId: advertiser.id, name: `${a.name} — terminal` })
        .returning({ id: schema.campaigns.id });

      const [ad] = await db
        .insert(schema.ads)
        .values({
          campaignId: campaign.id,
          line: a.line,
          displayUrl: a.displayUrl,
          targetUrl: a.targetUrl,
          moderation: "approved", // pre-approved so it can serve immediately
        })
        .returning({ id: schema.ads.id });

      await db.insert(schema.bids).values({
        campaignId: campaign.id,
        adId: ad.id,
        advertiserId: advertiser.id,
        maxCpmMillicents: a.cpm,
        budgetMillicents: a.budget,
        status: "active",
      });

      // Fund the balance directly (the Stripe webhook does this in prod).
      const groupId = randomUUID();
      await db.insert(schema.ledgerEntries).values([
        {
          groupId,
          account: "advertiser_balance",
          ownerId: advertiser.id,
          direction: "credit",
          amountMillicents: a.budget,
          reason: "topup",
          refType: "seed",
          refId: `seed-${advertiser.id}`,
        },
        {
          groupId,
          account: "external",
          ownerId: null,
          direction: "debit",
          amountMillicents: a.budget,
          reason: "topup",
          refType: "seed",
          refId: `seed-${advertiser.id}`,
        },
      ]);

      // A short clearing-price history so the market chart isn't empty on first load.
      const now = Date.now();
      const points = Array.from({ length: 12 }, (_, i) => {
        const wobble = ((i * 37) % 11) - 5; // deterministic ±5% wobble, no RNG
        const cpm = Math.max(dollars(1), Math.round(a.cpm * (1 + wobble / 100)));
        return {
          advertiserId: advertiser.id,
          cpmMillicents: cpm,
          clearingCpmMillicents: Math.round(cpm * 0.9),
          at: new Date(now - (11 - i) * 5 * 60 * 1000), // every 5 min over the last hour
        };
      });
      await db.insert(schema.bidHistory).values(points);

      console.log(`seeded ${a.name}  advertiser=${advertiser.id}  ad=${ad.id}  cpm=$${(a.cpm / 100_000).toFixed(2)}/1k  funded=$${(a.budget / 100_000).toFixed(2)}`);
    }
    console.log("seed complete.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
