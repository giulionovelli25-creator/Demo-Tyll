// Forecast for one or more outlets over a chosen period: guests, dishes, ingredients and what to buy.
// Plain arithmetic on past sales, bookings and occupancy. No statistical or machine-learning model is trained.
//
// Guests are counted once each:
//   reservations   booked covers from the reservation book
//   walk-ins       the outlet's usual guests on that weekday less its usual bookings, moved by hotel occupancy
//   event guests   a share of confirmed event attendees who also visit the outlets
// Occupancy changes walk-ins only, never booked covers, so a guest with a booking is not counted again as a hotel guest.
import { INGREDIENTS, ingredientById, itemById, outletById, outletsOfProperty, storeOwner } from "../data/catalog";
import type { Dataset } from "../data/generate";
import { quotesFor } from "../data/purchasing-rules";
import type { Order, RecipeChange } from "../types";
import { DEMO_TODAY, addDays, eachDay, sum } from "../util";
import { EVENT_SPILLOVER, OCCUPANCY_ELASTICITY } from "./forecast";
import { orderPack, qtyPerUnit, type StockRow } from "./inventory";

export type PeriodKind = "tomorrow" | "3" | "7" | "custom";
export interface Period { from: string; to: string }

export function periodOf(kind: PeriodKind, custom?: Period): Period {
  const from = addDays(DEMO_TODAY, 1);
  if (kind === "tomorrow") return { from, to: from };
  if (kind === "3") return { from, to: addDays(DEMO_TODAY, 3) };
  if (kind === "7") return { from, to: addDays(DEMO_TODAY, 7) };
  const f = custom && custom.from > DEMO_TODAY ? custom.from : from;
  const t = custom && custom.to >= f ? custom.to : f;
  // Forecasts reach two weeks ahead at most.
  return { from: f, to: t > addDays(DEMO_TODAY, 14) ? addDays(DEMO_TODAY, 14) : t };
}

export type Meal = "all" | "breakfast" | "lunch" | "dinner";
export const mealOf = (min: number): Exclude<Meal, "all"> => (min < 11 * 60 ? "breakfast" : min < 17 * 60 ? "lunch" : "dinner");

export interface Assumptions {
  reservations: number;
  walkIns: number;
  /** Average hotel occupancy over the period, 0 to 1. */
  occupancy: number;
  eventGuests: number;
  safetyDays: number;
}

export type Source = "records" | "tyll" | "manual";

export interface Baseline {
  values: Assumptions;
  sources: Record<keyof Assumptions, Source>;
  /** Guests the same weekdays brought in the last four weeks, for comparison. */
  historyGuests: number;
  events: { name: string; date: string; attendance: number }[];
  reservable: boolean;
}

const sameWeekdays = (date: string) => [7, 14, 21, 28].map((n) => addDays(date, -n)).filter((d) => d < DEMO_TODAY);
const avg = (xs: number[]) => (xs.length ? sum(xs, (x) => x) / xs.length : 0);

interface Index {
  covers: Map<string, number>;
  booked: Map<string, number>;
  units: Map<string, number>;
  occ: Map<string, number>;
}
const indexCache = new WeakMap<Dataset, Index>();
function indexOf(data: Dataset): Index {
  const hit = indexCache.get(data);
  if (hit) return hit;
  const covers = new Map<string, number>();
  for (const d of data.dayOutlets) covers.set(`${d.outletId}|${d.date}`, (covers.get(`${d.outletId}|${d.date}`) ?? 0) + d.covers);
  const booked = new Map(data.reservations.map((r) => [`${r.outletId}|${r.date}`, r.covers]));
  const units = new Map<string, number>();
  for (const r of data.dayItems) units.set(`${r.outletId}|${r.date}|${r.itemId}`, (units.get(`${r.outletId}|${r.date}|${r.itemId}`) ?? 0) + r.units);
  const occ = new Map(data.occupancy.map((o) => [`${o.propertyId}|${o.date}`, o.occupancy]));
  const out = { covers, booked, units, occ };
  indexCache.set(data, out);
  return out;
}

/** Usual guests on a weekday, and how many of them had booked. */
function usual(ix: Index, outletId: string, date: string) {
  const past = sameWeekdays(date);
  return { guests: avg(past.map((d) => ix.covers.get(`${outletId}|${d}`) ?? 0)), booked: avg(past.map((d) => ix.booked.get(`${outletId}|${d}`) ?? 0)), past };
}

