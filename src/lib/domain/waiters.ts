// Drinks per guest by waiter. Each bill counts for the POS login that rang it. A waiter is compared with the colleagues
// who worked the same outlet on the same day and shift, so a busy Saturday night or a quiet breakfast never counts for or
// against anyone. A low figure is a prompt to coach, not proof of anything else: most tables with food and no drink are
// guests who did not want one. Pure functions; the server view is src/lib/server/waiters.ts.
import { itemById, outletById } from "../data/catalog";
import type { Order } from "../types";
import { round2 } from "../util";
import { SHIFTS, shiftOf, type Shift } from "./pour";

export const WAITER_RULES = {
  /** Fewer guests than this, compared with colleagues in the period, and a waiter is not judged: too few to tell. */
  minGuests: 50,
  /** Marked to coach when drinks per guest is at least this share below colleagues on the same shifts... */
  below: 0.15,
  /** ...and the gap is at least this many standard errors, beyond what chance alone produces (as on Over pouring). */
  z: 3,
} as const;

/** Banquet drinks are sold as packages per event, not by a waiter at the table, so Banquets and Events is left out. */
export const waiterOutlet = (outletId: string) => !!outletById[outletId] && outletById[outletId].kind !== "Banquets and events";

/** The breakfast buffet includes coffee and juice, so a bill with the buffet on it is never a table without drinks. */
const DRINKS_INCLUDED = new Set(["breakfast"]);

export interface BillFacts {
  orderId: string;
  outletId: string;
  date: string;
  shift: Shift;
  staffId: string;
  table: string;
  openMin: number;
  guests: number;
  /** Drinks billed: kept beverage lines. Complimentary and removed lines are not sold. */
  drinks: number;
  drinkValue: number;
  /** Food billed, at menu price. */
  foodValue: number;
  /** Food on the bill other than the breakfast buffet. */
  food: boolean;
  /** Food on the bill, no drink billed and no breakfast buffet, which includes coffee and juice. */
  noDrink: boolean;
  foodItems: string[];
}

/** What one bill tells about drinks, or null when it is not compared (voided, or a banquet bill). */
export function billFacts(o: Order): BillFacts | null {
  if (o.voided || !waiterOutlet(o.outletId)) return null;
  const kept = o.lines.filter((l) => l.state === "kept");
  const drinkLines = kept.filter((l) => itemById[l.itemId]?.dept === "beverage");
  const foodLines = kept.filter((l) => itemById[l.itemId]?.dept === "food");
  const drinks = drinkLines.reduce((n, l) => n + l.qty, 0);
  const food = foodLines.some((l) => !DRINKS_INCLUDED.has(l.itemId));
  const included = foodLines.some((l) => DRINKS_INCLUDED.has(l.itemId));
  return {
    orderId: o.id, outletId: o.outletId, date: o.date, shift: shiftOf(o.openMin), staffId: o.staffId, table: o.table, openMin: o.openMin,
    guests: o.covers, drinks, drinkValue: round2(drinkLines.reduce((n, l) => n + l.qty * l.unitPrice, 0)),
    foodValue: round2(foodLines.reduce((n, l) => n + l.qty * l.unitPrice, 0)), food, noDrink: food && drinks === 0 && !included,
    foodItems: [...new Set(foodLines.map((l) => l.itemId))],
  };
}

export type WaiterStatus = "coach" | "above" | "in_line" | "too_few";

/** One waiter on one shift (day, evening or late) against colleagues at the same outlet on the same days and shift. */
export interface ShiftCompare {
  shift: Shift;
  bills: number;
  guests: number;
  drinks: number;
  /** Guests on days where colleagues also rang bills on this shift: the like for like part. */
  comparedGuests: number;
  /** Drinks per guest on the compared days. */
  rate: number | null;
  /** What colleagues sold per guest on the same days and shift, weighted by this waiter's guests. */
  peerRate: number | null;
  /** How many standard errors the gap is from colleagues; negative is below. */
  z: number;
  /** Drinks this waiter would have sold at colleagues' pace, less drinks sold. Never below zero. */
  shortfall: number;
  /** The shortfall at the outlet's average drink price in the period. An estimate. */
  shortfallValue: number;
  foodTables: number;
  noDrink: number;
  /** Tables with food and no drink at colleagues' share on the same days and shift. */
  expectedNoDrink: number;
  status: WaiterStatus;
}

