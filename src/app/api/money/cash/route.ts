import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { cashFor, recordCashUp } from "@/lib/server/cash";

/** Cash counted per outlet and shift against the till's cash sales. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "money" });
  if (!g.ok) return g.response;
  const r = cashFor(g.user, req.nextUrl.searchParams.get("propertyId") ?? "");
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}

/** A manager records a cash-up. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "money" });
  if (!g.ok) return g.response;
  const r = recordCashUp(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