/** Tyll's figures for the period, each with where it came from. */
export function baselineFor(data: Dataset, outletIds: string[], period: Period): Baseline {
  const ix = indexOf(data);
  const days = eachDay(period);
  const propertyId = outletById[outletIds[0]].propertyId;
  let reservations = 0, walkIns = 0, historyGuests = 0;
  for (const o of outletIds) {
    for (const d of days) {
      const u = usual(ix, o, d);
      historyGuests += u.guests;
      if (outletById[o].reservable) {
        reservations += ix.booked.get(`${o}|${d}`) ?? 0;
        walkIns += Math.max(0, u.guests - u.booked);
      } else walkIns += u.guests;
    }
  }
  const events = data.events.filter((e) => e.propertyId === propertyId && days.includes(e.date)).map((e) => ({ name: e.name, date: e.date, attendance: e.attendance }));
  const occupancy = avg(days.map((d) => ix.occ.get(`${propertyId}|${d}`) ?? 0));
  return {
    values: { reservations: Math.round(reservations), walkIns: Math.round(walkIns), occupancy: Math.round(occupancy * 100) / 100, eventGuests: sum(events, (e) => e.attendance), safetyDays: 1 },
    sources: { reservations: "records", walkIns: "tyll", occupancy: "records", eventGuests: "records", safetyDays: "tyll" },
    historyGuests: Math.round(historyGuests),
    events,
    reservable: outletIds.some((o) => outletById[o].reservable),
  };
}

/** Expected units of each dish, by outlet and day. */
export interface Demand {
  days: string[];
  /** outletId|date|itemId → units */
  units: Map<string, number>;
  guests: { reservations: number; walkIns: number; eventGuests: number };
}

export function demandFor(data: Dataset, outletIds: string[], period: Period, a: Assumptions, base: Baseline): Demand {
  const ix = indexOf(data);
  const days = eachDay(period);
  const propertyId = outletById[outletIds[0]].propertyId;
  const all = outletsOfProperty(propertyId);
  const resScale = base.values.reservations > 0 ? a.reservations / base.values.reservations : 1;
  const eventScale = base.values.eventGuests > 0 ? a.eventGuests / base.values.eventGuests : 1;
  const occBase = base.values.occupancy;

  // Walk-ins: Tyll's estimate moves with occupancy, then a manager's own figure rescales it.
  const tyllWalk = new Map<string, number>();
  let tyllWalkTotal = 0;
  for (const o of outletIds) {
    const elasticity = OCCUPANCY_ELASTICITY[outletById[o].kind] ?? 0.5;
    const occEffect = occBase > 0 ? 1 + elasticity * (a.occupancy / occBase - 1) : 1;
    for (const d of days) {
      const u = usual(ix, o, d);
      const w = Math.max(0, (outletById[o].reservable ? u.guests - u.booked : u.guests) * occEffect);
      tyllWalk.set(`${o}|${d}`, w);
      tyllWalkTotal += w;
    }
  }
  const walkTarget = a.walkIns;
  const occMoved = Math.abs(a.occupancy - occBase) > 1e-9;
  // If only occupancy changed, the walk-in figure follows it; a walk-in figure typed by a manager wins.
  const walkScale = tyllWalkTotal > 0 ? (occMoved && walkTarget === base.values.walkIns ? 1 : walkTarget / tyllWalkTotal) : 1;

  // Event attendees who also eat in the outlets, shared by each outlet's usual share of guests.
  const shareOf = (o: string, d: string) => {
    const total = sum(all, (x) => usual(ix, x.id, d).guests);
    return total > 0 ? usual(ix, o, d).guests / total : 0;
  };

  const units = new Map<string, number>();
  let reservations = 0, walkIns = 0, eventGuests = 0;
  for (const o of outletIds) {
    const outlet = outletById[o];
    for (const d of days) {
      const u = usual(ix, o, d);
      const booked = outlet.reservable ? (ix.booked.get(`${o}|${d}`) ?? 0) * resScale : 0;
      const walk = (tyllWalk.get(`${o}|${d}`) ?? 0) * walkScale;
      const event = sum(data.events.filter((e) => e.propertyId === propertyId && e.date === d), (e) => e.attendance) * eventScale * EVENT_SPILLOVER * shareOf(o, d);
      const guests = booked + walk + event;
      reservations += booked;
      walkIns += walk;
      eventGuests += event;
      if (u.guests <= 0) continue;
      for (const m of outlet.menu) {
        const perGuest = avg(u.past.map((p) => ix.units.get(`${o}|${p}|${m.itemId}`) ?? 0)) / u.guests;
        if (perGuest > 0) units.set(`${o}|${d}|${m.itemId}`, perGuest * guests);
      }
    }
  }
  return { days, units, guests: { reservations, walkIns, eventGuests } };
}

