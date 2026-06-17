/**
 * earnd economics — the single source of truth for money + auction constants.
 * Every value here is intentionally tunable; nothing else in the codebase should
 * hard-code these numbers. See the plan's "Starting economics" section.
 *
 * Money is stored and computed in INTEGER MILLICENTS to stay exact under sub-cent
 * CPM math. 1 US dollar = 100 cents = 100_000 millicents.
 */

export const MILLICENTS_PER_CENT = 1_000;
export const MILLICENTS_PER_DOLLAR = 100 * MILLICENTS_PER_CENT; // 100_000

export const dollarsToMillicents = (usd: number): number =>
  Math.round(usd * MILLICENTS_PER_DOLLAR);

export const millicentsToDollars = (mc: number): number => mc / MILLICENTS_PER_DOLLAR;

/** Format millicents as a USD string, e.g. 150_000 -> "$1.50". */
export const formatMillicents = (mc: number): string =>
  `$${(mc / MILLICENTS_PER_DOLLAR).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const ECONOMICS = {
  currency: "usd",

  /** An impression requires this many seconds of confirmed continuous display. */
  impressionMinDwellSeconds: 5,
  /** Random extra dwell (0..jitterMax) added server-side to defeat machine-gun redemption. */
  impressionDwellJitterMaxSeconds: 3,
  /** Impression token lifetime before it expires unredeemed. */
  impressionTokenTtlSeconds: 120,
  /** Heartbeat cadence the client should use while a banner is displayed. */
  heartbeatIntervalSeconds: 2,

  /** Bids are CPM — price per 1,000 impressions. Minimum $1 / 1,000. */
  minBidCpmMillicents: dollarsToMillicents(1), // 100_000 mc per 1,000 imps
  /** Minimum advertiser top-up via Stripe Checkout. */
  minTopUpMillicents: dollarsToMillicents(20),
  /** GSP minimum increment over the next-highest bid, in CPM millicents. */
  gspIncrementMillicents: dollarsToMillicents(0.01),

  /** Publisher revenue share (locked at 50%). */
  publisherShareBps: 5_000, // basis points => 50.00%

  /** Payout requires Stripe Connect KYC and at least this escrowed balance. */
  payoutThresholdMillicents: dollarsToMillicents(25),
  /** Publisher earnings are held this long before becoming payout-eligible (clawback window). */
  escrowHoldDays: 30,

  /**
   * Fraud bound: no artificial $/hr earning cap (product decision). The physical
   * ceiling is one impression per (minDwell) per active surface. This is the plausibility
   * limit the server enforces on redemption rate; redemptions above it are rejected/scored.
   */
  maxRedemptionsPerHourPerSurface: Math.floor((60 * 60) / 5), // ~720 (GIVT cutoff — hard reject)

  /**
   * Soft suspicion band, well below the physical ceiling. Redemptions at/above this
   * sustained rate are recorded but marked SIVT and NOT billed/accrued (held, not
   * rejected) — the "bill only validated impressions" rule. ~66% of the ceiling.
   */
  softRedemptionsPerHourPerSurface: Math.floor(((60 * 60) / 5) * 0.66), // ~475

  /**
   * Publisher-level rate aggregation. One human ≈ one attention regardless of how
   * many devices/surfaces they run, so a fan-out attacker (N devices each just under
   * the per-surface band) is still bounded here. Mirrors the per-surface bands at the
   * publisher grain: hard ceiling rejects (GIVT), soft band holds (SIVT).
   */
  maxRedemptionsPerHourPerPublisher: Math.floor((60 * 60) / 5), // ~720 (GIVT cutoff)
  softRedemptionsPerHourPerPublisher: Math.floor(((60 * 60) / 5) * 0.66), // ~475

  /**
   * Decaying SIVT hold. A publisher with this many SIVT redemptions inside the
   * trailing window has ALL redemptions held until the window rolls off — so the
   * hold is reversible (it decays), not a permanent denial-of-earnings.
   */
  sivtHoldWindowHours: 24,
  sivtHoldCountThreshold: 20,
  /** Audit-only: how much an SIVT redemption raises the monotonic fraud score. */
  fraudScoreIncrementOnSivt: 1,
} as const;

/** Charge for a single impression at a given CPM, in integer millicents. */
export const impressionChargeMillicents = (cpmMillicents: number): number =>
  Math.round(cpmMillicents / 1000);

/** Publisher accrual for a charged impression, in integer millicents. */
export const publisherAccrualMillicents = (chargeMillicents: number): number =>
  Math.floor((chargeMillicents * ECONOMICS.publisherShareBps) / 10_000);

export type Economics = typeof ECONOMICS;
