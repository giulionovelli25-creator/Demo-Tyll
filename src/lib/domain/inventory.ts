// Stock arithmetic: expected usage from recipes, estimated stock, waste cost and count variance.
import { INGREDIENTS, ingredientById, itemById, outletById, outletsOfProperty, propertyById } from "../data/catalog";
import type { CountRecord, DayItem, Delivery, DeliveryLine, Transfer, WasteLog } from "../types";
import { DEMO_TODAY, addDays, round2 } from "../util";
import { ingredientCostAt, itemCostAtProperty, type PriceOverrides } from "./pricing";

export interface StockInputs {
  dayItems: readonly DayItem[];
  counts: readonly CountRecord[];
  deliveries: readonly Delivery[];
  transfers: readonly Transfer[];
  waste: readonly WasteLog[];
}

/** Ingredient quantities the recipes say were used for the given sales rows. */
export function usageFromSales(rows: readonly DayItem[], pred: (r: DayItem) => boolean = () => true): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!pred(r)) continue;
    const recipe = itemById[r.itemId].recipe;
    if (!recipe) continue;
    for (const l of recipe) out.set(l.ingredientId, (out.get(l.ingredientId) ?? 0) + l.qty * r.units);
  }
  return out;
}

const avgCache = new WeakMap<readonly DayItem[], Map<string, Map<string, number>>>();

/** Average daily recipe usage per ingredient over the last 28 complete days. */
export function avgDailyUsage(dayItems: readonly DayItem[], propertyId: string): Map<string, number> {
  let byProp = avgCache.get(dayItems);
  if (!byProp) avgCache.set(dayItems, (byProp = new Map()));
  const hit = byProp.get(propertyId);
  if (hit) return hit;
  const from = addDays(DEMO_TODAY, -28);
  const usage = usageFromSales(dayItems, (r) => r.date >= from && r.date < DEMO_TODAY && outletById[r.outletId].propertyId === propertyId);
  const avg = new Map<string, number>();
  for (const [k, v] of usage) avg.set(k, v / 28);
  byProp.set(propertyId, avg);
  return avg;
}

/** Smallest quantity that can be ordered: whole packs for counted items, a fifth of a case for items bought by weight or volume. */
export const orderPack = (g: { unit: string; packSize: number }) => (g.unit === "each" ? g.packSize : g.packSize >= 5 ? g.packSize / 5 : g.packSize);

export const parLevel = (ingredientId: string, avgDaily: number) => avgDaily * (ingredientById[ingredientId].shelfLifeDays <= 5 ? 3 : 6);

/** Ingredient quantities removed from stock by a waste entry. Prepared dishes are converted through their recipe. */
export function wasteQuantities(log: WasteLog): { ingredientId: string; qty: number }[] {
  if (log.ingredientId) return [{ ingredientId: log.ingredientId, qty: log.qty }];
  const recipe = log.itemId ? itemById[log.itemId].recipe : undefined;
  return (recipe ?? []).map((l) => ({ ingredientId: l.ingredientId, qty: l.qty * log.qty }));
}

/** Cost of a waste entry in the property's own currency, at the cost in force on the day. */
export function wasteCost(log: WasteLog, overrides?: PriceOverrides): number {
  const property = propertyById[outletById[log.outletId].propertyId];
  if (log.ingredientId) return log.qty * ingredientCostAt(log.ingredientId, log.date, overrides) * property.costFactor;
  if (log.itemId) return log.qty * itemCostAtProperty(log.itemId, property.id, log.date, overrides);
  return 0;
}

export const wasteDept = (log: WasteLog) => (log.ingredientId ? ingredientById[log.ingredientId].dept : itemById[log.itemId!].dept);
export const isBreakage = (log: WasteLog) => wasteDept(log) === "glassware";

export const countVariance = (c: CountRecord) => c.counted - c.expected;

/** Variance value in the property's own currency. Negative means stock is missing. */
export function countVarianceValue(c: CountRecord, overrides?: PriceOverrides): number {
  return countVariance(c) * ingredientCostAt(c.ingredientId, c.date, overrides) * propertyById[c.propertyId].costFactor;
}

const isAfter = (r: { date: string; seq?: number }, b: { date: string; seq: number }) =>
  r.date > b.date || (r.date === b.date && (r.seq ?? 0) > b.seq);

export interface StockRow {
  ingredientId: string;
  baselineDate: string;
  baselineQty: number;
  received: number;
  usage: number;
  waste: number;
  breakage: number;
  transferIn: number;
  transferOut: number;
  estimated: number;
  unitCost: number;
  value: number;
  avgDaily: number;
  par: number;
  daysCover: number | null;
}

