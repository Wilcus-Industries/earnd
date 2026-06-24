# CLAUDE.md

Guidance for working in this repo. Read before making changes.

## What earnd is

A **terminal ad network**. Inventory = developer attention during idle terminal time. A single-line ad banner is pinned to the top row (row 1) of the terminal via scroll-region margins. Advertisers bid CPM for that row; the developer running the banner earns 50% of the revenue their machine generates.

Design guarantee: **bounded, detectable, reversible-before-payout** anti-fraud. The server is the *sole* counter of impressions, using device-signed (Ed25519) single-use tokens. 30-day escrow hold + clawback on refund/dispute + KYC at the $25 payout threshold protect advertisers. Invalid-traffic rate is published on `/market` for transparency.

Two invariants worth memorizing:
- **All money is integer millicents** (1/1000 of a cent). `1 USD = 100_000 millicents`. Never use floats for money.
- **The append-only Postgres ledger is the single source of truth** for every balance. Balances are `SUM(credits) - SUM(debits)`, never a cached column.

## Repo layout

Monorepo. Two ecosystems: a pnpm/Turbo Node workspace, and a standalone Go module (NOT in the pnpm workspace).

```
apps/web/            Next.js 16 app — all web surfaces, auction, ledger, Stripe, APIs
packages/contracts/  Shared TS types + economics constants (@earnd/contracts)
client/              Go terminal banner client (separate go.mod, github.com/earnd/client)
turbo.json           Task orchestration
pnpm-workspace.yaml  Workspaces: apps/*, packages/* (Go client excluded)
.env.example         Template; copy to apps/web/.env.local
.vercel/             Vercel deploy config
```

## Commands

Run from repo root unless noted. Package manager is **pnpm 11.5.2**; orchestrated by **Turbo**.

```bash
pnpm install
cp .env.example apps/web/.env.local   # fill secrets before running

pnpm dev            # turbo run dev — Next.js on :3000 (+ contracts)
pnpm build          # turbo run build
pnpm lint           # eslint (web)
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run (web)

pnpm db:push        # drizzle-kit push (sync schema to DB — dev workflow)
pnpm db:generate    # generate migration from schema
pnpm db:migrate     # apply migrations
pnpm db:studio      # Drizzle Studio UI
pnpm --filter web db:seed   # seed demo advertisers

pnpm stripe:listen  # forward Stripe webhooks to localhost:3000/api/webhooks/stripe
```

Go client (separate toolchain, Go 1.26, zero external deps):

```bash
cd client
CGO_ENABLED=0 go build -o bin/earnd ./cmd/earnd
go test ./...
./install.sh --api-base <URL> --shell zsh   # build + shell shim + device register
```

## Web app (`apps/web`)

Next.js 16.2.9, App Router, React 19.2.4, TypeScript 5 (strict, ES2022). Key deps: `better-auth` (auth), `drizzle-orm` + `postgres` (DB), `stripe`, `swr` (client polling), `uplot` (charts), `frimousse` (emoji picker), `zod`.

### App Router pages (`src/app`)
- `/` — landing, live banner demo
- `/market` — public market board: leaderboard + clearing-price chart + IVT rate. Server-rendered then SWR-polled.
- `/sign-in` — email+password (better-auth); `?redirect=<path>` honored
- `/advertiser` — advertiser portal (ads, moderation status, views, spend). Cookie-gated in middleware.
- `/bid` — `BidForm`: creative editor + bid/budget; posts `/api/bids` then `/api/checkout`
- `/publisher` — install instructions
- `/publisher/[id]` — earnings dashboard, token-gated by `dashboardToken`; Connect onboarding
- `/admin/moderation` — review queue, gated by `EARND_ADMIN_TOKEN` (held in sessionStorage)
- `/r/[token]` — `route.ts` GET: signed click redirect (https-only target, deduped, 302)
- `/privacy` — data disclosure

