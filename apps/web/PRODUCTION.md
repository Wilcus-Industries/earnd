# earnd — Production Cutover Runbook

Status as of last verification (test mode, local):

| Path | State |
|------|-------|
| Advertiser top-up (Checkout → webhook → ledger credit) | ✅ Proven end-to-end |
| Refund/dispute clawback (charge.refunded → ledger debit) | ✅ Proven end-to-end |
| Idempotent webhook replay (no double-credit) | ✅ Proven |
| Test suite (`pnpm test`) | ✅ 18/18 passing |
| Publisher payouts (Connect) | ⛔ **BLOCKED — Connect not enabled on the Stripe account** |

---

## 0. BLOCKER — enable Stripe Connect first

The publisher payout half (`/api/connect`, `/api/payouts/run`, `lib/connect.ts`) cannot run
until Connect is enabled on the platform account `acct_1TjCZmCqXaxA5mAC` ("Wilcus Industries").
Creating a recipient account currently fails with:

> 'defaults.responsibilities / dashboard / configuration.recipient.capabilities.stripe_balance:
> You must have Connect enabled to use this field.'

**Fix (Dashboard, not API):** Stripe Dashboard → **Connect** → Get started → accept the Connect
terms and complete the platform profile. Do it in **test mode** first, then re-run:

```bash
cd apps/web && node scripts/smoke-connect.mjs   # should print "Connect API surface OK"
```

Only after that passes is the payout path testable (and only then is it a production candidate).

---

## 1. Stripe live-mode credentials

1. **Restricted key** — Dashboard (LIVE) → Developers → API keys → Create restricted key (`rk_live_…`).
   Grant write on: Charges, Checkout Sessions, Customers, PaymentIntents, and (for payouts)
   Connect + Transfers. Least privilege — do **not** use the raw `sk_live_`.
2. **Publishable key** — copy the `pk_live_…`.
3. Put both in `apps/web/.env.production.local` (already scaffolded; replace the `REPLACE_ME`s).
   - ⚠️ The CLI test keys currently expire **2026-09-18**; live restricted keys you create here are separate.

## 2. Webhook endpoint (live)

`stripe listen` secrets are ephemeral and dev-only. For production:

1. Dashboard (LIVE) → Developers → Webhooks → Add endpoint → `https://YOUR_DOMAIN/api/webhooks/stripe`.
2. Subscribe to exactly the events the handler processes:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `charge.refunded`, `charge.dispute.created`, `account.updated`.
3. Copy the endpoint's signing secret (`whsec_…`) → `STRIPE_WEBHOOK_SECRET` in `.env.production.local`.

## 3. Environment variables

All live values live in `apps/web/.env.production.local` (gitignored). Already generated for you:
- `EARND_TOKEN_SIGNING_KEY` (64 chars) and `EARND_ADMIN_TOKEN` (48 chars) — production-strength, keep secret.

Still to fill: `DATABASE_URL`, the three `STRIPE_*` values, `NEXT_PUBLIC_BASE_URL`, `EARND_API_BASE`.
On Vercel, set these via `vercel env add` (or the dashboard) for the **Production** environment —
do not rely on the local file in the deploy.

## 4. Database

Use a **production** Neon branch/database (not the dev branch the test data lives in):

```bash
cd apps/web
DATABASE_URL=<prod-url> pnpm db:migrate    # apply schema; do NOT run db:seed in prod
```

## 5. Deploy

```bash
# from repo root
vercel link            # if not linked
vercel --prod          # or push to the production branch if Git-connected
```

Set `NEXT_PUBLIC_BASE_URL` / `EARND_API_BASE` to the real domain BEFORE building —
Checkout success/cancel URLs and OSC-8 links bake them in.

## 6. Post-deploy verification (live, small real charge)

1. Create an advertiser, POST `/api/checkout` with a small amount, pay with a **real** card.
2. Confirm the Dashboard webhook shows `checkout.session.completed` → 200, and the ledger credits once.
3. Issue a small refund in the Dashboard → confirm `charge.refunded` debits the ledger.
4. (Connect, once enabled) Onboard a test publisher, complete KYC, run `/api/payouts/run`
   with the admin bearer token, confirm a Transfer is created exactly once.

## Loose ends to clean before shipping

- Throwaway helper scripts left in `apps/web/scripts/`: `verify-stripe.mjs`, `refresh-stripe-keys.mjs`,
  `smoke-connect.mjs`. Keep (handy) or delete — they read keys from local files only.
- Branch `security-hardening` has an uncommitted `deleted: README.md` — restore or commit intentionally.
- Kill the local background `next dev` / `stripe listen` when done.
