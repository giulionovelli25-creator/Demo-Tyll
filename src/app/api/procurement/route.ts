import type { NextRequest } from "next/server";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import {
  createPurchaseOrders, parsFor, priceHistoryFor, purchasingSettingsFor, saveCatalogueLine, savePar, savePurchasingSettings, saveSupplier, suppliersFor, toOrderFor, procurementOf,
} from "@/lib/server/procurement";
import { cleanEntries } from "@/lib/server/stock";
import { allowedProperties, can } from "@/lib/domain/access";

type R = { ok: true } | { ok: false; status: number; error: string };
const reply = <T extends R>(r: T) => (r.ok ? json(r) : json({ error: (r as { error: string }).error }, (r as { status: number }).status));

/** Purchasing master data and To order. One route, by action; every action checks role and hotel itself. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Par levels belong to stock as much as to purchasing, so stock managers reach them too.
  const g = body.action === "pars" || body.action === "par" ? guard(req, { module: "stock" }) : guard(req, { module: "forecast" });
  if (!g.ok) return g.response;
  const propertyId = String(body.propertyId ?? "");
  if (!allowedProperties(g.user).includes(propertyId)) return json({ error: "This hotel is outside your access." }, 403);
  const entries = () => cleanEntries(g.user, body);
  switch (body.action) {
    case "suppliers": return reply(suppliersFor(g.user, propertyId));
    case "supplier": return reply(saveSupplier(g.user, propertyId, body));
    case "catalogue": return reply(saveCatalogueLine(g.user, propertyId, body));
    case "pars": return reply(parsFor(g.user, propertyId, entries()));
    case "par": return reply(savePar(g.user, propertyId, body, entries()));
    case "to_order": return reply(toOrderFor(g.user, propertyId, entries()));
    case "create_pos": return reply(createPurchaseOrders(g.user, propertyId, body.lines, { source: body.source === "prediction" ? "prediction" : body.source === "par" ? "par" : "manual", notes: typeof body.notes === "string" ? body.notes : undefined }));
    case "prices": return reply(priceHistoryFor(g.user, propertyId, typeof body.ingredientId === "string" ? body.ingredientId : undefined));
    case "settings": return reply(purchasingSettingsFor(g.user, propertyId));
    case "save_settings": return reply(savePurchasingSettings(g.user, propertyId, body));
    case "outbox": {
      if (!can(g.user, "purchase.review") && !can(g.user, "purchase.approveFnb") && !can(g.user, "purchase.approveManager")) return json({ error: "Your role cannot see emails to suppliers." }, 403);
      return json({ emails: procurementOf().outbox.filter((e) => e.propertyId === propertyId).slice().reverse() });
    }
    default: return json({ error: "Unknown action." }, 400);
  }
}
