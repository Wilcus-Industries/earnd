import { describe, expect, it } from "vitest";
import { DWELL_CLOCK_SKEW_SECONDS, effectiveDwellSeconds, serverElapsedSeconds } from "@/lib/dwell";

const MIN_DWELL = 5;
const issued = 1_000_000_000_000; // fixed token issue time (unix ms)

describe("wall-clock dwell gate", () => {
  it("clamps an inflated client claim to real elapsed time (the core exploit)", () => {
    // Token just issued; attacker claims 99999s of display.
    const now = issued + 50; // 50ms later
    const eff = effectiveDwellSeconds(issued, now, 99_999);
    // Capped to ~skew, nowhere near the 99999 claimed.
    expect(eff).toBeLessThanOrEqual(serverElapsedSeconds(issued, now) + DWELL_CLOCK_SKEW_SECONDS);
    expect(eff).toBeLessThan(MIN_DWELL); // → redeem gate denies "dwell_unmet"
  });

  it("passes the gate only once real wall-clock time has elapsed", () => {
    const now = issued + 6_000; // 6s later
    const eff = effectiveDwellSeconds(issued, now, 6);
    expect(eff).toBeGreaterThanOrEqual(MIN_DWELL); // → gate allows
  });

  it("does not let a slightly-early client claim slip through past the skew", () => {
    const now = issued + 3_000; // only 3s elapsed
    // Even if the client claims it met the 5s dwell, server elapsed (3s + 1s skew) caps it.
    const eff = effectiveDwellSeconds(issued, now, 5);
    expect(eff).toBeLessThan(MIN_DWELL);
  });

  it("passes an honest under-reporting client through unchanged", () => {
    const now = issued + 10_000; // 10s elapsed
    const eff = effectiveDwellSeconds(issued, now, 7); // client honestly says 7
    expect(eff).toBe(7);
  });

  it("never returns a negative dwell", () => {
    const now = issued - 10_000; // clock skew / token from the future
    expect(effectiveDwellSeconds(issued, now, 3)).toBe(0);
  });
});
