import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { salesFor, saveOpp } from "@/lib/server/sales";

export async function GET(req: NextRequest) {
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  const r = salesFor(g.user, req.nextUrl.searchParams.get("propertyId") ?? undefined);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}

/** Create or change an opportunity. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "events" });
  if (!g.ok) return g.response;
  const r = saveOpp(g.user, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return r.ok ? json({ opp: r.opp }) : json({ error: r.error }, r.status);
}