export interface WaiterRow {
  staffId: string;
  outletId: string;
  bills: number;
  guests: number;
  drinks: number;
  /** Drinks per guest over every shift, compared days only. */
  rate: number | null;
  peerRate: number | null;
  /** To coach when any shift is; above the team when a shift is and none is to coach; too few when no shift can be judged. */
  status: WaiterStatus;
  /** Drinks not sold on the shifts marked to coach, and their value at the outlet's average drink price. An estimate. */
  shortfall: number;
  shortfallValue: number;
  foodTables: number;
  noDrink: number;
  expectedNoDrink: number;
  /** Shifts the waiter worked, day first. */
  shifts: ShiftCompare[];
}

export interface OutletShift {
  shift: Shift;
  bills: number;
  guests: number;
  drinks: number;
  /** Team drinks per guest on this shift: every bill. The line on the chart. */
  rate: number | null;
  foodTables: number;
  noDrink: number;
}

export interface OutletWaiters {
  outletId: string;
  bills: number;
  guests: number;
  drinks: number;
  /** Team drinks per guest: every bill in the period. */
  rate: number;
  foodTables: number;
  noDrink: number;
  /** Average menu price of a drink sold in the period, for the estimates. */
  drinkPrice: number;
  shifts: OutletShift[];
  waiters: WaiterRow[];
}

const cellKey = (f: Pick<BillFacts, "outletId" | "date" | "shift">) => `${f.outletId}|${f.date}|${f.shift}`;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const r1 = (n: number) => Math.round(n * 10) / 10;

interface Tally { bills: number; guests: number; drinks: number; food: number; noDrink: number }
const tally = (): Tally => ({ bills: 0, guests: 0, drinks: 0, food: 0, noDrink: 0 });
const add = (t: Tally, f: BillFacts) => { t.bills += 1; t.guests += f.guests; t.drinks += f.drinks; t.food += f.food ? 1 : 0; t.noDrink += f.noDrink ? 1 : 0; };
const sumOf = (facts: readonly BillFacts[]) => { const t = tally(); for (const f of facts) add(t, f); return t; };

type Cells = Map<string, { all: Tally; by: Map<string, Tally> }>;

/** Totals per outlet, day and shift, and per waiter inside each. */
export function buildCells(facts: readonly BillFacts[]): Cells {
  const cells: Cells = new Map();
  for (const f of facts) {
    const k = cellKey(f);
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { all: tally(), by: new Map() }));
    add(c.all, f);
    let w = c.by.get(f.staffId);
    if (!w) c.by.set(f.staffId, (w = tally()));
    add(w, f);
  }
  return cells;
}

/** Colleagues' drinks per guest and no drink share in this bill's day and shift, leaving the waiter's own bills out. */
export function peerPace(cells: Cells, f: BillFacts): { rate: number | null; noDrinkShare: number | null } {
  const c = cells.get(cellKey(f));
  if (!c) return { rate: null, noDrinkShare: null };
  const mine = c.by.get(f.staffId) ?? tally();
  return { rate: ratio(c.all.drinks - mine.drinks, c.all.guests - mine.guests), noDrinkShare: ratio(c.all.noDrink - mine.noDrink, c.all.food - mine.food) };
}

