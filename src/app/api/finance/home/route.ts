import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { financeHome } from "@/lib/server/finance";

export async function GET(req: NextRequest) {
  const g = guard(req, { module: "finance" });
  if (!g.ok) return g.response;
  const r = financeHome(g.user, req.nextUrl.searchParams.get("propertyId") ?? undefined);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
