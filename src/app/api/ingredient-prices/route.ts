import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { ingredientPricesFor } from "@/lib/server/ingredient-prices";

/** Ingredient prices from approved supplier invoices, with the last invoice price, the contract price and any override. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "stock" });
  if (!g.ok) return g.response;
  const r = ingredientPricesFor(g.user, req.nextUrl.searchParams.get("propertyId") ?? "lis");
  if (!r.ok) return json({ error: r.error }, r.status);
  const { ok: _ok, ...out } = r;
  void _ok;
  return json(out);
}
