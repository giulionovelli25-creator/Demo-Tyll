import type { NextRequest } from "next/server";
import { PRICE_BASIS } from "@/lib/server/ingredient-prices";
import { allowedProperties } from "@/lib/domain/access";
import { guard, json, sameOrigin } from "@/lib/server/guard";
import { cleanEntries, stockFor } from "@/lib/server/stock";
import { valuationMethod } from "@/lib/server/procurement";
import { VALUATION_LABEL } from "@/lib/domain/procurement";
import { ensureExpiryStory } from "@/lib/server/expiry";

/** Stock positions worked out on complete data, returned only for stores this user may see. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Request refused." }, 403);
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => ({}))) as { propertyId?: unknown };
  if (typeof body.propertyId !== "string" || !allowedProperties(g.user).includes(body.propertyId)) return json({ error: "This property is outside your access." }, 403);
  ensureExpiryStory(body.propertyId);
  const method = valuationMethod(body.propertyId);
  return json({ rows: stockFor(g.user, body.propertyId, cleanEntries(g.user, body)), valuation: { method, label: method === "wac" ? PRICE_BASIS : VALUATION_LABEL[method] } });
}
