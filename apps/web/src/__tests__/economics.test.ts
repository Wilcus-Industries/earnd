import { describe, expect, it } from "vitest";
import {
  ECONOMICS,
  dollarsToMillicents,
  impressionChargeMillicents,
  millicentsToDollars,
  publisherAccrualMillicents,
} from "@earnd/contracts";

describe("earnd economics (integer millicents)", () => {
  it("converts dollars <-> millicents exactly", () => {
    expect(dollarsToMillicents(20)).toBe(2_000_000);
    expect(millicentsToDollars(2_000_000)).toBe(20);
  });

  it("charges CPM / 1000 per impression", () => {
    // $5 CPM => $0.005/impression => 500 millicents
    expect(impressionChargeMillicents(dollarsToMillicents(5))).toBe(500);
    // $1 CPM (the minimum) => 100 millicents/impression
    expect(impressionChargeMillicents(ECONOMICS.minBidCpmMillicents)).toBe(100);
  });

  it("splits 50% of each charge to the publisher escrow", () => {
    expect(publisherAccrualMillicents(500)).toBe(250);
    // odd charge floors the publisher share (platform keeps the remainder cent-fraction)
    expect(publisherAccrualMillicents(101)).toBe(50);
  });

  it("min bid is $1 CPM and min top-up is $20", () => {
    expect(ECONOMICS.minBidCpmMillicents).toBe(100_000);
    expect(ECONOMICS.minTopUpMillicents).toBe(2_000_000);
  });

  it("publisher share is 50%", () => {
    expect(ECONOMICS.publisherShareBps).toBe(5_000);
  });
});