### API routes (`src/app/api`)
Money only ever enters via the **Stripe webhook**; impressions are only credited via **redeem**. Both are server-authoritative.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `auth/[...all]` | GET/POST | — | better-auth handler |
| `bids` | POST | session | create advertiser/campaign/ad(pending)/bid. No money. |
| `checkout` | POST | session (owner) | create Stripe Checkout session; ownership mismatch → 404 (anti-enumeration) |
| `advertiser/ads` | GET | session | advertiser's ads + views + spend |
| `market` | GET | public | aggregated, rounded, 30s-delayed read model (anti-sniping), 3s edge cache |
| `impression/begin` | POST | **device-signed** | run auction → creative + signed impression token |
| `impression/heartbeat` | POST | **device-signed** | report dwell; server clamps to wall-clock |
| `impression/redeem` | POST | **device-signed** | ONLY path crediting advertiser/publisher; tx + advisory locks |
| `moderation` | GET/POST | Bearer admin | review queue / approve-reject |
| `devices/register` | POST | rate-limited/IP | bind Ed25519 pubkey → device + publisher; returns dashboardToken |
| `publisher/[id]` | GET | Bearer dashboardToken | earnings + Connect status + payout history |
| `connect` | POST/GET | Bearer dashboardToken | Stripe Connect onboarding / status poll |
| `webhooks/stripe` | POST | Stripe signature | ONLY path crediting advertiser balance; idempotent on event.id |
| `payouts/run` | POST | Bearer admin | cron; mature escrow → Stripe Transfers (maxDuration 300s) |

### Auction engine (`src/auction/engine.ts`)
Bid-weighted second-price (GSP). Filters to active+approved+funded bids, picks winner with P(win) ∝ maxCpm, clears at `max(second-highest, reserve) + $0.01` capped at the winner's own bid, floored at the $1 reserve. Per-impression charge = `clearing_cpm / 1000`. Eligibility checks here are best-effort; **authoritative balance/budget re-check happens at redeem under a transaction lock**.

### Security primitives (`src/lib`)
- `tokens.ts` — HMAC-signed base64url tokens with **domain separation** (impression vs click tokens are cryptographically incompatible). Impression tokens carry nonce (single-use), ids, charge, minDwell, expiry.
- `deviceAuth.ts` / `ed25519.ts` — Ed25519 request signatures over `deviceId\nMETHOD\npath\ntimestampMs\nsha256(body)`. ±5min skew window. Mirrored exactly in the Go client (`client/internal/core/api.go`).
- `dwell.ts` — server-authoritative wall-clock clamp; client can't inflate dwell.
- `antifraud.ts` — hard GIVT ceilings (reject) vs soft SIVT bands (record but charge 0, hold, bump publisher fraud score); 24h windowed publisher hold.
- `sanitize.ts` — strips C0/C1/DEL control bytes, bidi overrides, zero-width chars; https-only URLs; single-emoji icon. Web sanitizes at ingest; the Go client re-sanitizes as last line of defense.
- `ratelimit.ts` — Postgres-backed distributed fixed-window (atomic upsert), per-IP.
- `admin.ts` / `publisherAuth.ts` — constant-time Bearer comparison; **fail closed** (missing `EARND_ADMIN_TOKEN` ⇒ all admin endpoints 401).
- `stripe.ts` — lazy singleton; API version pinned `2026-05-27.dahlia`; detects live mode via key prefix.
- `auth.ts` / `auth-client.ts` / `sessionAuth.ts` — better-auth (Drizzle adapter, email+password, autoSignIn). `getSessionUser()` reads cookie in Server Components/routes; returns null on any error.

### Conventions
- **Lazy secrets**: `src/env.ts` `serverEnv()` parses on first access, never at module-eval, with non-placeholder guards (rejects `change-me` / `REPLACE_ME` / `openssl_rand` defaults). So `next build` and typecheck work without `.env`.
- **CSP**: per-request nonce set in `src/middleware.ts` (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no `unsafe-inline`). Static security headers (HSTS prod-only, X-Frame-Options DENY, etc.) in `next.config.ts`.
- **Idempotency everywhere money moves**: impression nonce, webhook event.id, payout row id.
- **Concurrency**: redeem and payouts run inside transactions with Postgres advisory/row locks (`SELECT … FOR UPDATE`); connection pool uses `prepare: false` to allow interactive transactions.
- `next.config.ts` sets `transpilePackages: ["@earnd/contracts"]` — the contracts package ships raw TS, no build step.

### Tests
Vitest. Co-located `*.test.ts` in `src/lib` (dwell, ed25519, env, sanitize, tokens) plus `src/__tests__/{antifraud,economics}.test.ts`.

## Database (`apps/web/src/db`)
Drizzle ORM over Postgres (Neon). Money columns are `bigint(mode:"number")` millicents.

