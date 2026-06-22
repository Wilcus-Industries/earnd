/**
 * Server-authoritative dwell accounting.
 *
 * The dwell gate (viewability analog) is the headline anti-fraud guarantee: an
 * impression only bills after the banner has been displayed for `minDwellSeconds`.
 * The client reports `displayedSeconds`, but the client runs on adversary-controlled
 * hardware — left unchecked it can claim any value (`displayedSeconds: 99999`) the
 * instant a token is issued and clear the gate in milliseconds.
 *
 * The fix is to never trust a client clock above the server's own measurement.
 * `issuedAt` is baked into the signed token, so the server knows exactly how long
 * ago it minted the token. Real continuous display can be at most that elapsed
 * wall-clock time, so we CAP the client's claim at server-elapsed (plus a small
 * skew for RTT/clock drift). An inflated `displayedSeconds` is clamped back down
 * and the gate holds on real time.
 */

/** Allowance for network RTT + minor clock skew between issue and redeem (seconds). */
export const DWELL_CLOCK_SKEW_SECONDS = 1;

/** Wall-clock seconds elapsed since the token was issued, per the server's clock. */
export function serverElapsedSeconds(issuedAtMs: number, nowMs: number): number {
  return (nowMs - issuedAtMs) / 1000;
}

/**
 * The dwell the server will act on: the client's claim, clamped to `[0, serverElapsed
 * + skew]`. Never exceeds real elapsed time, so a forged client value cannot inflate
 * billing or skip the gate; an honest (or under-reporting) client passes through
 * unchanged.
 */
export function effectiveDwellSeconds(
  issuedAtMs: number,
  nowMs: number,
  clientReportedSeconds: number,
  skew: number = DWELL_CLOCK_SKEW_SECONDS,
): number {
  const ceiling = serverElapsedSeconds(issuedAtMs, nowMs) + skew;
  return Math.max(0, Math.min(clientReportedSeconds, ceiling));
}
