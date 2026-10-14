// Financial aggregation. Every figure on every screen comes from these functions.
import { MENU_ITEMS, OUTLETS, itemById, outletById, propertyById, ingredientById } from "../data/catalog";
import type { Dataset } from "../data/generate";
import type { CountRecord, Currency, DateRange, DayItem, DayOutlet, Dept, Exception, Investigation, InvestigationState, WasteLog } from "../types";
import { DEMO_NOW_MIN, DEMO_TODAY, eachDay, fxRate, previousRange } from "../util";
import { REMOVAL_TYPES } from "./detect";
import { countVarianceValue, isBreakage, wasteCost, wasteDept } from "./inventory";
import { basePriceAt, itemCostAt, itemCostAtProperty, menuPriceAt, type PriceOverrides } from "./pricing";

/** The dataset plus everything changed during the demo session. */
export interface Ctx {
  data: Dataset;
  waste: readonly WasteLog[];
  counts: readonly CountRecord[];
  overrides: PriceOverrides;
  investigations: Readonly<Record<string, InvestigationState>>;
}

export interface Sel {
  outletIds: readonly string[];
  /** Properties the user holds in full; property-wide records count only for these. */
  wholeProperties: readonly string[];
  dept: "all" | Dept;
  range: DateRange;
  currency: Currency;
  /** On this date only sales up to the demo clock time count, so periods compare like for like. */
  cutDate?: string;
}

export interface Totals {
  gross: number;
  comps: number;
  discounts: number;
  refunds: number;
  net: number;
  theoCost: number;
  waste: number;
  breakage: number;
  /** Positive means stock is missing. */
  variance: number;
  fnbCost: number;
  labor: number | null;
  opex: number | null;
  grossProfit: number;
  gpMargin: number;
  operatingExpenses: number | null;
  operatingProfit: number | null;
  opMargin: number | null;
  orders: number;
  covers: number;
  potentialLoss: number;
  confirmedLoss: number;
  recovered: number;
  openCases: number;
  flaggedCases: number;
  adjustments: number;
}

const byDateCache = new WeakMap<object, Map<string, unknown[]>>();
function byDate<T extends { date: string }>(rows: readonly T[]): Map<string, T[]> {
  let m = byDateCache.get(rows) as Map<string, T[]> | undefined;
  if (!m) {
    m = new Map();
    for (const r of rows) {
      const list = m.get(r.date);
      if (list) list.push(r);
      else m.set(r.date, [r]);
    }
    byDateCache.set(rows, m);
  }
  return m;
}

/** Share of an outlet's rostered day (two hours of preparation, service, one hour of closing) worked by the demo clock time. */
export function dayFraction(outletId: string): number {
  const o = outletById[outletId];
  const start = o.openMin - 120;
  const end = o.closeMin + 60;
  return Math.min(1, Math.max(0, (DEMO_NOW_MIN - start) / (end - start)));
}

const rateFor = (outletId: string, currency: Currency) => fxRate(propertyById[outletById[outletId].propertyId].currency, currency);

export function prevSel(sel: Sel): Sel {
  const range = previousRange(sel.range);
  return { ...sel, range, cutDate: sel.range.to === DEMO_TODAY ? range.to : undefined };
}

/** Exceptions joined with their current investigation state. */
export function listInvestigations(ctx: Ctx): Investigation[] {
  return ctx.data.exceptions.map((e) => ({ ...e, ...(ctx.investigations[e.id] ?? ctx.data.seedInvestigations[e.id]) }));
}

export function exceptionInSel(e: Exception, sel: Pick<Sel, "outletIds" | "wholeProperties">): boolean {
  return e.outletId ? sel.outletIds.includes(e.outletId) : sel.wholeProperties.includes(e.propertyId);
}

