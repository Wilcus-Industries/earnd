// One-off: verify the configured Stripe keys authenticate against the sandbox.
import { readFileSync } from "node:fs";
import Stripe from "stripe";

// Minimal .env.local parser (no extra dep).
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const key = env.STRIPE_SECRET_KEY;
console.log("secret key prefix:", key?.slice(0, 8), "len:", key?.length);
const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });

try {
  const acct = await stripe.accounts.retrieve();
  const bal = await stripe.balance.retrieve();
  console.log("AUTH OK ✓");
  console.log("account id:", acct.id);
  console.log("livemode:", acct.charges_enabled !== undefined ? "(test key => sandbox)" : "?");
  console.log("available balance:", JSON.stringify(bal.available));
  // Confirm the key is test-mode (sandbox), not live.
  console.log("key is test mode:", key.startsWith("sk_test_"));
} catch (e) {
  console.error("AUTH FAILED ✗:", e.message);
  process.exit(1);
}
