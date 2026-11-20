import type { NextRequest } from "next/server";
import { guard, json } from "@/lib/server/guard";
import { mealsWithNoDrink } from "@/lib/server/meal-no-drink";

/** Meal with no drink: food bills for two or more guests with no drink billed, last 7 days. No waiter is named. */
export async function GET(req: NextRequest) {
  const g = guard(req, { module: "money" });
  if (!g.ok) return g.response;
  const r = mealsWithNoDrink(g.user);
  if (!r.ok) return json({ error: r.error }, r.status);
  const { ok: _ok, ...out } = r;
  void _ok;
  return json(out);
}
