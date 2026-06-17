import { z } from "zod";

/**
 * Server-only environment. Parsed lazily (on first access) so that `next build`
 * and typechecks don't require secrets to be present at module-eval time.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  EARND_TOKEN_SIGNING_KEY: z.string().min(16, "EARND_TOKEN_SIGNING_KEY must be >= 16 chars"),
  NEXT_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  EARND_API_BASE: z.string().url().optional(),
  // Shared secret gating the moderation queue. When unset, the moderation API
  // fails closed (no creative can be approved), so creatives never serve by default.
  EARND_ADMIN_TOKEN: z.string().min(16, "EARND_ADMIN_TOKEN must be >= 16 chars").optional(),
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
