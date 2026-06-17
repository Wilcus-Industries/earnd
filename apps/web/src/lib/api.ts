import { NextResponse } from "next/server";
import type { z } from "zod";

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Parse + validate a JSON body against a Zod schema. Returns the data or a 400. */
export async function readJson<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, res: badRequest("invalid JSON body") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, res: badRequest(parsed.error.issues.map((i) => i.message).join("; ")) };
  }
  return { ok: true, data: parsed.data };
}
