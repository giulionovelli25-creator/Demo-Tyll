import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { resetDemo } from "@/lib/server/demo";

/** Puts one scenario's demo records back to the seeded start. Owner or general manager, demo mode only. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.confirm !== true) return json({ error: "Confirm the reset first." }, 400);
  const r = resetDemo(g.user, body.scope);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
