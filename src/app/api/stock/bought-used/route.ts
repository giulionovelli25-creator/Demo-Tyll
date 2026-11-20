import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { boughtUsedFor, clearCheck, confirmCheck, markChecked } from "@/lib/server/bought-used";

/** Bought against used for one hotel over the last 30 days. Whole hotel access only. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "stock", permission: "stock.boughtUsed" });
  if (!g.ok) return g.response;
  const r = boughtUsedFor(g.user, req.nextUrl.searchParams.get("propertyId"));
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}

/**
 * Marks an item's gap as checked ({ action: "check" }), confirms a check that waits for a manager ({ action: "confirm",
 * id }) or takes a check back ({ action: "clear", id }). Permissions are checked again in each function.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "stock", permission: "stock.boughtUsed" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = body.action === "clear" ? clearCheck(g.user, body) : body.action === "confirm" ? confirmCheck(g.user, body) : markChecked(g.user, body);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
