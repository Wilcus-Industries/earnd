/**
 * Per-request device authentication for the impression lifecycle.
 *
 * The impression endpoints (`begin`, `heartbeat`, `redeem`) move real money: they
 * issue and redeem billing-capable tokens. Before this layer they accepted only a
 * PUBLIC device UUID with no proof of key possession, so anyone who learned or
 * enumerated a deviceId could mint tokens for a publisher they don't control
 * (CWE-306, missing authentication). The Ed25519 keypair the client already
 * generates at registration was dead weight — its public key is on `devices`, but
 * no signature was ever checked.
 *
 * Each protected request now carries a detached Ed25519 signature over a canonical
 * string binding the device, HTTP method, path, a fresh timestamp, and a hash of
 * the exact request body. The server verifies it against the registered public key:
 *  - Only the holder of the device private key can produce a valid signature, so a
 *    known/guessed deviceId is no longer sufficient — impersonation and enumeration
 *    are closed.
 *  - The timestamp window bounds replay; `redeem` is additionally single-use via the
 *    token nonce, and `heartbeat`/`begin` are side-effect-light, so a stateless
 *    window (no server-side nonce store) is sufficient.
 *  - The body hash binds the signature to this exact payload, so a captured header
 *    set can't be reused to authorize a different request.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { devices } from "@/db/schema";
import { badRequest, json } from "@/lib/api";
import { canonicalRequest, verifyEd25519 } from "@/lib/ed25519";
import type { z } from "zod";

/** Max accepted age (absolute skew) of a request timestamp. Bounds replay. */
const TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthedDevice {
  deviceId: string;
  publisherId: string;
}

type DeviceAuthFailure = { ok: false; status: number; error: string };
type DeviceAuthSuccess = { ok: true; device: AuthedDevice };

/**
 * Authenticate a signed device request given its already-read raw body. The body
 * must be read once by the caller (consuming `req.json()` twice throws), hashed
 * here, and reused for JSON parsing.
 */
export async function authenticateDevice(
  req: Request,
  rawBody: string,
): Promise<DeviceAuthSuccess | DeviceAuthFailure> {
  const deviceId = req.headers.get("x-earnd-device");
  const timestamp = req.headers.get("x-earnd-timestamp");
  const signature = req.headers.get("x-earnd-signature");
  if (!deviceId || !timestamp || !signature) {
    return { ok: false, status: 401, error: "missing device signature" };
  }
  if (!UUID_RE.test(deviceId)) {
    return { ok: false, status: 401, error: "malformed device id" };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_SKEW_MS) {
    return { ok: false, status: 401, error: "stale or invalid timestamp" };
  }

  const [device] = await getDb()
    .select({ id: devices.id, publisherId: devices.publisherId, publicKey: devices.publicKey })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (!device) {
    return { ok: false, status: 404, error: "unknown device" };
  }

  const path = new URL(req.url).pathname;
  const message = canonicalRequest(deviceId, req.method, path, timestamp, rawBody);
  if (!verifyEd25519(device.publicKey, message, signature)) {
    return { ok: false, status: 401, error: "bad device signature" };
  }
  return { ok: true, device: { deviceId: device.id, publisherId: device.publisherId } };
}

type SignedJsonResult<S extends z.ZodTypeAny> =
  | { ok: true; data: z.infer<S>; device: AuthedDevice }
  | { ok: false; res: ReturnType<typeof json> };

/**
 * Read a device-signed JSON request: verify the Ed25519 signature over the raw
 * body, then validate the body against a Zod schema. One-stop replacement for
 * `readJson` on the money-moving impression endpoints.
 */
export async function readSignedJson<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<SignedJsonResult<S>> {
  const raw = await req.text();
  const auth = await authenticateDevice(req, raw);
  if (!auth.ok) {
    return { ok: false, res: json({ error: auth.error }, { status: auth.status }) };
  }
  let body: unknown;
  try {
    body = raw.length ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, res: badRequest("invalid JSON body") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, res: badRequest(parsed.error.issues.map((i) => i.message).join("; ")) };
  }
  return { ok: true, data: parsed.data, device: auth.device };
}
