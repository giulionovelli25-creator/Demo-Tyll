// "Meal with no drink" in What Tyll checks: food bills for two or more guests with no drink billed, in the last 7 days.
// Framed as a possible drink sale for the outlet, valued at what guests at that outlet and shift usually spend on drinks
// (an estimate). The list never names the waiter: coaching by person stays on Drinks per guest by waiter, for the
// managers allowed to see the team by name.
import { itemById, outletById } from "../data/catalog";
import { getDataset } from "../data/generate";
import { allowedOutlets, can, canOpen } from "../domain/access";
import { MEAL_NO_DRINK, billFacts, mealWithNoDrink, waiterOutlet, type BillFacts } from "../domain/waiters";
import type { User } from "../types";
import { DEMO_TODAY, addDays, round2 } from "../util";
import type { Result } from "./purchasing";

export interface MealNoDrinkCase { orderId: string; outletId: string; date: string; time: string; table: string; guests: number; food: string[]; foodValue: number; possible: number }
export interface MealNoDrinkOut { from: string; to: string; cases: MealNoDrinkCase[]; total: number; tables: number; foodTables: number }

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function mealsWithNoDrink(user: User, to = DEMO_TODAY): Result<MealNoDrinkOut> {
  if (!canOpen(user, "money") || !(can(user, "waiters.view") || can(user, "till.view") || can(user, "covers.view"))) return { ok: false, status: 403, error: "Your role cannot see this check." };
  const from = addDays(to, -(MEAL_NO_DRINK.days - 1));
  const outlets = new Set(allowedOutlets(user).filter(waiterOutlet));
  const orders = getDataset().orders;
  // What guests spend on drinks at each outlet and shift, over the 28 days before the window: the value of a possible sale.
  const base = new Map<string, { guests: number; drinks: number }>();
  for (const o of orders) {
    if (o.date < addDays(from, -28) || o.date >= from || !outlets.has(o.outletId)) continue;
    const f = billFacts(o);
    if (!f) continue;
    const k = `${f.outletId}|${f.shift}`;
    const b = base.get(k) ?? { guests: 0, drinks: 0 };
    b.guests += f.guests; b.drinks += f.drinkValue;
    base.set(k, b);
  }
  const facts = orders.filter((o) => o.date >= from && o.date <= to && outlets.has(o.outletId)).map(billFacts).filter((f): f is BillFacts => !!f);
  const cases: MealNoDrinkCase[] = facts.filter(mealWithNoDrink).map((f) => {
    const b = base.get(`${f.outletId}|${f.shift}`);
    const perGuest = b && b.guests ? b.drinks / b.guests : 0;
    return { orderId: f.orderId, outletId: f.outletId, date: f.date, time: hhmm(f.openMin), table: f.table, guests: f.guests, food: f.foodItems.map((i) => itemById[i]?.name ?? i), foodValue: f.foodValue, possible: round2(perGuest * f.guests) };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.possible - a.possible);
  return { ok: true, from, to, cases, total: round2(cases.reduce((t, c) => t + c.possible, 0)), tables: cases.length, foodTables: facts.filter((f) => f.food && f.guests >= MEAL_NO_DRINK.minGuests).length };
}

export const outletName = (id: string) => outletById[id]?.name ?? id;
