import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { moveArrival } from "@/lib/server/guest";

/** Move an arrival to another ready room, by an authorised front desk action only. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, {});
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = moveArrival(g.user, String(body.arrivalId ?? ""), body);
  return r.ok ? json({ arrival: r.arrival }) : json({ error: r.error }, r.status);
}
