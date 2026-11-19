import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { countItem, decideStockTake, monthEnd, startStockTake, stockTakeFor, stockTakesFor, submitStockTake } from "@/lib/server/stocktake";
import { cleanEntries } from "@/lib/server/stock";

type R = { ok: true } | { ok: false; status: number; error: string };
const reply = <T extends R>(r: T) => (r.ok ? json(r) : json({ error: (r as { error: string }).error }, (r as { status: number }).status));

/** Stock takes for a hotel; ?id= for one with its variance report; ?month=YYYY-MM for the month-end report. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  const q = req.nextUrl.searchParams;
  if (q.get("id")) return reply(stockTakeFor(g.user, q.get("id")!));
  if (q.get("month")) return reply(monthEnd(g.user, q.get("propertyId") ?? "", q.get("month")!));
  return reply(stockTakesFor(g.user, q.get("propertyId") ?? ""));
}

/** start, count (by item or barcode), submit, and approve or reject. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? "");
  switch (body.action) {
    case "start": return reply(startStockTake(g.user, body, cleanEntries(g.user, body)));
    case "count": return reply(countItem(g.user, id, body));
    case "submit": return reply(submitStockTake(g.user, id));
    case "decide": return reply(decideStockTake(g.user, id, body));
    default: return json({ error: "Unknown action." }, 400);
  }
}
