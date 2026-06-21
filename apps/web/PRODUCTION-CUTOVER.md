# earnd — Production Cutover Checklist

Status as of the sandbox setup pass. The **code** is production-grade; what remains
is credentials, account activation, and deploy config. Do these in order.

## ✅ Already verified in sandbox (test mode)
- Advertiser top-up happy path: Checkout → signed webhook → ledger credit
  (proven: `checkout.session.completed` → `[200]` → ledger credit, refId = event id).
- Idempotent webhook ledger (dedupe on `event.id`), refund/dispute clawback code.
- Test suite: 18/18 passing (`pnpm test`).

## ⛔ Blocker — Stripe Connect is NOT enabled on the account
The publisher-payout half (`/api/connect`, `/api/payouts/run`, `lib/connect.ts`)
**cannot work until Connect is activated.** Creating a recipient account returns:
`"You must have Connect enabled to use this field."`

1. Dashboard → **Connect** → **Get started** (or https://dashboard.stripe.com/connect/overview).
2. Complete the **platform profile** (business model, "recipient" accounts, payout
   responsibility) and accept the Connect terms. This is a business/legal step — only
   the account owner can do it.
3. After enabling, re-run `node scripts/smoke-connect.mjs` (test mode) — account
   creation + onboarding link should now succeed.
4. A full payout still needs: a connected account with **KYC complete** (transfers
   capability `active`) AND escrow matured past the 30-day hold (`ECONOMICS.escrowHoldDays`).

## Production credentials (fill into `.env.production.local`)
- [ ] **DATABASE_URL** — a prod Neon branch (not the dev branch).
- [ ] **STRIPE_SECRET_KEY** — a **restricted** live key (`rk_live_…`), least-privilege:
      write on Checkout/PaymentIntents/Customers/Transfers, read on Connect accounts.
- [ ] **STRIPE_PUBLISHABLE_KEY** — `pk_live_…`.
- [ ] **STRIPE_WEBHOOK_SECRET** — from the **registered dashboard endpoint** below
      (the `stripe listen` secret is local-only and dies with the CLI).
- [ ] **NEXT_PUBLIC_BASE_URL / EARND_API_BASE** — the real deployed origin.
- [x] **EARND_TOKEN_SIGNING_KEY** — generated, in `.env.production.local`.
- [x] **EARND_ADMIN_TOKEN** — generated, in `.env.production.local`.

## Register the production webhook endpoint
Dashboard → **Developers → Webhooks → Add endpoint** → `https://<domain>/api/webhooks/stripe`.
Subscribe to exactly the events the handler processes:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `charge.refunded`
- `charge.dispute.created`
- `account.updated`

Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.

## Pre-launch verification
- [ ] `pnpm test` green.
- [ ] `pnpm build` clean (prod build, not just dev).
- [ ] `pnpm db:migrate` against the prod DB.
- [ ] Live smoke: a small real top-up → confirm ledger credit; then refund it →
      confirm clawback reversal.
- [ ] Connect: onboard one real publisher, confirm `payoutsEnabled` flips true.

## Housekeeping
- Throwaway diagnostic scripts left in `apps/web/scripts/`
  (`verify-stripe.mjs`, `refresh-stripe-keys.mjs`, `smoke-connect.mjs`) — keep as ops
  tools or delete before commit.
- `README.md` is currently shown deleted on the `security-hardening` branch (pre-existing).
