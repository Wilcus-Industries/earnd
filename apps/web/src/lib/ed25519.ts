/**
 * Pure Ed25519 request-signature primitives, with no DB/framework dependencies so
 * they're unit-testable in isolation (and conformance-tested against the Go client's
 * signer). Used by deviceAuth.ts to authenticate impression-lifecycle requests.
 */
import { createHash, createPublicKey, verify as edVerify, type KeyObject } from "node:crypto";

// DER prefix for an Ed25519 SubjectPublicKeyInfo wrapping a raw 32-byte key. Node's
// createPublicKey needs SPKI; the client stores the bare 32-byte key (base64 std).
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function publicKeyFromRawB64(b64: string): KeyObject | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  if (raw.length !== 32) return null;
  try {
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    });
  } catch {
    return null;
  }
}

/**
 * Canonical signed string. MUST be byte-for-byte identical to what the Go client
 * signs (see client/internal/core/api.go `signRequest`): deviceId, method, path,
 * timestamp, and the hex SHA-256 of the raw body, newline-separated.
 */
export function canonicalRequest(
  deviceId: string,
  method: string,
  path: string,
  timestamp: string,
  rawBody: string,
): string {
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  return `${deviceId}\n${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}

/** Verify a base64 Ed25519 signature over `message` against a base64 raw public key. */
export function verifyEd25519(publicKeyB64: string, message: string, signatureB64: string): boolean {
  const key = publicKeyFromRawB64(publicKeyB64);
  if (!key) return false;
  let sig: Buffer;
  try {
    sig = Buffer.from(signatureB64, "base64");
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    return edVerify(null, Buffer.from(message, "utf8"), key, sig);
  } catch {
    return false;
  }
}
