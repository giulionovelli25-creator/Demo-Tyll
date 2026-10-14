// Demand forecast and purchasing suggestions.
// The method is plain arithmetic on past sales. No statistical or machine-learning model has been trained.
import { INGREDIENTS, MENU_ITEMS, itemById, outletById, outletsOfProperty, propertyById } from "../data/catalog";
import type { Dataset } from "../data/generate";
import type { DayItem } from "../types";
import { DEMO_TODAY, addDays, eachDay, sum } from "../util";
import { orderPack, stockPosition, type StockInputs } from "./inventory";
import { ingredientCostAt, type PriceOverrides } from "./pricing";

export const HORIZON_DAYS = 7;

/** How strongly each kind of outlet follows hotel occupancy. Demo assumptions, stated on screen. */
export const OCCUPANCY_ELASTICITY: Record<string, number> = {
  "In-room dining": 0.9, "Pool bar": 0.8, "Lobby lounge": 0.6, "All-day dining": 0.6, "Casual restaurant": 0.5,
  "Fine dining restaurant": 0.3, "Signature restaurant": 0.3, "Rooftop bar": 0.3,
};
export const RESERVATION_WEIGHT = 0.5;
export const EVENT_SPILLOVER = 0.3;

export interface ForecastInputs {
  /** Average occupancy over the next seven days, 0 to 1. */
  occupancy: number;
  /** Booked restaurant covers over the next seven days. */
  reservations: number;
  eventAttendance: number;
  safetyDays: number;
  /** Stock on hand entered by the user, replacing Tyll's estimate for that ingredient. */
  stockOverride: Record<string, number>;
}

export interface ForecastBaseline {
  occupancy: number;
  reservations: number;
  eventAttendance: number;
  eventName?: string;
  eventDate?: string;
}

export interface ItemForecast {
  itemId: string;
  byDay: number[];
  total: number;
  /** Same weekdays, last four weeks, no adjustments. */
  history: number;
}

export interface PlanStep {
  label: string;
  value: number;
  sign: "+" | "−" | "=";
}

export interface IngredientPlan {
  ingredientId: string;
  consumption: number[];
  avgDaily: number;
  onHand: number;
  onHandIsOverride: boolean;
  incoming: number;
  coverDays: number;
  demand: number;
  safety: number;
  pack: number;
  suggested: number;
  cost: number;
  /** First day stock would run out before a new order could arrive. */
  shortageDay: string | null;
  /** First day stock would dip below safety stock before a new order could arrive. */
  lowDay: string | null;
  overstock: number;
  steps: PlanStep[];
  reason: string;
}

export interface Forecast {
  days: string[];
  baseline: ForecastBaseline;
  effects: { occupancy: number; reservations: number; event: number };
  items: ItemForecast[];
  plans: IngredientPlan[];
  totalCost: number;
}

const horizon = () => eachDay({ from: addDays(DEMO_TODAY, 1), to: addDays(DEMO_TODAY, HORIZON_DAYS) });
const sameWeekdays = (date: string) => [7, 14, 21, 28].map((n) => addDays(date, -n)).filter((d) => d < DEMO_TODAY);
/** Days until the delivery after next: fresh suppliers deliver daily, the others twice a week. */
export const reviewDays = (supplierId: string) => (["meat", "sea", "produce", "bakery"].includes(supplierId) ? 1 : 4);

export function forecastBaseline(data: Dataset, propertyId: string): ForecastBaseline {
  const days = horizon();
  const occ = data.occupancy.filter((o) => o.propertyId === propertyId && days.includes(o.date));
  const outletIds = outletsOfProperty(propertyId).map((o) => o.id);
  const event = data.events.find((e) => e.propertyId === propertyId && days.includes(e.date));
  return {
    occupancy: sum(occ, (o) => o.occupancy) / Math.max(1, occ.length),
    reservations: sum(data.reservations.filter((r) => outletIds.includes(r.outletId) && days.includes(r.date)), (r) => r.covers),
    eventAttendance: event?.attendance ?? 0,
    eventName: event?.name,
    eventDate: event?.date,
  };
}