- `schema.ts` — tables: `advertisers`, `campaigns`, `ads` (moderation: pending|approved|rejected), `bids`, `bidHistory`, `publishers` (fraudScore, dashboardToken), `devices` (Ed25519 publicKey), `impressions` (validation: valid|givt|sivt), `clicks`, **`ledgerEntries`** (append-only double-entry — see below), `payoutAccounts`, `payouts`, `processedWebhookEvents` (idempotency), `rateLimits`, plus better-auth tables (user/session/account/verification).
- `index.ts` — postgres.js + Drizzle singleton, max 10 conns, `prepare:false`.
- `ledger.ts` — `lockAdvertiser`, balance helpers, `postTopup`, `settleImpression` (debits advertiser, credits publisher_escrow 50% + platform_revenue remainder; sub-millicent split decided deterministically by UUID nibble).
- `payouts.ts` — `lockPublisher`, `maturedEscrowMillicents` (30-day cutoff), `postRefundReversal` (keyed by source so refund+dispute don't double-count; may go negative = platform loss, logs ALERT), `postPayout` (keyed by payout intent id).
- `seed.ts` — demo advertisers (Sentry/Neon/Linear), pre-funded + approved.
- Migrations in `apps/web/drizzle/*.sql` (+ `meta/_journal.json`). `0000` initial; `0001` dashboardToken + payout transfer idx; `0002` rateLimits + Connect event-ordering + unique idxs; `0003` better-auth tables.

Ledger accounts: `advertiser_balance`, `publisher_escrow`, `platform_revenue`, `external`. Reasons: `topup`, `impression_charge`, `impression_accrual`, `platform_fee`, `payout`, `refund`, `clawback`.

## Payments / money flow
1. **Top-up**: `/api/checkout` creates Stripe Checkout → user pays → `checkout.session.completed` webhook → `postTopup` credits `advertiser_balance`. Money is credited *only* by the verified webhook, deduped on event.id.
2. **Impression**: client `begin` (auction) → `heartbeat` (dwell) → `redeem`. Redeem verifies signature/expiry/device, clamps dwell, runs antifraud rate checks under locks, then `settleImpression` debits advertiser, accrues 50% to publisher escrow, rest to platform. SIVT impressions are recorded but charge 0.
3. **Refund/dispute**: `charge.refunded` / `charge.dispute.created` webhooks → `postRefundReversal` (separate namespaces).
4. **Connect onboarding**: `/api/connect` creates Stripe v2 **recipient** account (earnd is merchant of record / fees+losses collector), `stripe_transfers` capability, hosted KYC link. `account.updated` (v1) + status polling flip `payoutAccounts.payoutsEnabled`.
5. **Payout**: `/api/payouts/run` (cron, admin) — Phase 1 locks publisher, computes matured escrow (≥$25 threshold, 30-day hold), inserts pending payout + ledger debit; Phase 2 creates Stripe Transfer with `payout:{id}` idempotency key. Escrow stays debited if transfer fails; retried with same key.

Economics constants live in `packages/contracts/src/config.ts` (see below). Scripts: `apps/web/scripts/verify-stripe.mjs` (creds check), `scripts/smoke-connect.mjs` (Connect e2e). Ops docs: `apps/web/PRODUCTION.md`, `apps/web/PRODUCTION-CUTOVER.md`.

## Shared contracts (`packages/contracts`)
`@earnd/contracts`, private, exports `"."` (→ `src/index.ts`) and `"./config"` (→ `src/config.ts`). **Plain TS types, no Zod.**
- `api.ts` — `Surface` (shell|tmux|vim), `Creative`, and request/response types for begin/heartbeat/redeem/market. The client↔server contract.
- `config.ts` — millicent helpers (`dollarsToMillicents`, `formatMillicents`, `impressionChargeMillicents`, `publisherAccrualMillicents`) and the `ECONOMICS` const: min bid $1 CPM, min top-up $20, GSP increment $0.01, publisher share 50% (5000 bps), payout threshold $25, escrow hold 30 days, token TTL 120s, min dwell 5s (+0–3s jitter), GIVT/SIVT rate bands, 24h SIVT hold window.

Change economics here, not in scattered constants — both web and (conceptually) the client depend on these values.

## Go client (`client`)
Module `github.com/earnd/client`, Go 1.26, **zero external deps**. A security-hardened terminal banner.

- `cmd/earnd/main.go` — subcommands: `render` (hot path: draw cached creative on row 1, spawn detached `tick`), `tick` (background state machine: begin/heartbeat/redeem), `register`, `open` (browser → click URL, safety-checked), `on`/`off`, `reset` (release margins on shell EXIT), `clear` (preserve banner), `status`, `version`, and internal `self-update`.
- `internal/core/session.go` — tick lifecycle state machine; rotates impression token before its 120s server TTL (`tokenMaxAgeSeconds=110`); creative cached atomically to `creative.json`. Once online it calls `maybeSpawnUpdate` (auto-update).
- `internal/core/{update,version}.go` — **auto-update**. `version.go` holds `BuildCommit` (injected via `-ldflags -X` at build time). A tick spawns a detached `earnd self-update` at most once per 5 min (throttle in `updates.json`); `SelfUpdate` (under `update.lock`) shallow-fetches `origin/main` into a managed clone (`~/.config/earnd/src`), and if its tip differs from `BuildCommit` resets to it and re-runs `install.sh` (clean reinstall, embedding the new commit). It records a 5-render `⟳ updated` notice shown right-aligned on the banner. Remote URL/branch/install args come from `install.json` (written by install.sh); no-op if `git`/`go` absent. Always on, no opt-out.
- `internal/core/api.go` — HTTP client (TLS 1.2 floor, 8s timeout, 1 MiB response cap). Ed25519-signs requests with the canonical form mirroring `apps/web/src/lib/deviceAuth.ts`. Any non-2xx is an error.
- `internal/core/offline.go` — TCP-connect probe (ping is firewalled), **fail-closed**: unknown connectivity ⇒ treated offline ⇒ banner hides.
- `internal/core/ticklock_{unix,other}.go` — build-tag split: `flock` on unix, `O_EXCL` + stale-mtime steal on Windows. Serializes concurrent prompt ticks; duplicate redeems are harmless (server nonce idempotent).
- `internal/config/config.go` / `update.go` — state under `$XDG_CONFIG_HOME/earnd` (or `~/.config/earnd`): `state.json` (on/off), `creative.json`, `online.flag`, `device.key` (0600), `device.json` (0600), `session.json`, `tick.lock`, plus auto-update state `install.json` (remote + install args), `updates.json` (throttle + render countdown), `update.lock`, and the managed clone `src/`. `SecureBase()` enforces https for non-loopback hosts (plaintext http only for localhost).
- `internal/auth/device.go` — Ed25519 keypair lifecycle, 0600 perm enforcement, identity load/save.
- `internal/render/shell.go` — pins row 1 via DECSTBM scroll margins (`ESC[2;<LINES>r`); **every margin set is paired with a guaranteed reset** on exit/disable or terminals (ConPTY) corrupt. Synchronized output, wcwidth-ish truncation, OSC-8 hyperlink, orange-on-black styling.
- `internal/render/sanitize.go` — last-line-of-defense: strips control/bidi/zero-width (Trojan-Source class), https-only URLs with a dotted hostname.
- `shell/earnd.{bash,zsh,fish}` — prompt hooks redraw the banner each prompt, re-pin on WINCH, release margins on exit, bind Ctrl-G (open) and override `clear`/Ctrl-L (preserve banner).
- `install.sh` — validates API base (refuses plaintext non-loopback, injection-safe), builds static binary, installs shim, adds idempotent managed block to the rc file, registers device.

API base defaults to `http://localhost:3000`; override with `EARND_API_BASE`.

## Environment
Copy `.env.example` → `apps/web/.env.local`. All also declared in `turbo.json` `globalEnv`. Validated lazily in `src/env.ts`.

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon Postgres; include `sslmode=require` |
| `STRIPE_SECRET_KEY` | yes | prefer restricted (`rk_…`) in prod |
| `STRIPE_WEBHOOK_SECRET` | yes | from `stripe listen` (`whsec_…`) |
| `STRIPE_PUBLISHABLE_KEY` | optional | for Checkout |
| `EARND_TOKEN_SIGNING_KEY` | yes | ≥32 chars, non-placeholder; `openssl rand -base64 48` |
| `BETTER_AUTH_SECRET` | yes (runtime) | ≥16 chars; `openssl rand -base64 32` |
| `EARND_ADMIN_TOKEN` | optional | ≥16 chars; **unset ⇒ moderation + payouts fail closed**; `openssl rand -hex 24` |
| `NEXT_PUBLIC_BASE_URL` | yes | Checkout redirects + OSC-8 links |
| `EARND_API_BASE` | optional | client API base / probe host |

## Deployment
Vercel (`.vercel/project.json`). Next.js build; env vars from Vercel project settings (never commit `.env`). `.vercelignore` excludes `node_modules`, `.next`, `.turbo`, Go artifacts. `payouts/run` is meant to be driven by an external cron.
