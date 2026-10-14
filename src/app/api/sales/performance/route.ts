import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { salesPerformance } from "@/lib/server/sales";

export async function GET(req: NextRequest) {
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  const r = salesPerformance(g.user, req.nextUrl.searchParams.get("propertyId") ?? "");
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