/** The like for like sums for some of one waiter's bills. */
function against(mine: readonly BillFacts[], cells: Cells) {
  let comparedGuests = 0, comparedDrinks = 0, expected = 0, resid = 0, resid2 = 0, expectedNoDrink = 0;
  for (const f of mine) {
    const p = peerPace(cells, f);
    if (p.rate !== null) {
      const e = f.guests * p.rate;
      comparedGuests += f.guests;
      comparedDrinks += f.drinks;
      expected += e;
      resid += f.drinks - e;
      resid2 += (f.drinks - e) ** 2;
    }
    if (f.food && p.noDrinkShare !== null) expectedNoDrink += p.noDrinkShare;
  }
  return { comparedGuests, comparedDrinks, expected, z: resid2 > 0 ? r1(resid / Math.sqrt(resid2)) : 0, expectedNoDrink };
}

/** The rule: enough guests, at least 15% below (or above) colleagues, and beyond what chance alone produces. */
export function waiterStatus(x: { comparedGuests: number; rate: number | null; peerRate: number | null; z: number }): WaiterStatus {
  if (x.comparedGuests < WAITER_RULES.minGuests || x.rate === null || x.peerRate === null || x.peerRate <= 0) return "too_few";
  if (x.rate <= x.peerRate * (1 - WAITER_RULES.below) && x.z <= -WAITER_RULES.z) return "coach";
  if (x.rate >= x.peerRate * (1 + WAITER_RULES.below) && x.z >= WAITER_RULES.z) return "above";
  return "in_line";
}

/** One waiter's bills against colleagues, shift by shift. `cells` holds every bill of the outlet in the period. */
function compareWaiter(staffId: string, outletId: string, mine: readonly BillFacts[], cells: Cells, drinkPrice: number): WaiterRow {
  const shifts: ShiftCompare[] = SHIFTS.flatMap((sh) => {
    const here = mine.filter((f) => f.shift === sh.id);
    if (!here.length) return [];
    const t = sumOf(here);
    const a = against(here, cells);
    const rate = r2(ratio(a.comparedDrinks, a.comparedGuests));
    const peerRate = r2(ratio(a.expected, a.comparedGuests));
    // The status uses the unrounded pace, so a rounding step never decides it.
    const status = waiterStatus({ comparedGuests: a.comparedGuests, rate: ratio(a.comparedDrinks, a.comparedGuests), peerRate: ratio(a.expected, a.comparedGuests), z: a.z });
    const shortfall = Math.max(0, a.expected - a.comparedDrinks);
    return [{
      shift: sh.id, bills: t.bills, guests: t.guests, drinks: t.drinks, comparedGuests: a.comparedGuests, rate, peerRate, z: a.z,
      shortfall: r1(shortfall), shortfallValue: Math.round(shortfall * drinkPrice), foodTables: t.food, noDrink: t.noDrink, expectedNoDrink: r1(a.expectedNoDrink), status,
    }];
  });
  const t = sumOf(mine);
  const a = against(mine, cells);
  const coach = shifts.filter((s) => s.status === "coach");
  const status: WaiterStatus = coach.length ? "coach" : shifts.some((s) => s.status === "above") ? "above" : shifts.every((s) => s.status === "too_few") ? "too_few" : "in_line";
  return {
    staffId, outletId, bills: t.bills, guests: t.guests, drinks: t.drinks,
    rate: r2(ratio(a.comparedDrinks, a.comparedGuests)), peerRate: r2(ratio(a.expected, a.comparedGuests)), status,
    shortfall: r1(coach.reduce((n, s) => n + s.shortfall, 0)), shortfallValue: coach.reduce((n, s) => n + s.shortfallValue, 0),
    foodTables: t.food, noDrink: t.noDrink, expectedNoDrink: r1(a.expectedNoDrink), shifts,
  };
}

/** Status order on screen: to coach first, then in line, above, and too few to tell. */
const STATUS_ORDER: Record<WaiterStatus, number> = { coach: 0, in_line: 1, above: 2, too_few: 3 };

