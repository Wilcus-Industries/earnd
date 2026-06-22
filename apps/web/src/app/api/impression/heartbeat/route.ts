import { z } from "zod";
import type { ImpressionHeartbeatResponse } from "@earnd/contracts";
import { json } from "@/lib/api";
import { readSignedJson } from "@/lib/deviceAuth";
import { effectiveDwellSeconds } from "@/lib/dwell";
import { verifyImpressionToken } from "@/lib/tokens";

export const runtime = "nodejs";

const schema = z.object({
  impressionToken: z.string().min(1),
  displayedSeconds: z.number().min(0),
});

// POST /api/impression/heartbeat — the client reports continuous display time
// while the banner is shown. The server decides when the impression is redeemable,
// using the same wall-clock-capped dwell as redeem so the client can't be told it's
// redeemable before real time has elapsed. Signed by the device key.
export async function POST(req: Request) {
  const parsed = await readSignedJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const { impressionToken, displayedSeconds } = parsed.data;

  const payload = verifyImpressionToken(impressionToken);
  if (!payload || parsed.device.deviceId !== payload.deviceId) {
    const res: ImpressionHeartbeatResponse = { ok: false, redeemable: false };
    return json(res);
  }

  const effectiveDwell = effectiveDwellSeconds(payload.issuedAt, Date.now(), displayedSeconds);
  const res: ImpressionHeartbeatResponse = {
    ok: true,
    redeemable: effectiveDwell >= payload.minDwellSeconds,
  };
  return json(res);
}
