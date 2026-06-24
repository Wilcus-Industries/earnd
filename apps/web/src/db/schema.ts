/**
 * earnd data model (Drizzle / Postgres).
 *
 * Money is stored in INTEGER MILLICENTS (1/1000 of a cent) using bigint. Values
 * stay far within JS safe-integer range (>$90B would be needed to overflow), so
 * we read them as `number` for ergonomics.
 *
 * The append-only `ledgerEntries` table is the single source of truth for every
 * balance and escrow figure — never a cached column. A balance is a SUM over the
 * ledger, computed inside the serving transaction with a row lock (see ledger.ts).
 */
import { randomBytes } from "node:crypto";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const money = (name: string) => bigint(name, { mode: "number" });

// ── enums ───────────────────────────────────────────────────────────
export const moderationStatus = pgEnum("moderation_status", [
  "pending",
  "approved",
  "rejected",
]);
export const bidStatus = pgEnum("bid_status", ["active", "paused", "depleted"]);
export const ledgerDirection = pgEnum("ledger_direction", ["credit", "debit"]);
export const ledgerAccount = pgEnum("ledger_account", [
  "advertiser_balance",
  "publisher_escrow",
  "platform_revenue",
  "external", // Stripe / the outside world (keeps double-entry balanced)
]);
export const ledgerReason = pgEnum("ledger_reason", [
  "topup",
  "impression_charge",
  "impression_accrual",
  "platform_fee",
  "payout",
  "refund",
  "clawback",
]);
export const surfaceKind = pgEnum("surface_kind", ["shell", "tmux", "vim"]);
export const payoutStatus = pgEnum("payout_status", [
  "pending",
  "in_transit",
  "paid",
  "failed",
]);

// ── advertisers + campaigns + creatives ─────────────────────────────
export const advertisers = pgTable(
  "advertisers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    // Links to the better-auth user who owns this advertiser account.
    // Nullable: rows created before auth existed have no user. New bids create
    // the advertiser with the session user's id (see /api/bids).
    userId: text("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One account per email. The find-or-create in /api/bids races under concurrency
  // without this; the unique index makes a duplicate insert fail closed so two
  // first-time bids can't split a balance across two advertiser rows.
  (t) => [uniqueIndex("advertisers_email_idx").on(t.email)],
);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  advertiserId: uuid("advertiser_id")
    .notNull()
    .references(() => advertisers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ads = pgTable(
  "ads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    // Sanitized banner text actually rendered into the terminal (no escape bytes).
    line: text("line").notNull(),
    // Human display URL shown in the banner (e.g. "earnd.net").
    displayUrl: text("display_url").notNull(),
    // The real click destination (https only); served only via a signed redirect.
    targetUrl: text("target_url").notNull(),
    // Optional small base64 icon (validated).
    icon: text("icon"),
    moderation: moderationStatus("moderation").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ads_campaign_idx").on(t.campaignId)],
);

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    adId: uuid("ad_id")
      .notNull()
      .references(() => ads.id, { onDelete: "cascade" }),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id, { onDelete: "cascade" }),
    // Max CPM the advertiser will pay, in millicents per 1,000 impressions.
    maxCpmMillicents: money("max_cpm_millicents").notNull(),
    // Total budget cap, millicents. Enforced authoritatively against the ledger.
    budgetMillicents: money("budget_millicents").notNull(),
    // Optional per-day pacing cap, millicents.
    dailyCapMillicents: money("daily_cap_millicents"),
    status: bidStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bids_active_idx").on(t.status, t.advertiserId)],
);

// ── publishers (the developers who run the banner) ──────────────────
export const publishers = pgTable("publishers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Audit-only counter (0 = clean). The serving hold keys off a decaying windowed
  // SIVT count, not this monotonic value — see antifraud.ts.
  fraudScore: integer("fraud_score").notNull().default(0),
  // Bearer secret for the publisher's own dashboard + payout onboarding. Distinct
  // from the row id (which appears in URLs/logs) so earnings can't be read by anyone
  // who merely learns the id. Printed by `earnd status`, never sent to the browser
  // except by the holder.
  dashboardToken: text("dashboard_token")
    .notNull()
    .$defaultFn(() => randomBytes(24).toString("base64url")),
});

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publishers.id, { onDelete: "cascade" }),
    // Per-install public key (Ed25519, base64). Signs begin/heartbeat/redeem.
    publicKey: text("public_key").notNull(),
    os: text("os"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("devices_pubkey_idx").on(t.publicKey)],
);

