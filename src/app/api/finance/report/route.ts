import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { financeReport } from "@/lib/server/finance";

export async function GET(req: NextRequest) {
  const g = guard(req, { module: "finance" });
  if (!g.ok) return g.response;
  const q = req.nextUrl.searchParams;
  const r = financeReport(g.user, { propertyId: q.get("propertyId") ?? undefined, period: q.get("period") ?? undefined, dept: q.get("dept") ?? undefined, category: q.get("category") ?? undefined });
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
