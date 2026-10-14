import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { ordersOnDate, ordersWithItem, searchOrders } from "@/lib/server/snapshot";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Order lists: one business date, orders containing a menu item, or an order-number search. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "money" });
  const p = req.nextUrl.searchParams;
  if (!g.ok) {
    // Menu item pages and search are part of the Overview, which managers can open without Money.
    const alt = guard(req, { module: "overview" });
    if (!alt.ok || p.get("date")) return g.response;
    return respond(alt.user, p);
  }
  return respond(g.user, p);
}

function respond(user: Parameters<typeof ordersOnDate>[0], p: URLSearchParams) {
  const date = p.get("date");
  if (date) return ISO.test(date) ? json({ orders: ordersOnDate(user, date) }) : json({ error: "Bad date." }, 400);
  const item = p.get("item");
  if (item) {
    const from = p.get("from") ?? "";
    const to = p.get("to") ?? "";
    if (!ISO.test(from) || !ISO.test(to)) return json({ error: "Bad range." }, 400);
    return json({ rows: ordersWithItem(user, item, from, to, (p.get("outlets") ?? "").split(",").filter(Boolean)) });
  }
  const q = p.get("q");
  if (q) return json({ hits: searchOrders(user, q.slice(0, 40)) });
  return json({ error: "Say which orders." }, 400);
}
