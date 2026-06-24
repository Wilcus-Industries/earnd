import { z } from "zod";

/**
 * Server-only environment. Parsed lazily (on first access) so that `next build`
 * and typechecks don't require secrets to be present at module-eval time.
 */

// Reject the well-known placeholder values shipped in .env.example so a deploy
// can never go live signing tokens / gating admin with a guessable secret.
// Must match the placeholders we ACTUALLY ship — historically "change-me…", now
// "REPLACE_ME__openssl_rand_…". We also reject the embedded "openssl_rand" hint
// anywhere in the value, so a half-edited example string can never validate.
const PLACEHOLDER = /^(change-me|replace[_-]?me)|openssl_rand/i;
// Zod treats ANY truthy return from a .refine predicate as "valid", so this MUST
// return a plain boolean. (A previous version returned `!test(v) || msg`, which for
// a placeholder evaluated to the non-empty message string — truthy — so the guard
// silently passed every value.) The human-readable message lives in the refine
// options object below.
const notPlaceholder = (v: string) => !PLACEHOLDER.test(v);

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  // HMAC key for single-use redirect/impression tokens. 32 chars floors the
  // keyspace well above brute-forcing of the signed tokens (CWE-326).
  EARND_TOKEN_SIGNING_KEY: z
    .string()
    .min(32, "EARND_TOKEN_SIGNING_KEY must be >= 32 chars")
    .refine(notPlaceholder, {
      message: "EARND_TOKEN_SIGNING_KEY is still the placeholder — set a real secret",
    }),
  NEXT_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  EARND_API_BASE: z.string().url().optional(),
  // Shared secret gating the moderation queue. When unset, the moderation API
  // fails closed (no creative can be approved), so creatives never serve by default.
  EARND_ADMIN_TOKEN: z
    .string()
    .min(16, "EARND_ADMIN_TOKEN must be >= 16 chars")
    .refine(notPlaceholder, {
      message: "EARND_ADMIN_TOKEN is still the placeholder — set a real secret",
    })
    .optional(),
  // better-auth session encryption secret. Required at runtime — a missing value
  // makes better-auth fall back to an ephemeral/insecure secret (per-instance on
  // serverless → session forgery/breakage). Not .optional(): serverEnv() is lazy
  // (never called at module-eval), so build/typecheck still don't need it, but the
  // first request that touches the env fails closed if it's unset. Generate:
  // openssl rand -base64 32
  BETTER_AUTH_SECRET: z
    .string()
    .min(16, "BETTER_AUTH_SECRET must be >= 16 chars")
    .refine(notPlaceholder, {
      message: "BETTER_AUTH_SECRET is still the placeholder — set a real secret",
    }),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