/** Estimated stock now = last physical count + everything recorded since. */
export function stockPosition(propertyId: string, inp: StockInputs, overrides?: PriceOverrides): StockRow[] {
  const outletIds = new Set(outletsOfProperty(propertyId).map((o) => o.id));
  const factor = propertyById[propertyId].costFactor;
  const avg = avgDailyUsage(inp.dayItems, propertyId);

  const baseline = new Map<string, CountRecord>();
  for (const c of inp.counts) {
    if (c.propertyId !== propertyId) continue;
    const cur = baseline.get(c.ingredientId);
    if (!cur || isAfter(c, cur)) baseline.set(c.ingredientId, c);
  }

  const usageByDate = new Map<string, Map<string, number>>();
  for (const r of inp.dayItems) {
    if (!outletIds.has(r.outletId)) continue;
    const recipe = itemById[r.itemId].recipe;
    if (!recipe) continue;
    let m = usageByDate.get(r.date);
    if (!m) usageByDate.set(r.date, (m = new Map()));
    for (const l of recipe) m.set(l.ingredientId, (m.get(l.ingredientId) ?? 0) + l.qty * r.units);
  }

  return INGREDIENTS.flatMap((ing) => {
    const b = baseline.get(ing.id);
    if (!b) return [];
    let received = 0;
    let usage = 0;
    let waste = 0;
    let breakage = 0;
    let transferIn = 0;
    let transferOut = 0;
    for (const d of inp.deliveries) {
      if (d.propertyId !== propertyId || d.status !== "delivered" || !isAfter(d, b)) continue;
      for (const l of d.lines) if (l.ingredientId === ing.id) received += l.delivered;
    }
    for (const [date, m] of usageByDate) if (date > b.date) usage += m.get(ing.id) ?? 0;
    for (const w of inp.waste) {
      if (!w.synced || !outletIds.has(w.outletId) || !isAfter(w, b)) continue;
      for (const q of wasteQuantities(w)) {
        if (q.ingredientId !== ing.id) continue;
        if (w.reason === "breakage") breakage += q.qty;
        else waste += q.qty;
      }
    }
    for (const t of inp.transfers) {
      if (t.propertyId !== propertyId || t.ingredientId !== ing.id || !isAfter(t, b)) continue;
      if (t.direction === "in") transferIn += t.qty;
      else transferOut += t.qty;
    }
    const estimated = b.counted + received - usage - waste - breakage + transferIn - transferOut;
    const unitCost = ingredientCostAt(ing.id, DEMO_TODAY, overrides) * factor;
    const avgDaily = avg.get(ing.id) ?? 0;
    return [{
      ingredientId: ing.id,
      baselineDate: b.date,
      baselineQty: b.counted,
      received,
      usage,
      waste,
      breakage,
      transferIn,
      transferOut,
      estimated,
      unitCost,
      value: estimated * unitCost,
      avgDaily,
      par: parLevel(ing.id, avgDaily),
      daysCover: avgDaily > 0 ? estimated / avgDaily : null,
    }];
  });
}

/** How a variance is shared between outlets: by each outlet's recipe usage of the ingredient in the week before the count. */
export function varianceAllocation(dayItems: readonly DayItem[], propertyId: string, ingredientId: string, date: string): Record<string, number> {
  const from = addDays(date, -6);
  const outlets = outletsOfProperty(propertyId);
  const used: Record<string, number> = {};
  let total = 0;
  for (const o of outlets) used[o.id] = 0;
  for (const r of dayItems) {
    if (r.date < from || r.date > date || !(r.outletId in used)) continue;
    const line = itemById[r.itemId].recipe?.find((l) => l.ingredientId === ingredientId);
    if (!line) continue;
    used[r.outletId] += line.qty * r.units;
    total += line.qty * r.units;
  }
  const out: Record<string, number> = {};
  for (const o of outlets) out[o.id] = total > 0 ? used[o.id] / total : 1 / outlets.length;
  return out;
}

export type MatchIssue = "short_delivery" | "invoiced_not_delivered" | "price_above_po" | "over_delivery";

export interface LineMatch {
  line: DeliveryLine;
  issues: MatchIssue[];
  /** Amount invoiced beyond what was delivered at the agreed price. */
  overcharge: number;
}

/** Three-way match of purchase order, goods received and supplier invoice. */
export function matchDeliveryLine(line: DeliveryLine): LineMatch {
  const issues: MatchIssue[] = [];
  if (line.delivered < line.ordered) issues.push("short_delivery");
  if (line.delivered > line.ordered) issues.push("over_delivery");
  if (line.invoiced > line.delivered) issues.push("invoiced_not_delivered");
  if (line.invoicePrice > line.poPrice + 0.005) issues.push("price_above_po");
  const overcharge = round2(line.invoiced * line.invoicePrice - Math.min(line.invoiced, line.delivered) * line.poPrice);
  return { line, issues, overcharge: issues.includes("invoiced_not_delivered") || issues.includes("price_above_po") ? overcharge : 0 };
}

export const deliveryOvercharge = (d: Delivery) => d.lines.reduce((s, l) => s + matchDeliveryLine(l).overcharge, 0);
