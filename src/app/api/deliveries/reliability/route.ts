import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { reliabilityFor } from "@/lib/server/late-delivery";

/** Supplier reliability: on time rate, delay, weekday pattern and confidence, over 4 or 12 weeks. */
export async function GET(req: NextRequest) {
  const g = guard(req, { permission: "deliveries.view" });
  if (!g.ok) return g.response;
  const p = req.nextUrl.searchParams;
  const r = reliabilityFor(g.user, p.get("propertyId") ?? "", Number(p.get("weeks") ?? 12));
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
