import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalRequest, publicKeyFromRawB64, verifyEd25519 } from "@/lib/ed25519";

/** Sign a message with a Node Ed25519 private key, returning base64 std (as Go does). */
function signB64(privateKey: Parameters<typeof edSign>[2], message: string): string {
  return edSign(null, Buffer.from(message, "utf8"), privateKey).toString("base64");
}

/** Export a Node public key down to the bare 32-byte base64 the client registers. */
function rawPubB64(publicKey: import("node:crypto").KeyObject): string {
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return der.subarray(der.length - 32).toString("base64");
}

describe("Ed25519 request signatures", () => {
  it("verifies a signature it just produced and rejects tampering", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = rawPubB64(publicKey);
    const msg = canonicalRequest(
      "11111111-2222-4333-8444-555555555555",
      "POST",
      "/api/impression/redeem",
      "1750000000000",
      '{"impressionToken":"tok","displayedSeconds":7}',
    );
    const sig = signB64(privateKey, msg);
    expect(verifyEd25519(pub, msg, sig)).toBe(true);
    // Any change to the signed message invalidates it (e.g. a swapped body).
    expect(verifyEd25519(pub, msg + "x", sig)).toBe(false);
  });

  it("rejects a valid signature from a different key (no impersonation)", () => {
    const a = generateKeyPairSync("ed25519");
    const b = generateKeyPairSync("ed25519");
    const msg = canonicalRequest("d", "POST", "/api/impression/begin", "1750000000000", "{}");
    const sig = signB64(a.privateKey, msg);
    expect(verifyEd25519(rawPubB64(b.publicKey), msg, sig)).toBe(false);
  });

  it("rejects malformed keys/signatures without throwing", () => {
    expect(publicKeyFromRawB64("not-32-bytes")).toBeNull();
    expect(verifyEd25519("short", "msg", "sig")).toBe(false);
  });

  // Cross-implementation conformance: this vector was produced by the Go client's
  // exact signer (crypto/ed25519 over the same canonical string). If the TS server
  // can verify it, the two implementations are byte-for-byte interoperable. A change
  // to either canonical-string construction breaks this test.
  it("verifies a signature produced by the Go client (cross-impl vector)", () => {
    const PUB = "ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ=";
    const SIG =
      "C35n9QfmFIy68TI+gWrzhk4pu/xnJgbkCkzyu8TU4RkjL4abhIE2fdrIoh3SyQrLcNwOYulZZDXFy5swl5dtCg==";
    const msg = canonicalRequest(
      "11111111-2222-4333-8444-555555555555",
      "POST",
      "/api/impression/redeem",
      "1750000000000",
      '{"impressionToken":"tok","displayedSeconds":7}',
    );
    expect(verifyEd25519(PUB, msg, SIG)).toBe(true);
  });
});