export function computeTotals(ctx: Ctx, sel: Sel): Totals {
  const outlets = new Set(sel.outletIds);
  const days = eachDay(sel.range);
  const items = byDate<DayItem>(ctx.data.dayItems);
  const dayOutlets = byDate<DayOutlet>(ctx.data.dayOutlets);
  let gross = 0, comps = 0, discounts = 0, refunds = 0, theoCost = 0, orders = 0, covers = 0;
  const netByOutletDay = new Map<string, number>();

  for (const date of days) {
    for (const r of items.get(date) ?? []) {
      if (!outlets.has(r.outletId) || (r.late && date === sel.cutDate)) continue;
      const item = itemById[r.itemId];
      const rate = rateFor(r.outletId, sel.currency);
      const key = `${r.outletId}|${date}`;
      // Labor follows the outlet's whole net sales, whatever department filter is on.
      netByOutletDay.set(key, (netByOutletDay.get(key) ?? 0) + (r.gross - r.comps - r.discounts - r.refunds));
      if (sel.dept !== "all" && item.dept !== sel.dept) continue;
      gross += r.gross * rate;
      comps += r.comps * rate;
      discounts += r.discounts * rate;
      refunds += r.refunds * rate;
      theoCost += r.units * itemCostAtProperty(r.itemId, outletById[r.outletId].propertyId, date, ctx.overrides) * rate;
    }
    for (const d of dayOutlets.get(date) ?? []) {
      if (!outlets.has(d.outletId) || (d.late && date === sel.cutDate)) continue;
      orders += d.orders;
      covers += d.covers;
    }
  }

  let labor: number | null = null;
  let opex: number | null = null;
  if (sel.dept === "all") {
    labor = 0;
    opex = 0;
    for (const id of sel.outletIds) {
      const o = outletById[id];
      const rate = rateFor(id, sel.currency);
      for (const date of days) {
        const fraction = date === DEMO_TODAY || date === sel.cutDate ? dayFraction(id) : 1;
        labor += (o.laborFixed * fraction + o.laborVariable * (netByOutletDay.get(`${id}|${date}`) ?? 0)) * rate;
        opex += o.opexDaily * fraction * rate;
      }
    }
  }

  let waste = 0, breakage = 0;
  for (const w of ctx.waste) {
    if (!w.synced || w.date < sel.range.from || w.date > sel.range.to || !outlets.has(w.outletId)) continue;
    const cost = wasteCost(w, ctx.overrides) * rateFor(w.outletId, sel.currency);
    if (isBreakage(w)) {
      if (sel.dept === "all") breakage += cost;
    } else if (sel.dept === "all" || wasteDept(w) === sel.dept) waste += cost;
  }

  let variance = 0;
  for (const c of ctx.counts) {
    if (c.date < sel.range.from || c.date > sel.range.to) continue;
    const dept = ingredientById[c.ingredientId].dept;
    if (dept === "glassware" || (sel.dept !== "all" && dept !== sel.dept)) continue;
    let share = 0;
    for (const id of sel.outletIds) share += c.allocation[id] ?? 0;
    if (share === 0) continue;
    variance -= countVarianceValue(c, ctx.overrides) * share * fxRate(propertyById[c.propertyId].currency, sel.currency);
  }

  let potentialLoss = 0, confirmedLoss = 0, recovered = 0, openCases = 0, flaggedCases = 0, adjustments = 0;
  for (const e of ctx.data.exceptions) {
    if (e.date < sel.range.from || e.date > sel.range.to || !exceptionInSel(e, sel)) continue;
    const st = ctx.investigations[e.id] ?? ctx.data.seedInvestigations[e.id];
    const rate = fxRate(propertyById[e.propertyId].currency, sel.currency);
    flaggedCases += 1;
    if (!e.type.startsWith("room_charge")) adjustments += 1;
    if (st.status === "closed") {
      confirmedLoss += st.confirmedLoss * rate;
      recovered += st.recovered * rate;
    } else {
      openCases += 1;
      potentialLoss += e.exposure * rate;
    }
  }

  const net = gross - comps - discounts - refunds;
  const fnbCost = theoCost + waste + variance;
  const grossProfit = net - fnbCost;
  const operatingExpenses = labor === null || opex === null ? null : fnbCost + labor + opex;
  const operatingProfit = operatingExpenses === null ? null : net - operatingExpenses;
  return {
    gross, comps, discounts, refunds, net, theoCost, waste, breakage, variance, fnbCost, labor, opex, grossProfit,
    gpMargin: net > 0 ? grossProfit / net : 0,
    operatingExpenses, operatingProfit,
    opMargin: operatingProfit === null || net <= 0 ? null : operatingProfit / net,
    orders, covers, potentialLoss, confirmedLoss, recovered, openCases, flaggedCases, adjustments,
  };
}

export interface Compared {
  now: Totals;
  before: Totals;
}

export const compare = (ctx: Ctx, sel: Sel): Compared => ({ now: computeTotals(ctx, sel), before: computeTotals(ctx, prevSel(sel)) });

export interface OutletRow extends Compared {
  outletId: string;
}

export function totalsByOutlet(ctx: Ctx, sel: Sel): OutletRow[] {
  return sel.outletIds.map((outletId) => ({ outletId, ...compare(ctx, { ...sel, outletIds: [outletId], wholeProperties: [] }) }));
}

export interface DayPoint {
  date: string;
  now: Totals;
  before: Totals;
}

/** One point per day, each paired with the same weekday position in the previous period. */
export function totalsByDay(ctx: Ctx, sel: Sel): DayPoint[] {
  const prev = previousRange(sel.range);
  const prevDays = eachDay(prev);
  return eachDay(sel.range).map((date, i) => ({
    date,
    now: computeTotals(ctx, { ...sel, range: { from: date, to: date } }),
    before: computeTotals(ctx, { ...sel, range: { from: prevDays[i], to: prevDays[i] }, cutDate: date === DEMO_TODAY ? prevDays[i] : undefined }),
  }));
}

