import { z } from "zod";
import type { ImpressionBeginResponse } from "@earnd/contracts";
import { ECONOMICS } from "@earnd/contracts/config";
import { runAuction } from "@/auction/engine";
import { serverEnv } from "@/env";
import { json } from "@/lib/api";
import { readSignedJson } from "@/lib/deviceAuth";
import { newNonce, signClickToken, signImpressionToken } from "@/lib/tokens";

export const runtime = "nodejs";

const schema = z.object({
  deviceId: z.string().uuid(),
  surface: z.enum(["shell", "tmux", "vim"]),
  width: z.number().int().positive().max(2000),
  clientTime: z.number(),
});

// POST /api/impression/begin — run the auction for this device and issue a
// single-use, signed impression token gating the impression. The request must be
// signed by the device's Ed25519 key (the publisher is derived from the verified
// device, never trusted from the body), so a bare deviceId can't mint tokens.
export async function POST(req: Request) {
  const parsed = await readSignedJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const { deviceId, surface } = parsed.data;
  const now = Date.now();

  // The signing device is authoritative; a body deviceId that disagrees with the
  // signed identity is rejected rather than silently trusting either.
  if (deviceId !== parsed.device.deviceId) {
    return json({ error: "device mismatch" }, { status: 401 });
  }
  const publisherId = parsed.device.publisherId;

  const winner = await runAuction();
  if (!winner) {
    const res: ImpressionBeginResponse = { empty: true, serverTime: now };
    return json(res);
  }

  // Dwell gate = base + per-impression jitter, defeating machine-gun redemption.
  const jitter = Math.floor(Math.random() * (ECONOMICS.impressionDwellJitterMaxSeconds + 1));
  const minDwellSeconds = ECONOMICS.impressionMinDwellSeconds + jitter;
  const nonce = newNonce();

  const impressionToken = signImpressionToken({
    nonce,
    adId: winner.adId,
    advertiserId: winner.advertiserId,
    publisherId,
    deviceId,
    surface,
    clearingCpmMillicents: winner.clearingCpmMillicents,
    chargeMillicents: winner.chargeMillicents,
    minDwellSeconds,
    issuedAt: now,
    expiresAt: now + ECONOMICS.impressionTokenTtlSeconds * 1000,
  });

  const base = serverEnv().NEXT_PUBLIC_BASE_URL;
  const clickToken = signClickToken({ adId: winner.adId });

  const res: ImpressionBeginResponse = {
    creative: {
      adId: winner.adId,
      line: winner.line,
      displayUrl: winner.displayUrl,
      clickUrl: `${base}/r/${clickToken}`,
      icon: winner.icon,
    },
    impressionToken,
    minDwellSeconds,
    serverTime: now,
  };
  return json(res);
}
