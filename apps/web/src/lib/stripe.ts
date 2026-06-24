import Stripe from "stripe";
import { serverEnv } from "@/env";

/**
 * Lazy Stripe client singleton. Constructed on first use so `next build` and
 * typechecks don't require STRIPE_SECRET_KEY at module-eval time.
 *
 * Use a RESTRICTED key (`rk_…`) in production — least privilege per the Stripe
 * best-practices skill. The pinned API version matches the installed SDK's
 * default (`Stripe.LatestApiVersion`), so request/response types line up.
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  _stripe = new Stripe(serverEnv().STRIPE_SECRET_KEY, {
    apiVersion: "2026-05-27.dahlia",
    appInfo: { name: "earnd", url: "https://www.earnd.dev" },
    typescript: true,
  });
  return _stripe;
}

/**
 * Whether the configured Stripe key is a LIVE key. Read raw from process.env
 * (not serverEnv) so callers in always-rendered chrome — e.g. the site footer —
 * never throw when the full server schema is incomplete; an unset/test key just
 * reads as not-live. Covers both secret (sk_) and restricted (rk_) live keys.
 */
export function stripeLiveMode(): boolean {
  const k = process.env.STRIPE_SECRET_KEY ?? "";
  return k.startsWith("sk_live_") || k.startsWith("rk_live_");
}
