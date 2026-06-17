# earnd

A terminal ad network. The inventory is developer attention during idle terminal time:
a one-line ad banner pinned to the **top row** of the terminal. Advertisers bid (CPM) for
that space; the developer running the banner earns **50%** of the revenue their machine
generates. Named after the unix daemon convention (`sshd`, `cupsd`, … `earnd`).

> Full design + decisions: `~/.claude/plans/what-is-it-glimmering-wilkes.md`

## Monorepo layout

```
earnd/
├── apps/web/             Next.js (App Router) — site, bid form, market page, all API routes
├── client/              Go banner client — core ("brain") + pluggable surface adapters ("skins")
└── packages/contracts/   shared TS types + the economics config (single source of truth)
```

The **core/surface split** in `client/` is deliberate: the shell surface ships in v1;
tmux and vim/neovim surfaces are additive later (and reclaim the inventory the shell
banner can't show during full-screen apps).

## Prerequisites

- Node 20+ and `pnpm`
- Go 1.26+ (banner client)
- A Neon Postgres database (transactional ledger)
- Stripe CLI + a Stripe **test-mode** account

## Setup

```bash
pnpm install
cp .env.example apps/web/.env.local   # fill in DATABASE_URL, Stripe test keys, signing key
pnpm db:push                          # apply the Drizzle schema to your Neon dev branch
```

## Develop

```bash
pnpm dev                              # Next.js dev server on :3000
pnpm stripe:listen                    # forward Stripe webhooks to /api/webhooks/stripe

# banner client
go -C client build -o bin/earnd ./cmd/earnd
source client/shell/earnd.zsh         # or earnd.bash / earnd.fish
```

## Money is exact

All balances and prices are integer **millicents** (1/1000 of a cent) to stay exact under
sub-cent CPM math. The append-only ledger in Postgres is the single source of truth for
balances and escrow — never a cached column. See `packages/contracts/src/config.ts`.

## Routes & flows

Public:
- `/` landing (the page's own top row is a live earnd banner — the product demoing itself)
- `/bid` advertiser flow: creative + bid + budget → `POST /api/bids` (sanitizes, creates a
  `pending` ad) → `POST /api/checkout` → Stripe Checkout. Live row-1 preview as you type.
- `/market` aggregated, rounded, delayed bid market (uPlot step lines + leaderboard +
  residual IVT rate)
- `/publisher` install + earn; `/publisher/<id>` device-keyed earnings dashboard + Stripe
  Connect onboarding + payout history
- `/privacy` the full telemetry disclosure (device id, OS, surface, dwell — never command
  contents or keystrokes)

Admin (gated by `EARND_ADMIN_TOKEN`, Bearer; **fails closed** when unset):
- `/admin/moderation` review queue → `GET/POST /api/moderation`
- `POST /api/payouts/run` settle matured escrow via Connect Transfers (intended for a cron)

Money/integrity APIs: `/api/checkout`, `/api/webhooks/stripe`, `/api/impression/{begin,
heartbeat,redeem}`, `/api/connect`, `/r/<token>` signed click redirect.

## Impression integrity & anti-fraud

The client runs on adversary-controlled hardware, so the guarantee is *bounded, detectable,
reversible-before-payout* — not bypass-proof:
- **Server is sole counter** — single-use device-signed tokens; replay-proof via nonce.
- **Dwell gate** — `min_dwell + jitter` before a redeem is accepted.
- **Two-tier rate** — a hard physical ceiling rejects (GIVT); a soft band records-but-holds
  (SIVT, unbilled) and raises the publisher's fraud score. Only **validated** impressions
  bill the advertiser and accrue the 50% share. The residual IVT rate is published on
  `/market` (IAB/MRC-style transparency).
- **Financial bound** — 30-day escrow hold, clawback on refund/dispute, KYC at the $25
  payout threshold. Earnings are uncapped but settle only after maturing.

## Verify end-to-end (Stripe test mode)

1. `pnpm dev` + `pnpm stripe:listen` + `pnpm db:push`; seed demo advertisers with
   `pnpm --filter web db:seed`.
2. **Advertiser**: `/bid` → fund with card `4242 4242 4242 4242` → confirm only the
   `checkout.session.completed` **webhook** credits the ledger (not the client).
3. **Moderate**: set `EARND_ADMIN_TOKEN`, open `/admin/moderation`, approve the creative.
4. **Client**: build + `source` a shell shim → banner on row 1, output scrolls beneath;
   kill network → banner hides; `earnd off` → gone + margins reset; open `vim` → hidden,
   returns next prompt.
5. **Integrity**: after ≥5s dwell a redeem records **one** impression, debits the advertiser
   (GSP price, millicents), accrues 50% to escrow. A replayed token is rejected; machine-gun
   redeem is rate-rejected.
6. **Payout**: `earnd status` prints the dashboard URL → onboard via Connect (test) → after
   the escrow window, `POST /api/payouts/run` issues a Transfer. A `charge.refunded` reverses
   the advertiser balance.

## Safety notes

- The banner is **server-authoritative**: the client redeems single-use signed tokens; it
  never self-reports impression counts.
- Every terminal scroll-region change is paired with a guaranteed reset on shell exit —
  Windows Terminal/ConPTY does not auto-reset and would otherwise be left corrupted.
- Creative bytes are sanitized at the trust boundary (strip control/escape/bidi bytes,
  https-only URLs via the signed redirect) before they can reach a terminal.
- Admin surfaces and payouts **fail closed** without `EARND_ADMIN_TOKEN`.
- Never commit secrets. `.env*` is gitignored except `.env.example`.