/** Share of each dish sold at each meal, from the last four weeks of orders. Needs order times, so it runs on the server. */
export function mealShares(orders: readonly Order[], outletId: string): Map<string, Record<Exclude<Meal, "all">, number>> {
  const from = addDays(DEMO_TODAY, -28);
  const counts = new Map<string, Record<Exclude<Meal, "all">, number>>();
  for (const o of orders) {
    if (o.outletId !== outletId || o.date < from || o.date >= DEMO_TODAY || o.voided) continue;
    for (const l of o.lines) {
      if (l.state !== "kept" && l.state !== "comped") continue;
      const c = counts.get(l.itemId) ?? { breakfast: 0, lunch: 0, dinner: 0 };
      c[mealOf(l.enteredMin)] += l.qty;
      counts.set(l.itemId, c);
    }
  }
  const out = new Map<string, Record<Exclude<Meal, "all">, number>>();
  for (const [item, c] of counts) {
    const t = c.breakfast + c.lunch + c.dinner;
    if (t > 0) out.set(item, { breakfast: c.breakfast / t, lunch: c.lunch / t, dinner: c.dinner / t });
  }
  return out;
}

/** Ingredient quantities for a set of dish portions on given days, through the recipes and any corrected standards. */
export function ingredientsFor(portions: { itemId: string; date: string; units: number }[], recipes: readonly RecipeChange[] = []): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of portions) {
    for (const l of itemById[p.itemId].recipe ?? []) {
      out.set(l.ingredientId, (out.get(l.ingredientId) ?? 0) + p.units * qtyPerUnit(l.qty, p.itemId, l.ingredientId, p.date, recipes));
    }
  }
  return out;
}

/** Ingredient need by day from a demand map, limited to some outlets. */
export function needByDay(d: Demand, outletIds: string[], recipes: readonly RecipeChange[] = []): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const keep = new Set(outletIds);
  for (const [k, units] of d.units) {
    const [o, date, itemId] = k.split("|");
    if (!keep.has(o)) continue;
    const di = d.days.indexOf(date);
    for (const l of itemById[itemId].recipe ?? []) {
      let row = out.get(l.ingredientId);
      if (!row) out.set(l.ingredientId, (row = d.days.map(() => 0)));
      row[di] += units * qtyPerUnit(l.qty, itemId, l.ingredientId, date, recipes);
    }
  }
  return out;
}

export type Risk = "high" | "medium" | "low" | "none";

export interface BuyStep { label: string; value: number; sign: "+" | "−" | "=" }

export interface BuyLine {
  ingredientId: string;
  unit: string;
  requirement: number;
  safety: number;
  usable: number;
  reservedForOthers: number;
  available: number;
  incoming: number;
  requested: number;
  suggested: number;
  pack: number;
  supplierId: string;
  unitPrice: number;
  cost: number;
  risk: Risk;
  /** First day the outlet would run short without a new order. */
  shortageDay: string | null;
  orderBy: string;
  coverDays: number;
  note?: string;
  steps: BuyStep[];
}

export interface BuyContext {
  propertyId: string;
  period: Period;
  /** Need of the outlets this plan is for, by ingredient and day. */
  mine: Map<string, number[]>;
  /** Need of other outlets drawing on the same shared store. Totals only; no dish detail. */
  others: Map<string, number[]>;
  stock: readonly StockRow[];
  /** Confirmed arrivals by ingredient and date: supplier deliveries and approved orders not yet received. */
  arrivals: Map<string, Map<string, number>>;
  /** Quantity already on open requests that are not yet approved. */
  requested: Map<string, number>;
  safetyDays: number;
  /** Outlets the plan is for. An outlet's own store, and its deliveries, serve only that outlet. Empty for an event. */
  mineOutlets?: string[];
}

/**
 * Suggested purchase = max(0, requirement + safety stock − available usable stock − confirmed incoming − already requested),
 * rounded up to whole packs. Other outlets' forecast use is reserved from stock first, then from deliveries, so the same
 * quantity is never counted for two outlets.
 */
