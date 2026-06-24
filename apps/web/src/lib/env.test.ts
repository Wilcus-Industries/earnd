import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression test for the env placeholder guard. The bug this guards against: the
// guard regex (`/^change-me/i`) didn't match the placeholders we actually ship in
// .env.example (`REPLACE_ME__openssl_rand_…`), so serverEnv() would happily accept
// the public example secrets — silently shipping a guessable token-signing key /
// admin token / auth secret. These tests pin the guard to the REAL file.

const ENV_EXAMPLE = fileURLToPath(new URL("../../../../.env.example", import.meta.url));

/** Pull `KEY="value"` (or `KEY=value`) out of .env.example. */
function exampleValue(key: string): string {
  const src = readFileSync(ENV_EXAMPLE, "utf8");
  const m = src.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) throw new Error(`${key} not found in .env.example`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const VALID = {
  DATABASE_URL: "postgres://localhost/test",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test_x",
  EARND_TOKEN_SIGNING_KEY: "real-signing-key-real-signing-key-32+",
  BETTER_AUTH_SECRET: "real-better-auth-secret-32-chars-min",
};

const MANAGED_KEYS = [...Object.keys(VALID), "EARND_ADMIN_TOKEN"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of MANAGED_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of MANAGED_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Fresh serverEnv() against `env` (serverEnv caches, so reset the module first). */
async function parse(env: Record<string, string | undefined>) {
  for (const k of MANAGED_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  vi.resetModules();
  const { serverEnv } = await import("@/env");
  return serverEnv();
}

describe("serverEnv placeholder guard", () => {
  it("accepts a fully-populated, non-placeholder config", async () => {
    const env = await parse(VALID);
    expect(env.EARND_TOKEN_SIGNING_KEY).toBe(VALID.EARND_TOKEN_SIGNING_KEY);
  });

  it("rejects the EARND_TOKEN_SIGNING_KEY placeholder shipped in .env.example", async () => {
    await expect(
      parse({ ...VALID, EARND_TOKEN_SIGNING_KEY: exampleValue("EARND_TOKEN_SIGNING_KEY") }),
    ).rejects.toThrow(/EARND_TOKEN_SIGNING_KEY/);
  });

  it("rejects the BETTER_AUTH_SECRET placeholder shipped in .env.example", async () => {
    await expect(
      parse({ ...VALID, BETTER_AUTH_SECRET: exampleValue("BETTER_AUTH_SECRET") }),
    ).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects the EARND_ADMIN_TOKEN placeholder shipped in .env.example", async () => {
    await expect(
      parse({ ...VALID, EARND_ADMIN_TOKEN: exampleValue("EARND_ADMIN_TOKEN") }),
    ).rejects.toThrow(/EARND_ADMIN_TOKEN/);
  });

  it("requires BETTER_AUTH_SECRET at runtime (no longer optional)", async () => {
    await expect(parse({ ...VALID, BETTER_AUTH_SECRET: undefined })).rejects.toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("still rejects the legacy change-me placeholder", async () => {
    await expect(
      parse({ ...VALID, EARND_TOKEN_SIGNING_KEY: "change-me-change-me-change-me-32x" }),
    ).rejects.toThrow(/EARND_TOKEN_SIGNING_KEY/);
  });
});
