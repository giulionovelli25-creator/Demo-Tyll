import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { buildMonthOrder, monthPlanFor } from "@/lib/server/purchasing";
import { cleanEntries } from "@/lib/server/stock";

/** The Stock page's plan to month end. action "build" also creates or updates a draft purchase order. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const entries = cleanEntries(g.user, body);
  const propertyId = String(body.propertyId ?? "");
  if (body.action === "build") {
    const r = buildMonthOrder(g.user, propertyId, entries);
    return r.ok ? json({ request: r.request, lines: r.lines, total: r.total }) : json({ error: r.error }, r.status);
  }
  const r = monthPlanFor(g.user, propertyId, entries);
  return r.ok ? json({ plan: r.plan }) : json({ error: r.error }, r.status);
}