// ── the append-only money ledger (double-entry) ─────────────────────
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Entries sharing a groupId form one balanced transaction.
    groupId: uuid("group_id").notNull(),
    account: ledgerAccount("account").notNull(),
    // The advertiser or publisher this account belongs to (null for platform/external).
    ownerId: uuid("owner_id"),
    direction: ledgerDirection("direction").notNull(),
    amountMillicents: money("amount_millicents").notNull(),
    currency: text("currency").notNull().default("usd"),
    reason: ledgerReason("reason").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_account_owner_idx").on(t.account, t.ownerId),
    index("ledger_group_idx").on(t.groupId),
  ],
);

// ── impressions + clicks ────────────────────────────────────────────
export const impressions = pgTable(
  "impressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Server token nonce — unique so a token can only ever be redeemed once.
    nonce: text("nonce").notNull(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publishers.id, { onDelete: "cascade" }),
    adId: uuid("ad_id")
      .notNull()
      .references(() => ads.id, { onDelete: "cascade" }),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id, { onDelete: "cascade" }),
    surface: surfaceKind("surface").notNull(),
    // GSP clearing price (CPM millicents) and the resulting per-impression charge.
    clearingCpmMillicents: money("clearing_cpm_millicents").notNull(),
    chargeMillicents: money("charge_millicents").notNull(),
    dwellSeconds: integer("dwell_seconds").notNull(),
    // Validation outcome: 'valid' billed, 'givt'/'sivt' filtered/held, etc.
    validation: text("validation").notNull().default("valid"),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("impressions_nonce_idx").on(t.nonce),
    index("impressions_advertiser_idx").on(t.advertiserId),
    index("impressions_publisher_idx").on(t.publisherId),
    index("impressions_redeemed_idx").on(t.redeemedAt),
  ],
);

export const clicks = pgTable(
  "clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adId: uuid("ad_id")
      .notNull()
      .references(() => ads.id, { onDelete: "cascade" }),
    impressionId: uuid("impression_id").references(() => impressions.id, {
      onDelete: "set null",
    }),
    // Dedupe key derived from the signed click token.
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("clicks_dedupe_idx").on(t.dedupeKey)],
);

// ── bid market time series ──────────────────────────────────────────
export const bidHistory = pgTable(
  "bid_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id, { onDelete: "cascade" }),
    cpmMillicents: money("cpm_millicents").notNull(),
    // The clearing CPM at this moment (for the public market series).
    clearingCpmMillicents: money("clearing_cpm_millicents"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bid_history_at_idx").on(t.at)],
);

// ── Stripe Connect payouts ──────────────────────────────────────────
export const payoutAccounts = pgTable(
  "payout_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publishers.id, { onDelete: "cascade" }),
    stripeAccountId: text("stripe_account_id").notNull(),
    // Set true once account.updated reports onboarding/KYC complete + payouts enabled.
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    // `created` timestamp of the most recent account.updated event applied to this
    // row. Stripe can deliver events out of order; we only apply an event whose
    // timestamp is newer than this, so a stale event can't flip payoutsEnabled back.
    payoutsEnabledUpdatedAt: timestamp("payouts_enabled_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One connected account per publisher. Without this a concurrent onboarding can
  // create two accounts and the payout join can fan out duplicate transfers.
  (t) => [uniqueIndex("payout_accounts_publisher_idx").on(t.publisherId)],
);

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publishers.id, { onDelete: "cascade" }),
    amountMillicents: money("amount_millicents").notNull(),
    stripeTransferId: text("stripe_transfer_id"),
    status: payoutStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Nullable-unique: many 'pending' rows (null transfer) are allowed, but a given
  // Stripe transfer can be recorded at most once.
  (t) => [uniqueIndex("payouts_transfer_idx").on(t.stripeTransferId)],
);

// ── webhook idempotency ─────────────────────────────────────────────
export const processedWebhookEvents = pgTable("processed_webhook_events", {
  // Stripe event.id — unique, so a replayed webhook is a no-op.
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload"),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── distributed rate limiting ───────────────────────────────────────
// Fixed-window counters backing the rate limiter. Lives in Postgres (not process
// memory) so the limit holds across serverless instances, which each have their
// own heap and would otherwise multiply the effective limit by the instance count.
export const rateLimits = pgTable("rate_limits", {
  // e.g. "register:<ip>" — the bucket key.
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  // When the current window expires; a hit past this resets the counter to 1.
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

// ── better-auth tables ──────────────────────────────────────────────
// Backs the advertiser sign-in flow. Names map to better-auth's expected
// schema (drizzleAdapter config: user/session/account/verification).
export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const sessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});
