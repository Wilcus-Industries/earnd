/**
 * Server-authoritative tokens. The banner client never reports impression counts;
 * it can only redeem a single-use, HMAC-signed token the server issued. Tokens are
 * `base64url(payload).base64url(hmac)`. The nonce makes each token single-use (the
 * impressions table has a unique constraint on it), and `expiresAt` bounds replay.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/env";
import type { Surface } from "@earnd/contracts";

function signingKey(): Buffer {
  return Buffer.from(serverEnv().EARND_TOKEN_SIGNING_KEY);
}

function sign(body: string): string {
  return createHmac("sha256", signingKey()).update(body).digest("base64url");
}

function pack<T>(payload: T): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function unpack<T>(token: string): T | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = Buffer.from(sign(body), "base64url");
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
  return pack(p);
}

export function verifyImpressionToken(token: string): ImpressionTokenPayload | null {
  const p = unpack<ImpressionTokenPayload>(token);
  if (!p) return null;
  if (typeof p.expiresAt !== "number" || Date.now() > p.expiresAt) return null;
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
  return pack<ClickTokenPayload>({
    adId: p.adId,
    impressionId: p.impressionId,
    seed: randomBytes(8).toString("hex"),
    issuedAt: now,
    expiresAt: now + (p.ttlMs ?? 1000 * 60 * 60 * 24 * 7), // 7 days
  });
}

export function verifyClickToken(token: string): ClickTokenPayload | null {
  const p = unpack<ClickTokenPayload>(token);
  if (!p) return null;
  if (typeof p.expiresAt !== "number" || Date.now() > p.expiresAt) return null;
  return p;
}
