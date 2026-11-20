import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { clearCoaching, recordCoaching, waitersFor } from "@/lib/server/waiters";

/** Drinks per guest by waiter for the last 7 or 30 days and the outlets in view. Names only for roles that coach. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "money", permission: "waiters.view" });
  if (!g.ok) return g.response;
  const p = req.nextUrl.searchParams;
  const r = waitersFor(g.user, { days: p.get("days"), outlets: p.get("outlets") });
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}

/** Records coaching on a waiter ({ action: "coach" }) or takes a note back ({ action: "clear", id }). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "money", permission: "waiters.coach" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = body.action === "clear" ? clearCoaching(g.user, body) : recordCoaching(g.user, body);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
