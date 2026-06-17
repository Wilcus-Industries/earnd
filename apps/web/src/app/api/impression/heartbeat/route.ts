import { z } from "zod";
import type { ImpressionHeartbeatResponse } from "@earnd/contracts";
import { json, readJson } from "@/lib/api";
import { verifyImpressionToken } from "@/lib/tokens";

export const runtime = "nodejs";

const schema = z.object({
  impressionToken: z.string().min(1),
  displayedSeconds: z.number().min(0),
});

// POST /api/impression/heartbeat — the client reports continuous display time
// while the banner is shown. The server decides when the impression is redeemable.
export async function POST(req: Request) {
  const parsed = await readJson(req, schema);
  if (!parsed.ok) return parsed.res;
  const { impressionToken, displayedSeconds } = parsed.data;

  const payload = verifyImpressionToken(impressionToken);
  if (!payload) {
    const res: ImpressionHeartbeatResponse = { ok: false, redeemable: false };
    return json(res);
  }

  const res: ImpressionHeartbeatResponse = {
    ok: true,
    redeemable: displayedSeconds >= payload.minDwellSeconds,
  };
  return json(res);
}
