import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { emptiesFor, logEmpty, undoEmpty } from "@/lib/server/empties";

/** The bottles a person can log as empty, the outlets they can log them at, and their own scans today. */
export async function GET(req: NextRequest) {
  const g = guard(req, { permission: "stock.logEmpty" });
  if (!g.ok) return g.response;
  const r = emptiesFor(g.user);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}

/** Logs one empty bottle ({ outletId, skuId } or { outletId, barcode }), or takes back one of your own scans today ({ action: "undo", id }). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { permission: "stock.logEmpty" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = body.action === "undo" ? undoEmpty(g.user, body) : logEmpty(g.user, body);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
