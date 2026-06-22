/**
 * Server-authoritative tokens. The banner client never reports impression counts;
 * it can only redeem a single-use, HMAC-signed token the server issued. Tokens are
 * `base64url(payload).base64url(hmac)`. The nonce makes each token single-use (the
 * impressions table has a unique constraint on it), and `expiresAt` bounds replay.
 *
 * DOMAIN SEPARATION: every token kind signs under a distinct context string folded
 * into the HMAC input. An impression token and a click token therefore produce
 * different signatures over the same body, so a token minted for one purpose can
 * NEVER verify as the other — even though both share one signing key and wire
 * format. Without this, a click token (handed to clients in plaintext) is one
 * payload-shape change away from being replayable as a billing-capable impression
 * token (CWE-345 / confused-deputy). The context is part of the signed bytes, not
 * the payload, so it can't be forged by editing the body.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/env";
import type { Surface } from "@earnd/contracts";

/** Per-kind signing contexts. Changing a value invalidates that kind's live tokens. */
const CONTEXT = {
  impression: "earnd.impression.v1",
  click: "earnd.click.v1",
} as const;
type TokenContext = (typeof CONTEXT)[keyof typeof CONTEXT];

function signingKey(): Buffer {
  return Buffer.from(serverEnv().EARND_TOKEN_SIGNING_KEY);
}

// The context is prefixed into the HMAC input (NOT the body), so the same payload
// signed under two contexts yields two non-interchangeable signatures.
function sign(context: TokenContext, body: string): string {
  return createHmac("sha256", signingKey()).update(`${context}.${body}`).digest("base64url");
}

function pack<T>(context: TokenContext, payload: T): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(context, body)}`;
}

function unpack<T>(context: TokenContext, token: string): T | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = Buffer.from(sign(context, body), "base64url");
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

// ── impression tokens ───────────────────────────────────────────────
export interface ImpressionTokenPayload {
  nonce: string;
  adId: string;
  advertiserId: string;
  publisherId: string;
  deviceId: string;
  surface: Surface;
  clearingCpmMillicents: number;
  chargeMillicents: number;
  minDwellSeconds: number;
  issuedAt: number; // unix ms
  expiresAt: number; // unix ms
}

export function signImpressionToken(p: ImpressionTokenPayload): string {
  return pack(CONTEXT.impression, p);
}

export function verifyImpressionToken(token: string): ImpressionTokenPayload | null {
  const p = unpack<ImpressionTokenPayload>(CONTEXT.impression, token);
  if (!p) return null;
  if (typeof p.expiresAt !== "number" || Date.now() > p.expiresAt) return null;
  // Defence-in-depth alongside domain separation: the billing-critical fields a
  // redeem will act on must actually be present and well-typed, so nothing that
  // merely shares the wire format can slip through as a zero-value impression.
  if (typeof p.issuedAt !== "number" || typeof p.deviceId !== "string" || !p.deviceId) return null;
  return p;
}

// ── click tokens (attribution only; not billed in v1) ───────────────
export interface ClickTokenPayload {
  adId: string;
  impressionId?: string;
  /** Randomness so two clicks on the same impression dedupe distinctly when intended. */
  seed: string;
  issuedAt: number;
  expiresAt: number;
}

export function signClickToken(p: Omit<ClickTokenPayload, "seed" | "issuedAt" | "expiresAt"> & {
  ttlMs?: number;
}): string {
  const now = Date.now();
  return pack<ClickTokenPayload>(CONTEXT.click, {
    adId: p.adId,
    impressionId: p.impressionId,
    seed: randomBytes(8).toString("hex"),
    issuedAt: now,
    expiresAt: now + (p.ttlMs ?? 1000 * 60 * 60 * 24 * 7), // 7 days
  });
}

export function verifyClickToken(token: string): ClickTokenPayload | null {
  const p = unpack<ClickTokenPayload>(CONTEXT.click, token);
  if (!p) return null;
  if (typeof p.expiresAt !== "number" || Date.now() > p.expiresAt) return null;
  return p;
}
