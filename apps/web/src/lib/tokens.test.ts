import { beforeAll, describe, expect, it } from "vitest";

// tokens.ts reads the signing key via serverEnv() lazily on first use, so populate
// the required server env before importing the module under test.
beforeAll(() => {
  process.env.EARND_TOKEN_SIGNING_KEY = "test-signing-key-test-signing-key-32+";
  process.env.DATABASE_URL = "postgres://localhost/test";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_x";
  process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-32-chars-min";
});

const impressionPayload = {
  nonce: "n1",
  adId: "ad1",
  advertiserId: "adv1",
  publisherId: "pub1",
  deviceId: "dev1",
  surface: "shell" as const,
  clearingCpmMillicents: 100_000,
  chargeMillicents: 100,
  minDwellSeconds: 5,
  issuedAt: Date.now(),
  expiresAt: Date.now() + 120_000,
};

describe("token domain separation", () => {
  it("verifies each token kind under its own context", async () => {
    const { signImpressionToken, verifyImpressionToken, signClickToken, verifyClickToken } =
      await import("@/lib/tokens");
    expect(verifyImpressionToken(signImpressionToken(impressionPayload))).not.toBeNull();
    expect(verifyClickToken(signClickToken({ adId: "ad1" }))).not.toBeNull();
  });

  it("refuses a click token presented as an impression token (confused-deputy closed)", async () => {
    const { signClickToken, verifyImpressionToken } = await import("@/lib/tokens");
    const clickToken = signClickToken({ adId: "ad1" });
    // Same key, same wire format — but the impression context won't verify it.
    expect(verifyImpressionToken(clickToken)).toBeNull();
  });

  it("refuses an impression token presented as a click token", async () => {
    const { signImpressionToken, verifyClickToken } = await import("@/lib/tokens");
    expect(verifyClickToken(signImpressionToken(impressionPayload))).toBeNull();
  });

  it("rejects a tampered impression token", async () => {
    const { signImpressionToken, verifyImpressionToken } = await import("@/lib/tokens");
    const tok = signImpressionToken(impressionPayload);
    const [body] = tok.split(".");
    expect(verifyImpressionToken(`${body}.AAAA`)).toBeNull();
  });
});