export function defaultInputs(data: Dataset, propertyId: string): ForecastInputs {
  const b = forecastBaseline(data, propertyId);
  return { occupancy: Math.round(b.occupancy * 100) / 100, reservations: b.reservations, eventAttendance: b.eventAttendance, safetyDays: 1, stockOverride: {} };
}

export function buildForecast(data: Dataset, stock: StockInputs, propertyId: string, inputs: ForecastInputs, overrides?: PriceOverrides): Forecast {
  const days = horizon();
  const baseline = forecastBaseline(data, propertyId);
  const outlets = outletsOfProperty(propertyId);
  const property = propertyById[propertyId];
  const occScale = baseline.occupancy > 0 ? inputs.occupancy / baseline.occupancy : 1;
  const resScale = baseline.reservations > 0 ? inputs.reservations / baseline.reservations : 1;

  const units = new Map<string, number>();
  for (const r of data.dayItems as readonly DayItem[]) {
    if (outletById[r.outletId].propertyId !== propertyId) continue;
    const k = `${r.outletId}|${r.date}|${r.itemId}`;
    units.set(k, (units.get(k) ?? 0) + r.units);
  }
  const occAt = new Map(data.occupancy.filter((o) => o.propertyId === propertyId).map((o) => [o.date, o.occupancy]));
  const resAt = new Map(data.reservations.map((r) => [`${r.outletId}|${r.date}`, r.covers]));
  const coversAt = new Map<string, number>();
  for (const d of data.dayOutlets) {
    if (outletById[d.outletId].propertyId !== propertyId) continue;
    coversAt.set(d.date, (coversAt.get(d.date) ?? 0) + d.covers);
  }

  const byItem = new Map<string, { byDay: number[]; history: number }>();
  const effectSums = { occupancy: 0, reservations: 0, event: 0, n: 0 };
  days.forEach((date, di) => {
    const past = sameWeekdays(date);
    const occPast = sum(past, (d) => occAt.get(d) ?? 0) / past.length;
    const occEffectBase = occPast > 0 ? ((occAt.get(date) ?? occPast) * occScale) / occPast - 1 : 0;
    const typicalCovers = sum(past, (d) => coversAt.get(d) ?? 0) / past.length;
    const eventToday = baseline.eventDate === date ? inputs.eventAttendance : 0;
    const eventEffect = typicalCovers > 0 ? 1 + (EVENT_SPILLOVER * eventToday) / typicalCovers : 1;
    for (const o of outlets) {
      const occEffect = 1 + (OCCUPANCY_ELASTICITY[o.kind] ?? 0.5) * occEffectBase;
      let resEffect = 1;
      if (o.reservable) {
        const resPast = sum(past, (d) => resAt.get(`${o.id}|${d}`) ?? 0) / past.length;
        const booked = (resAt.get(`${o.id}|${date}`) ?? resPast) * resScale;
        if (resPast > 0) resEffect = 1 + RESERVATION_WEIGHT * (booked / resPast - 1);
      }
      effectSums.occupancy += occEffect;
      effectSums.reservations += resEffect;
      effectSums.event += eventEffect;
      effectSums.n += 1;
      for (const m of o.menu) {
        const history = sum(past, (d) => units.get(`${o.id}|${d}|${m.itemId}`) ?? 0) / past.length;
        let row = byItem.get(m.itemId);
        if (!row) byItem.set(m.itemId, (row = { byDay: days.map(() => 0), history: 0 }));
        row.byDay[di] += history * occEffect * resEffect * eventEffect;
        row.history += history;
      }
    }
  });

  const items: ItemForecast[] = MENU_ITEMS.flatMap((it) => {
    const row = byItem.get(it.id);
    return row ? [{ itemId: it.id, byDay: row.byDay, total: sum(row.byDay, (x) => x), history: row.history }] : [];
  }).sort((a, b) => b.total - a.total);

  const position = new Map(stockPosition(propertyId, stock, overrides).map((s) => [s.ingredientId, s]));
  const plans: IngredientPlan[] = INGREDIENTS.flatMap((g) => {
    if (g.dept === "glassware") return [];
    const consumption = days.map((_, di) => sum(items, (it) => (itemById[it.itemId].recipe?.find((l) => l.ingredientId === g.id)?.qty ?? 0) * it.byDay[di]));
    const total = sum(consumption, (x) => x);
    if (total === 0) return [];
    const avgDaily = total / days.length;
    const override = inputs.stockOverride[g.id];
    const onHand = override ?? Math.max(0, position.get(g.id)?.estimated ?? 0);
    const coverDays = Math.min(days.length, g.shelfLifeDays, g.leadDays + reviewDays(g.supplierId));
    const arrivals = days.map((date) =>
      sum(data.deliveries.filter((d) => d.propertyId === propertyId && d.status === "expected" && d.date === date), (d) => sum(d.lines.filter((l) => l.ingredientId === g.id), (l) => l.ordered)),
    );
    const incoming = sum(arrivals.slice(0, g.leadDays), (x) => x);
    const demand = sum(consumption.slice(0, coverDays), (x) => x);
    const safety = inputs.safetyDays * avgDaily;
    const pack = orderPack(g);
    const raw = demand + safety - onHand - incoming;
    const suggested = raw > 0 ? Math.ceil(raw / pack - 1e-9) * pack : 0;

    // Walk the days forward to see whether stock runs out before a new order could arrive.
    let level = onHand;
    let shortageDay: string | null = null;
    let lowDay: string | null = null;
    for (let i = 0; i < g.leadDays && i < days.length; i++) {
      level += arrivals[i] - consumption[i];
      if (level < 0 && !shortageDay) shortageDay = days[i];
      if (level < safety && !lowDay) lowDay = days[i];
    }
    const usableDays = Math.min(g.shelfLifeDays, days.length);
    const usable = sum(consumption.slice(0, usableDays), (x) => x);
    const overstock = suggested === 0 && g.shelfLifeDays <= days.length ? Math.max(0, onHand + incoming - usable * 1.1) : 0;

    const unitCost = ingredientCostAt(g.id, DEMO_TODAY, overrides) * property.costFactor;
    const steps: PlanStep[] = [
      { label: `Forecast use over the next ${coverDays} day${coverDays > 1 ? "s" : ""} (${g.leadDays} day lead time + ${reviewDays(g.supplierId)} until the following delivery)`, value: demand, sign: "+" },
      { label: `Safety stock (${inputs.safetyDays} day${inputs.safetyDays === 1 ? "" : "s"} of average use)`, value: safety, sign: "+" },
      { label: override !== undefined ? "Stock on hand (entered by you)" : "Estimated stock on hand", value: onHand, sign: "−" },
      { label: "Already on order, arriving within the lead time", value: incoming, sign: "−" },
      { label: `Rounded up to packs of ${pack} ${g.unit === "each" ? "" : g.unit}`.trim(), value: suggested, sign: "=" },
    ];
    const reason =
      suggested === 0
        ? overstock > 0
          ? "No order needed. Stock on hand already exceeds what will be used before it expires."
          : "No order needed. Stock on hand and on order cover forecast use plus safety stock."
        : shortageDay
          ? "Order now. At forecast demand, stock runs out before a new delivery could arrive."
          : lowDay
            ? "Order now. Stock dips into the safety stock before a new delivery could arrive."
            : "Order to cover forecast use until the following delivery, plus safety stock.";
    return [{ ingredientId: g.id, consumption, avgDaily, onHand, onHandIsOverride: override !== undefined, incoming, coverDays, demand, safety, pack, suggested, cost: suggested * unitCost, shortageDay, lowDay: shortageDay ? null : lowDay, overstock, steps, reason }];
  });

  return {
    days,
    baseline,
    effects: {
      occupancy: effectSums.occupancy / effectSums.n,
      reservations: effectSums.reservations / effectSums.n,
      event: effectSums.event / effectSums.n,
    },
    items,
    plans: plans.sort((a, b) => Number(!!b.shortageDay) - Number(!!a.shortageDay) || Number(!!b.lowDay) - Number(!!a.lowDay) || b.cost - a.cost),
    totalCost: sum(plans, (p) => p.cost),
  };
}
