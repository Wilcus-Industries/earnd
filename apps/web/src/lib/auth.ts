import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, type Db } from "@/db";
import * as schema from "@/db/schema";

/**
 * better-auth — advertiser sign-in. Backed by the same Neon Postgres as the
 * rest of the app via the Drizzle adapter. Email + password only (no OAuth);
 * add a provider here later if needed — no schema change required.
 *
 * `secret` is read lazily by better-auth from the BETTER_AUTH_SECRET env var at
 * request time, so this module is import-safe during `next build` (no secrets
 * required at module-eval — same lazy philosophy as the rest of the codebase).
 *
 * The Drizzle adapter only touches `db` when a request arrives, so we hand it a
 * lazy proxy that resolves `getDb()` (and thus `serverEnv()`) on first access.
 * Calling `getDb()` directly here would force a DB connection at import time and
 * break the build, which otherwise runs without secrets.
 */
const baseURL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

const lazyDb = new Proxy({} as Db, {
  get(_t, prop) {
    const db = getDb() as unknown as Record<string | symbol, unknown>;
    const value = db[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(db) : value;
  },
});

export const auth = betterAuth({
  baseURL,
  trustedOrigins: [baseURL],
  database: drizzleAdapter(lazyDb, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
});
