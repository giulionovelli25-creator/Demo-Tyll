import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { goodsInFor, handleRisk, recordArrival, reopenRisk } from "@/lib/server/late-delivery";
import { monthPlanFor } from "@/lib/server/purchasing";
import { cleanEntries } from "@/lib/server/stock";

/** Goods in: today's and tomorrow's deliveries, and whether each has been recorded as arrived. */
export async function GET(req: NextRequest) {
  const g = guard(req, { permission: "purchase.receive" });
  if (!g.ok) return g.response;
  const r = goodsInFor(g.user);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}

/**
 * { action: "arrived", key, complete, missing } records an arrival at goods in, now.
 * { action: "handle", propertyId, key, how, note, ingredientId, ...entries } records what was done about a delivery at
 * risk; how "backup" also creates a draft order at the backup supplier, which needs approval and is never sent.
 * { action: "reopen", key } takes a "handled" mark back.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === "arrived") {
    const g = guard(req, { permission: "purchase.receive" });
    if (!g.ok) return g.response;
    const r = recordArrival(g.user, body);
    return r.ok ? json(r) : json({ error: r.error }, r.status);
  }
  const g = guard(req, { permission: "deliveries.handle" });
  if (!g.ok) return g.response;
  if (body.action === "reopen") {
    const r = reopenRisk(g.user, body);
    return r.ok ? json(r) : json({ error: r.error }, r.status);
  }
  if (body.action !== "handle") return json({ error: "Unknown action." }, 400);
  const propertyId = String(body.propertyId ?? "");
  const plan = monthPlanFor(g.user, propertyId, cleanEntries(g.user, body));
  if (!plan.ok) return json({ error: plan.error }, plan.status);
  const r = handleRisk(g.user, propertyId, body, plan.plan.items);
  return r.ok ? json(r) : json({ error: r.error }, r.status);
}
