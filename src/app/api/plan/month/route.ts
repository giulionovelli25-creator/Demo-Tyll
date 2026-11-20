import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { buildMonthOrder, monthPlanFor, orderNow } from "@/lib/server/purchasing";
import { cleanEntries } from "@/lib/server/stock";
import { ensureAutoRun } from "@/lib/server/auto-order";
import { allowedProperties } from "@/lib/domain/access";
import { ensureDeliveryStory, warnFromPlan } from "@/lib/server/late-delivery";

/** The Stock page's plan to month end. action "build" also creates or updates a draft purchase order. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const entries = cleanEntries(g.user, body);
  const propertyId = String(body.propertyId ?? "");
  // This morning's automatic orders come first, so every page shows the plan after them.
  if (allowedProperties(g.user).includes(propertyId)) ensureAutoRun(propertyId, entries);
  if (body.action === "build") {
    // Quantities the manager changed on the Predictions page. Anything that is not a sensible number is ignored.
    const raw = body.quantities && typeof body.quantities === "object" ? (body.quantities as Record<string, unknown>) : {};
    const quantities = Object.fromEntries(Object.entries(raw).filter(([k, v]) => typeof k === "string" && k.length < 64 && typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100000).slice(0, 500)) as Record<string, number>;
    const r = buildMonthOrder(g.user, propertyId, entries, quantities);
    return r.ok ? json({ request: r.request, lines: r.lines, total: r.total }) : json({ error: r.error }, r.status);
  }
  if (body.action === "order-now" || body.action === "order-now-preview") {
    const ingredientId = typeof body.ingredientId === "string" ? body.ingredientId.slice(0, 64) : "";
    const r = orderNow(g.user, propertyId, ingredientId, entries, { preview: body.action === "order-now-preview" });
    if (!r.ok) return json({ error: r.error }, r.status);
    const { ok: _ok, ...out } = r;
    void _ok;
    return json(out);
  }
  ensureDeliveryStory();
  const r = monthPlanFor(g.user, propertyId, entries);
  // Deliveries likely to be late that would leave a service short: the bell and a prepared email, once per phase.
  if (r.ok) warnFromPlan(propertyId, r.plan.items);
  return r.ok ? json({ plan: r.plan }) : json({ error: r.error }, r.status);
}
