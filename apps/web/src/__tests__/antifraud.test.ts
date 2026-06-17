import { describe, expect, it } from "vitest";
import { ECONOMICS } from "@earnd/contracts";
import { classifyRedemption } from "@/lib/antifraud";

const clean = {
  deviceRecent: 0,
  publisherRecent: 0,
  publisherRecentSivt: 0,
  displayedSeconds: ECONOMICS.impressionMinDwellSeconds + 1,
  minDwellSeconds: ECONOMICS.impressionMinDwellSeconds,
};

describe("redemption classifier (valid vs held SIVT)", () => {
  it("bills a clean, dwell-met redemption at human cadence", () => {
    const v = classifyRedemption(clean);
    expect(v.validation).toBe("valid");
    expect(v.bill).toBe(true);
  });

  it("holds (SIVT, unbilled) when one device enters the soft band", () => {
    const v = classifyRedemption({
      ...clean,
      deviceRecent: ECONOMICS.softRedemptionsPerHourPerSurface,
    });
    expect(v.validation).toBe("sivt");
    expect(v.bill).toBe(false);
    expect(v.reason).toBe("device_rate_soft_band");
  });

  it("holds when the publisher aggregate enters the soft band (fan-out defeated)", () => {
    const v = classifyRedemption({
      ...clean,
      publisherRecent: ECONOMICS.softRedemptionsPerHourPerPublisher,
    });
    expect(v.validation).toBe("sivt");
    expect(v.bill).toBe(false);
    expect(v.reason).toBe("publisher_rate_soft_band");
  });

  it("holds a publisher with a standing windowed SIVT pattern", () => {
    const v = classifyRedemption({
      ...clean,
      publisherRecentSivt: ECONOMICS.sivtHoldCountThreshold,
    });
    expect(v.validation).toBe("sivt");
    expect(v.bill).toBe(false);
    expect(v.reason).toBe("publisher_flagged");
  });

  it("never bills a sub-dwell redemption (defensive)", () => {
    const v = classifyRedemption({ ...clean, displayedSeconds: 0 });
    expect(v.bill).toBe(false);
  });

  it("soft bands sit below the hard GIVT ceilings at both grains", () => {
    expect(ECONOMICS.softRedemptionsPerHourPerSurface).toBeLessThan(
      ECONOMICS.maxRedemptionsPerHourPerSurface,
    );
    expect(ECONOMICS.softRedemptionsPerHourPerPublisher).toBeLessThan(
      ECONOMICS.maxRedemptionsPerHourPerPublisher,
    );
  });
});
