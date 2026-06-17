/**
 * Impression validation classifier. The threat model is honest: the client runs on
 * adversary-controlled hardware and no client signal proves a human saw the ad. The
 * achievable guarantee is bounded + detectable + reversible-before-payout, not
 * bypass-proof. This layer turns soft signals into a billing decision.
 *
 * Three outcomes, mirroring IAB/MRC vocabulary:
 *  - valid → counted + billed + accrued to the publisher.
 *  - sivt  → counted (for the transparency rate) but HELD: not billed, not accrued.
 *            Sophisticated invalid traffic — suspicious but not provably automated.
 *  - givt  → general invalid traffic; rejected outright upstream (the hard rate
 *            ceilings in the redeem route), never reaches this classifier.
 *
 * Bands exist at BOTH the device grain (per surface) and the publisher grain — a
 * fan-out attacker spreading load across many devices is bounded by the publisher
 * band, and the windowed SIVT count means a publisher hold decays instead of being
 * a permanent denial-of-earnings.
 *
 * This function is PURE: the caller computes the counts (under the redeem
 * transaction's locks) and passes them in.
 */
import { ECONOMICS } from "@earnd/contracts/config";

export type Validation = "valid" | "givt" | "sivt";

export interface RedemptionSignals {
  /** Redemptions by this device on this surface in the trailing hour. */
  deviceRecent: number;
  /** Redemptions by this publisher (all devices/surfaces) in the trailing hour. */
  publisherRecent: number;
  /** SIVT-classified redemptions by this publisher inside the decaying hold window. */
  publisherRecentSivt: number;
  /** Continuous display seconds the client reported. */
  displayedSeconds: number;
  /** Required dwell for this token. */
  minDwellSeconds: number;
}

export interface RedemptionVerdict {
  validation: Validation;
  /** Whether to charge the advertiser + accrue the publisher's share. */
  bill: boolean;
  /** Human-readable reason when held. */
  reason?: string;
}

export function classifyRedemption(s: RedemptionSignals): RedemptionVerdict {
  // Sustained rate inside the soft band (below the hard ceiling that already
  // rejected upstream): plausible human cadence is exceeded → hold.
  if (s.deviceRecent >= ECONOMICS.softRedemptionsPerHourPerSurface) {
    return { validation: "sivt", bill: false, reason: "device_rate_soft_band" };
  }
  // Same, aggregated across all of a publisher's devices (defeats fan-out).
  if (s.publisherRecent >= ECONOMICS.softRedemptionsPerHourPerPublisher) {
    return { validation: "sivt", bill: false, reason: "publisher_rate_soft_band" };
  }
  // A publisher with a standing pattern of SIVT (within the window) is held until
  // the window rolls off — a decaying hold, not a permanent one.
  if (s.publisherRecentSivt >= ECONOMICS.sivtHoldCountThreshold) {
    return { validation: "sivt", bill: false, reason: "publisher_flagged" };
  }
  // Defensive: the dwell gate runs before this, but never bill a sub-dwell redeem.
  if (s.displayedSeconds < s.minDwellSeconds) {
    return { validation: "sivt", bill: false, reason: "dwell_unmet" };
  }
  return { validation: "valid", bill: true };
}