export interface ItemRow {
  itemId: string;
  units: number;
  revenue: number;
  net: number;
  cost: number;
  grossProfit: number;
  margin: number;
  /** Margin on net sales in the previous period, or null if the item did not sell. */
  marginBefore: number | null;
  unitsBefore: number;
  /** Current list price and portion cost, averaged over the outlets in scope that sell it. */
  price: number;
  unitCost: number;
  unitProfit: number;
  unitMargin: number;
  priceChangePct: number;
  costChangePct: number;
  hasRecipe: boolean;
}

function itemSums(ctx: Ctx, sel: Sel) {
  const outlets = new Set(sel.outletIds);
  const items = byDate<DayItem>(ctx.data.dayItems);
  const out = new Map<string, { units: number; revenue: number; net: number; cost: number }>();
  for (const date of eachDay(sel.range)) {
    for (const r of items.get(date) ?? []) {
      if (!outlets.has(r.outletId) || (r.late && date === sel.cutDate)) continue;
      if (sel.dept !== "all" && itemById[r.itemId].dept !== sel.dept) continue;
      const rate = rateFor(r.outletId, sel.currency);
      let s = out.get(r.itemId);
      if (!s) out.set(r.itemId, (s = { units: 0, revenue: 0, net: 0, cost: 0 }));
      s.units += r.units;
      s.revenue += r.gross * rate;
      s.net += (r.gross - r.comps - r.discounts - r.refunds) * rate;
      s.cost += r.units * itemCostAtProperty(r.itemId, outletById[r.outletId].propertyId, date, ctx.overrides) * rate;
    }
  }
  return out;
}

export function itemPerformance(ctx: Ctx, sel: Sel): ItemRow[] {
  const now = itemSums(ctx, sel);
  const before = itemSums(ctx, prevSel(sel));
  const startDate = prevSel(sel).range.from;
  return MENU_ITEMS.flatMap((item) => {
    if (sel.dept !== "all" && item.dept !== sel.dept) return [];
    const selling = sel.outletIds.filter((id) => outletById[id].menu.some((m) => m.itemId === item.id));
    if (selling.length === 0) return [];
    const s = now.get(item.id) ?? { units: 0, revenue: 0, net: 0, cost: 0 };
    const b = before.get(item.id);
    let price = 0, unitCost = 0;
    for (const id of selling) {
      const rate = rateFor(id, sel.currency);
      price += menuPriceAt(item.id, id, DEMO_TODAY) * rate;
      unitCost += itemCostAtProperty(item.id, outletById[id].propertyId, DEMO_TODAY, ctx.overrides) * rate;
    }
    price /= selling.length;
    unitCost /= selling.length;
    const grossProfit = s.net - s.cost;
    return [{
      itemId: item.id,
      units: s.units,
      revenue: s.revenue,
      net: s.net,
      cost: s.cost,
      grossProfit,
      margin: s.net > 0 ? grossProfit / s.net : 0,
      marginBefore: b && b.net > 0 ? (b.net - b.cost) / b.net : null,
      unitsBefore: b?.units ?? 0,
      price,
      unitCost,
      unitProfit: price - unitCost,
      unitMargin: price > 0 ? (price - unitCost) / price : 0,
      priceChangePct: basePriceAt(item.id, DEMO_TODAY) / basePriceAt(item.id, startDate) - 1,
      costChangePct: itemCostAt(item.id, DEMO_TODAY, ctx.overrides) / itemCostAt(item.id, startDate, ctx.overrides) - 1,
      hasRecipe: !!item.recipe,
    }];
  });
}

/** Removal-type exceptions per 1,000 orders, the fairest way to compare a busy outlet with a quiet one. */
export function adjustmentRate(t: Totals): number {
  return t.orders > 0 ? (t.adjustments / t.orders) * 1000 : 0;
}

export const isRemoval = (e: Exception) => REMOVAL_TYPES.includes(e.type);

/** A plain-language reading of the period, built from the same figures shown on the page. */
export function headlineInsight(c: Compared, rows: OutletRow[], fmt: (n: number) => string): string {
  const salesChange = c.before.net > 0 ? (c.now.net - c.before.net) / c.before.net : 0;
  const marginMove = (c.now.gpMargin - c.before.gpMargin) * 100;
  const parts = [`Net sales ${fmt(c.now.net)}, ${salesChange >= 0 ? "up" : "down"} ${Math.abs(salesChange * 100).toFixed(1)}% on the previous period.`];
  if (Math.abs(marginMove) >= 0.2) {
    const worst = [...rows].sort((a, b) => a.now.gpMargin - a.before.gpMargin - (b.now.gpMargin - b.before.gpMargin))[0];
    const worstMove = worst ? (worst.now.gpMargin - worst.before.gpMargin) * 100 : 0;
    parts.push(
      `Gross margin ${marginMove < 0 ? "slipped" : "improved"} ${Math.abs(marginMove).toFixed(1)} points` +
        (marginMove < 0 && rows.length > 1 && worst && worstMove < -0.5 ? `, with the largest fall at ${outletById[worst.outletId].name}.` : "."),
    );
  } else parts.push("Gross margin is steady.");
  return parts.join(" ");
}

export const ALL_OUTLET_IDS = OUTLETS.map((o) => o.id);