/** Every waiter at each outlet, against colleagues on the same outlet, day and shift. Bills from `from` to `to` inclusive. */
export function compareWaiters(orders: readonly Order[], q: { outletIds: readonly string[]; from: string; to: string }): OutletWaiters[] {
  const facts = orders.filter((o) => q.outletIds.includes(o.outletId) && o.date >= q.from && o.date <= q.to).map(billFacts).filter((f): f is BillFacts => f !== null);
  return q.outletIds.filter(waiterOutlet).map((outletId) => {
    const here = facts.filter((f) => f.outletId === outletId);
    const cells = buildCells(here);
    const t = sumOf(here);
    const drinkPrice = t.drinks ? round2(here.reduce((n, f) => n + f.drinkValue, 0) / t.drinks) : 0;
    const ids = [...new Set(here.map((f) => f.staffId))];
    const waiters = ids.map((id) => compareWaiter(id, outletId, here.filter((f) => f.staffId === id), cells, drinkPrice))
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.shortfallValue - a.shortfallValue || (a.rate ?? 0) - (b.rate ?? 0) || a.staffId.localeCompare(b.staffId));
    const shifts: OutletShift[] = SHIFTS.flatMap((sh) => {
      const s = sumOf(here.filter((f) => f.shift === sh.id));
      return s.bills ? [{ shift: sh.id, bills: s.bills, guests: s.guests, drinks: s.drinks, rate: r2(ratio(s.drinks, s.guests)), foodTables: s.food, noDrink: s.noDrink }] : [];
    });
    return { outletId, bills: t.bills, guests: t.guests, drinks: t.drinks, rate: r2(ratio(t.drinks, t.guests)) ?? 0, foodTables: t.food, noDrink: t.noDrink, drinkPrice, shifts, waiters };
  }).filter((o) => o.bills > 0);
}

export interface NoDrinkTable {
  orderId: string;
  date: string;
  shift: Shift;
  openMin: number;
  table: string;
  guests: number;
  foodValue: number;
  foodItems: string[];
  /** Drinks colleagues on the same shift sold per guest, times the guests, at the outlet's average drink price. An estimate. */
  estValue: number;
}

/** One waiter's tables with food billed and no drink, the largest estimate first. */
export function noDrinkTables(orders: readonly Order[], q: { outletId: string; staffId: string; from: string; to: string; shift?: Shift }, drinkPrice: number): NoDrinkTable[] {
  const facts = orders.filter((o) => o.outletId === q.outletId && o.date >= q.from && o.date <= q.to).map(billFacts).filter((f): f is BillFacts => f !== null);
  const cells = buildCells(facts);
  return facts.filter((f) => f.staffId === q.staffId && f.noDrink && (!q.shift || f.shift === q.shift)).map((f) => {
    const p = peerPace(cells, f);
    return { orderId: f.orderId, date: f.date, shift: f.shift, openMin: f.openMin, table: f.table, guests: f.guests, foodValue: f.foodValue, foodItems: f.foodItems, estValue: round2(f.guests * (p.rate ?? 0) * drinkPrice) };
  }).sort((a, b) => b.estValue - a.estValue || b.foodValue - a.foodValue || b.date.localeCompare(a.date) || b.openMin - a.openMin);
}

/** Team figures per day for the trend: drinks per guest, the share of tables with food and no drink, and guests. */
export function teamByDay(orders: readonly Order[], outletIds: readonly string[], dates: readonly string[]) {
  const set = new Set(dates);
  const facts = orders.filter((o) => outletIds.includes(o.outletId) && set.has(o.date)).map(billFacts).filter((f): f is BillFacts => f !== null);
  return dates.map((date) => {
    const t = tally();
    for (const f of facts) if (f.date === date) add(t, f);
    return { date, guests: t.guests, drinks: t.drinks, rate: r2(ratio(t.drinks, t.guests)), noDrinkShare: t.food ? Math.round((t.noDrink / t.food) * 1000) / 1000 : null };
  });
}