export function buyLines(c: BuyContext): BuyLine[] {
  const days = eachDay(c.period);
  const stockBy = new Map(c.stock.map((s) => [s.ingredientId, s]));
  return INGREDIENTS.flatMap((g): BuyLine[] => {
    const need = c.mine.get(g.id);
    if (!need || sum(need, (x) => x) <= 1e-9 || g.dept === "glassware") return [];
    const row = stockBy.get(g.id);
    // An outlet's own store is only drawn by that outlet; other outlets' use does not touch it.
    const owner = storeOwner(c.propertyId, g.id);
    const shared = !owner;
    // Stock held in another outlet's own store is not available here, nor are deliveries to it.
    const foreign = !!owner && !!c.mineOutlets && !c.mineOutlets.includes(owner);
    const coverDays = Math.min(days.length, Math.max(1, g.shelfLifeDays));
    const requirement = sum(need.slice(0, coverDays), (x) => x);
    const othersNeed = shared ? sum((c.others.get(g.id) ?? []).slice(0, coverDays), (x) => x) : 0;
    const usable = foreign ? 0 : Math.max(0, row?.estimated ?? 0);
    const reservedForOthers = Math.min(usable, othersNeed);
    const available = usable - reservedForOthers;
    const arrivals = foreign ? new Map<string, number>() : c.arrivals.get(g.id) ?? new Map<string, number>();
    const arriving = sum(days.slice(0, coverDays), (d) => arrivals.get(d) ?? 0);
    const othersFromDeliveries = Math.min(arriving, Math.max(0, othersNeed - usable));
    const incoming = arriving - othersFromDeliveries;
    const requested = c.requested.get(g.id) ?? 0;
    const safety = c.safetyDays * (sum(need, (x) => x) / days.length);
    const pack = orderPack(g);
    const raw = requirement + safety - available - incoming - requested;
    const suggested = raw > 1e-9 ? Math.round(Math.ceil(raw / pack - 1e-9) * pack * 1000) / 1000 : 0;

    // Walk the days to find when this outlet would run short without a new order.
    let level = available + requested;
    let shortageDay: string | null = null;
    for (let i = 0; i < coverDays; i++) {
      level += (arrivals.get(days[i]) ?? 0) * (arriving > 0 ? incoming / arriving : 0) - need[i];
      if (level < -1e-9 && !shortageDay) shortageDay = days[i];
    }
    const lead = g.leadDays;
    const latest = addDays(shortageDay ?? days[0], -lead);
    const orderBy = latest < DEMO_TODAY ? DEMO_TODAY : latest;
    const risk: Risk = suggested <= 0 ? "none" : shortageDay && shortageDay <= addDays(DEMO_TODAY, lead) ? "high" : shortageDay ? "medium" : "low";
    const quote = quotesFor(g.id, c.propertyId, DEMO_TODAY)[0];
    const unit = g.unit === "each" ? "units" : g.unit;
    const steps: BuyStep[] = [
      { label: `Forecast requirement over ${coverDays} day${coverDays === 1 ? "" : "s"}`, value: requirement, sign: "+" },
      { label: `Safety stock, ${c.safetyDays} day${c.safetyDays === 1 ? "" : "s"} of average use`, value: safety, sign: "+" },
      { label: foreign ? `Held in ${outletById[owner!].name}'s own store, not available here` : shared ? "Usable stock in the shared storeroom" : "Usable stock in this outlet's own store", value: usable, sign: "−" },
      ...(reservedForOthers > 0 ? [{ label: "Reserved for other outlets' forecast use", value: reservedForOthers, sign: "+" as const }] : []),
      { label: "Confirmed incoming deliveries", value: incoming, sign: "−" },
      ...(requested > 0 ? [{ label: "Already on open purchase requests", value: requested, sign: "−" as const }] : []),
      { label: `Suggested purchase, rounded up to packs of ${pack} ${unit}`, value: suggested, sign: "=" },
    ];
    return [{
      ingredientId: g.id, unit, requirement, safety, usable, reservedForOthers, available, incoming, requested, suggested, pack,
      supplierId: quote.supplierId, unitPrice: quote.unitPrice, cost: Math.round(suggested * quote.unitPrice * 100) / 100,
      risk, shortageDay, orderBy, coverDays,
      note: coverDays < days.length ? `Keeps ${g.shelfLifeDays} day${g.shelfLifeDays === 1 ? "" : "s"}: order the rest later.` : undefined,
      steps,
    }];
  }).sort((a, b) => ({ high: 0, medium: 1, low: 2, none: 3 })[a.risk] - ({ high: 0, medium: 1, low: 2, none: 3 })[b.risk] || b.cost - a.cost);
}

export const unitLabel = (ingredientId: string) => (ingredientById[ingredientId].unit === "each" ? "units" : ingredientById[ingredientId].unit);
