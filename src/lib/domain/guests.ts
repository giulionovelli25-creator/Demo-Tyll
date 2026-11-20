// Hotel guests against outlet charges (overnight feature 7): are in-house guests' meals being charged? The rooms the
// breakfast host ticked in at Mercado are compared with last night's in-house list in the PMS, room by room, and with the
// breakfast bills of that morning. Guests whose rate includes breakfast are never flagged. Beside it, each outlet's sales
// against the guests in house. Pure functions over recorded facts, so the check, the flags and the tests read one rule.
// A breakfast not charged is a prompt to check, never proof of anything.
import { outletById, propertyById } from "../data/catalog";
import type { BreakfastBill, BreakfastEvidence, BreakfastVisit, Exception, InHouseRoom, Order } from "../types";
import { addDays, fmtMoney, fmtTime } from "../util";
import { orderTotals } from "./orders";
import { menuPriceAt } from "./pricing";

/** A rate plan in the PMS and whether breakfast is in the room rate. Breakfast in the rate covers every registered guest. */
export interface RatePlan {
  code: string;
  name: string;
  breakfast: boolean;
}

/** The hotel's rate plans (simulated). About six rooms in ten are on a rate with breakfast. */
export const RATE_PLANS: readonly (RatePlan & { share: number })[] = [
  { code: "BAR-BB", name: "Best available rate, breakfast included", breakfast: true, share: 0.3 },
  { code: "CORP-BB", name: "Corporate rate, breakfast included", breakfast: true, share: 0.22 },
  { code: "PKG-CITY", name: "City break package, breakfast included", breakfast: true, share: 0.08 },
  { code: "BAR-RO", name: "Best available rate, room only", breakfast: false, share: 0.24 },
  { code: "ADV-RO", name: "Advance purchase, room only", breakfast: false, share: 0.16 },
];
export const rateByCode: Record<string, RatePlan> = Object.fromEntries(RATE_PLANS.map((r) => [r.code, r]));
export const hasBreakfast = (code: string | null | undefined) => !!code && !!rateByCode[code]?.breakfast;

/** The rule, agreed with the hotel. Minutes unless said otherwise. */
export const GUEST_RULES = {
  /** Breakfast is served at Mercado and checked there: the host ticks each room in on the in-house list. */
  breakfastOutletId: "lis-terrace",
  /** The menu item a breakfast is rung as. */
  breakfastItemId: "breakfast",
  /** A breakfast service ends before this time. */
  breakfastEnds: 11 * 60,
  /** A breakfast paid at the table: a bill with no room opened from this long before the host's tick... */
  paidBefore: 10,
  /** ...to this long after it. */
  paidAfter: 30,
  /** About 1.6 guests stay in each occupied room, the figure Predictions uses. */
  guestsPerRoom: 1.6,
  /** Outlet sales against occupancy: a day is to look at when sales are this share below what the guests in house usually spend... */
  belowShare: 0.2,
  /** ...and at least this much below it, so a quiet hour at a small outlet is never a finding. */
  belowMin: 150,
  /** "Usually": the same weekday in each of this many weeks before. */
  usualWeeks: 4,
  /** Outlets whose sales follow the guests in house. Banquets and Events sell to event guests, so it is left out. */
  occupancyOutlets: ["lis-terrace", "lis-lobby", "lis-ird"],
} as const;

/** Breakfasts rung on a bill: kept breakfast buffet lines. */
export const breakfastUnits = (o: Order) => o.lines.reduce((s, l) => s + (l.itemId === GUEST_RULES.breakfastItemId && l.state !== "removed_pre" && l.state !== "removed_post" ? l.qty : 0), 0);

/** The breakfast bills of one morning at the breakfast outlet: opened before breakfast ends, with a breakfast on them, not voided. */
export function breakfastBills(orders: readonly Order[], date: string, outletId: string = GUEST_RULES.breakfastOutletId): Order[] {
  return orders.filter((o) => o.outletId === outletId && o.date === date && !o.voided && o.openMin < GUEST_RULES.breakfastEnds && breakfastUnits(o) > 0);
}

/** The price a breakfast is valued at on a morning: the menu price at the breakfast outlet. */
export const breakfastPrice = (date: string, outletId: string = GUEST_RULES.breakfastOutletId) => menuPriceAt(GUEST_RULES.breakfastItemId, outletId, date);

/** What became of one room ticked in at breakfast. Only `notCharged` above zero is flagged. */
export interface BreakfastMatch {
  /** Guests at breakfast whose breakfast is in the room rate. */
  included: number;
  /** Charged to the room on a breakfast bill that morning. */
  charged: number;
  /** Paid at the table on a bill with no room. */
  paid: number;
  notCharged: number;
  rate: string | null;
  registered: number;
  /** Bills that paid for this room's breakfasts. */
  bills: string[];
}

/** The in-house list of one night, room by room. */
export const nightOf = (stays: readonly InHouseRoom[], date: string) => new Map(stays.filter((s) => s.date === date).map((s) => [s.room, s]));

const toCharge = (v: BreakfastVisit, stay: InHouseRoom | undefined) => {
  const included = stay && hasBreakfast(stay.rate) ? Math.min(v.guests, stay.guests) : 0;
  return { included, toCharge: v.guests - included };
};

/**
 * Matches every room ticked in at breakfast with the room's rate and the breakfast bills of that morning, in a fixed order:
 * guests the rate covers, then breakfasts charged to the room, then a bill paid at the table (no room) opened near the
 * tick: a bill for exactly the breakfasts still to charge first, then more, then fewer, the nearest first within each,
 * each bill serving one room. Whatever is left was not charged. A room that is not on last night's
 * list has no rate, so every guest is to charge.
 */
export function matchBreakfast(visits: readonly BreakfastVisit[], stays: readonly InHouseRoom[], orders: readonly Order[]): Map<string, BreakfastMatch> {
  const out = new Map<string, BreakfastMatch>();
  const mornings = new Map<string, BreakfastVisit[]>();
  for (const v of visits) mornings.set(`${v.outletId}|${v.date}`, [...(mornings.get(`${v.outletId}|${v.date}`) ?? []), v]);
  const byNight = new Map<string, Map<string, InHouseRoom>>();
  const night = (date: string) => {
    if (!byNight.has(date)) byNight.set(date, nightOf(stays, date));
    return byNight.get(date)!;
  };
  for (const [k, list] of mornings) {
    const [outletId, date] = k.split("|");
    const list0 = night(addDays(date, -1));
    const bills = breakfastBills(orders, date, outletId);
    const toRoom = new Map<string, Order[]>();
    for (const o of bills) if (o.payment === "room" && o.room) toRoom.set(o.room, [...(toRoom.get(o.room) ?? []), o]);
    const left = new Map<string, number>();
    for (const v of list) {
      const stay = list0.get(v.room);
      const t = toCharge(v, stay);
      const room = toRoom.get(v.room) ?? [];
      const onRoom = room.reduce((s, o) => s + breakfastUnits(o), 0);
      const charged = Math.min(t.toCharge, onRoom);
      out.set(v.id, { included: t.included, charged, paid: 0, notCharged: 0, rate: stay?.rate ?? null, registered: stay?.guests ?? 0, bills: charged > 0 ? room.map((o) => o.id) : [] });
      left.set(v.id, t.toCharge - charged);
    }
    // A breakfast paid at the table: every pairing of a room still to charge with a bill with no room in its window. A bill
    // for exactly the breakfasts left goes first, then one for more, then fewer, and the nearest first within each, so a
    // bill goes to the room ticked in just before it for that many guests.
    const direct = bills.filter((o) => o.payment !== "room");
    const pairs: { v: BreakfastVisit; o: Order; fit: number; gap: number }[] = [];
    for (const v of list) {
      const need = left.get(v.id)!;
      if (!need) continue;
      for (const o of direct) {
        if (o.openMin < v.min - GUEST_RULES.paidBefore || o.openMin > v.min + GUEST_RULES.paidAfter) continue;
        const units = breakfastUnits(o);
        pairs.push({ v, o, fit: units === need ? 0 : units > need ? 1 : 2, gap: Math.abs(o.openMin - v.min) });
      }
    }
    pairs.sort((x, y) => x.fit - y.fit || x.gap - y.gap || x.v.id.localeCompare(y.v.id) || x.o.id.localeCompare(y.o.id));
    const taken = new Set<string>();
    const served = new Set<string>();
    for (const { v, o } of pairs) {
      if (served.has(v.id) || taken.has(o.id)) continue;
      taken.add(o.id);
      served.add(v.id);
      const m = out.get(v.id)!;
      const paid = Math.min(left.get(v.id)!, breakfastUnits(o));
      m.paid = paid;
      m.bills.push(o.id);
      left.set(v.id, left.get(v.id)! - paid);
    }
    for (const v of list) out.get(v.id)!.notCharged = left.get(v.id)!;
  }
  return out;
}

/** Guests at breakfast and how each was covered. Guests = included + charged + paid + not charged, always. */
export interface BreakfastTotals {
  rooms: number;
  guests: number;
  included: number;
  charged: number;
  paid: number;
  notCharged: number;
  notChargedRooms: number;
}
export const emptyBreakfast = (): BreakfastTotals => ({ rooms: 0, guests: 0, included: 0, charged: 0, paid: 0, notCharged: 0, notChargedRooms: 0 });
export function addVisit(t: BreakfastTotals, v: BreakfastVisit, m: BreakfastMatch | undefined): BreakfastTotals {
  if (!m) return t;
  t.rooms += 1;
  t.guests += v.guests;
  t.included += m.included;
  t.charged += m.charged;
  t.paid += m.paid;
  t.notCharged += m.notCharged;
  if (m.notCharged > 0) t.notChargedRooms += 1;
  return t;
}
export const breakfastTotalsOf = (visits: readonly BreakfastVisit[], matches: Map<string, BreakfastMatch>) => visits.reduce((t, v) => addVisit(t, v, matches.get(v.id)), emptyBreakfast());

const guests = (n: number) => `${n} ${n === 1 ? "guest" : "guests"}`;
const breakfasts = (n: number) => `${n} ${n === 1 ? "breakfast" : "breakfasts"}`;
export { guests as guestCount, breakfasts as breakfastCount };
export const rateName = (code: string | null) => (code ? rateByCode[code]?.name ?? code : "Not on last night's in-house list");

const asBill = (o: Order, owner?: string): BreakfastBill => ({ orderId: o.id, openMin: o.openMin, units: breakfastUnits(o), payment: o.payment, ...(o.room ? { room: o.room } : {}), ...(owner ? { matchedTo: owner } : {}) });

/** The room each bill paid for, when it paid at the table or was charged to a room on the list. */
export function billRooms(visits: readonly BreakfastVisit[], matches: ReadonlyMap<string, BreakfastMatch>): Map<string, string> {
  const owner = new Map<string, string>();
  for (const v of visits) for (const id of matches.get(v.id)?.bills ?? []) if (!owner.has(id)) owner.set(id, v.room);
  return owner;
}

/** The evidence for one room with breakfasts not charged: its rate, the bills charged to it and the bills paid at the table nearby. */
export function breakfastEvidence(v: BreakfastVisit, m: BreakfastMatch, orders: readonly Order[], stays: readonly InHouseRoom[], owners: ReadonlyMap<string, string> = new Map()): BreakfastEvidence {
  const bills = breakfastBills(orders, v.date, v.outletId);
  const from = v.min - GUEST_RULES.paidBefore;
  const to = v.min + GUEST_RULES.paidAfter;
  return {
    visitId: v.id, room: v.room, guests: v.guests, rate: m.rate, included: m.included, toCharge: v.guests - m.included,
    charged: bills.filter((o) => m.bills.includes(o.id)).map((o) => asBill(o)),
    notCharged: m.notCharged, price: breakfastPrice(v.date, v.outletId), min: v.min, from, to,
    nearby: bills.filter((o) => o.payment !== "room" && o.openMin >= from && o.openMin <= to && !m.bills.includes(o.id)).sort((a, b) => a.openMin - b.openMin).map((o) => asBill(o, owners.get(o.id))),
    registered: m.registered,
    staysOn: stays.some((s) => s.date === v.date && s.room === v.room),
  };
}

export const breakfastHeadline = (e: Pick<BreakfastEvidence, "room" | "notCharged" | "included">) =>
  e.included > 0 ? `Room ${e.room}: ${breakfasts(e.notCharged)} beyond the rate not charged` : `Room ${e.room}: ${breakfasts(e.notCharged)} not charged`;

/** What the bills paid at the table near the tick say, in one sentence. */
export function nearbyBreakfastFact(e: Pick<BreakfastEvidence, "nearby" | "notCharged" | "from" | "to">): string {
  const window = `from ${fmtTime(e.from)} to ${fmtTime(e.to)}`;
  if (e.nearby.length === 0) return `No breakfast bill was paid at the table ${window}.`;
  const n = e.nearby.length;
  const taken = e.nearby.filter((b) => b.matchedTo).length;
  const opened = `${n} breakfast ${n === 1 ? "bill was" : "bills were"} paid at the table ${window}`;
  if (taken === n) return `${opened}, ${n === 1 ? "and it is" : "and all of them are"} matched to another room on the breakfast list.`;
  return `${opened}: ${taken} matched to another room on the breakfast list, the others for fewer breakfasts than this room had.`;
}

/** One flag per room with breakfasts not charged, valued at the breakfast price that morning. */
export function breakfastException(v: BreakfastVisit, ev: BreakfastEvidence): Exception {
  const outlet = outletById[v.outletId];
  const currency = propertyById[outlet.propertyId].currency;
  const money = (n: number) => fmtMoney(n, currency);
  const value = ev.notCharged * ev.price;
  const rate = ev.rate ? `Last night's rate: ${rateByCode[ev.rate]?.name ?? ev.rate}. ${guests(ev.registered)} registered.` : "The room is not on last night's in-house list.";
  const included = ev.included > 0 ? ` The rate includes breakfast for ${guests(ev.included)}, so ${breakfasts(ev.toCharge)} to charge.` : "";
  const done = ev.toCharge - ev.notCharged;
  return {
    id: `EX-${v.id}`, type: "breakfast_not_charged", propertyId: outlet.propertyId, outletId: v.outletId, date: v.date, min: v.min,
    exposure: value, breakfast: ev,
    headline: breakfastHeadline(ev),
    comparedWith: `Compared with the PMS in-house list and the breakfast bills: the host ticked room ${v.room} in at breakfast at ${outlet.name} at ${fmtTime(v.min)} with ${guests(v.guests)}. ${rate}${included} ${done > 0 ? `Charged or paid that morning: ${breakfasts(done)}.` : `No breakfast was charged to room ${v.room} that morning.`} No breakfast bill paid at the table from ${fmtTime(ev.from)} to ${fmtTime(ev.to)} is left for it. Valued at the breakfast price, ${money(ev.price)}.`,
  };
}

/** Every room with breakfasts not charged, as a flag. */
export function detectBreakfastNotCharged(visits: readonly BreakfastVisit[], stays: readonly InHouseRoom[], orders: readonly Order[], matches = matchBreakfast(visits, stays, orders)): Exception[] {
  const owners = billRooms(visits, matches);
  const out: Exception[] = [];
  for (const v of visits) {
    const m = matches.get(v.id);
    if (!m || m.notCharged <= 0) continue;
    out.push(breakfastException(v, breakfastEvidence(v, m, orders, stays, owners)));
  }
  return out;
}

/** Guests in house on a night: the sum of the guests registered in its rooms. */
export const guestsOn = (stays: readonly InHouseRoom[], date: string) => stays.reduce((s, x) => s + (x.date === date ? x.guests : 0), 0);

/** One outlet on one day: its sales against the guests in house that night. */
export interface OutletDay {
  outletId: string;
  date: string;
  guests: number;
  sales: number;
  /** Sales charged to rooms. */
  toRooms: number;
  /** What the guests in house usually spend here: guests times the sales per guest on the same weekday in the weeks before. Null without history. */
  expected: number | null;
  below: boolean;
}

/** Net sales of an outlet on a day, voided bills left out. */
function salesOf(orders: readonly Order[]) {
  const by = new Map<string, { sales: number; toRooms: number }>();
  for (const o of orders) {
    if (o.voided) continue;
    const k = `${o.outletId}|${o.date}`;
    const cur = by.get(k) ?? { sales: 0, toRooms: 0 };
    const net = orderTotals(o).net;
    cur.sales += net;
    if (o.payment === "room") cur.toRooms += net;
    by.set(k, cur);
  }
  return by;
}

/**
 * Each outlet's sales against the guests in house, day by day. Expected is what the guests in house usually spend there:
 * the guests that night times the outlet's sales per in-house guest on the same weekday in the `usualWeeks` weeks before.
 * A day is to look at when sales fall `belowShare` below it and by at least `belowMin`. An estimate, a prompt to check.
 */
export function outletDays(orders: readonly Order[], stays: readonly InHouseRoom[], outletIds: readonly string[], days: readonly string[]): OutletDay[] {
  const sales = salesOf(orders);
  const guestCache = new Map<string, number>();
  const g = (date: string) => {
    if (!guestCache.has(date)) guestCache.set(date, guestsOn(stays, date));
    return guestCache.get(date)!;
  };
  const out: OutletDay[] = [];
  for (const outletId of outletIds) {
    for (const date of days) {
      const s = sales.get(`${outletId}|${date}`) ?? { sales: 0, toRooms: 0 };
      const rates: number[] = [];
      for (let w = 1; w <= GUEST_RULES.usualWeeks; w++) {
        const d = addDays(date, -7 * w);
        const gd = g(d);
        const sd = sales.get(`${outletId}|${d}`);
        if (gd > 0 && sd) rates.push(sd.sales / gd);
      }
      const guestsNow = g(date);
      const expected = rates.length === GUEST_RULES.usualWeeks && guestsNow > 0 ? (guestsNow * rates.reduce((a, b) => a + b, 0)) / rates.length : null;
      const below = expected !== null && s.sales < expected * (1 - GUEST_RULES.belowShare) && expected - s.sales >= GUEST_RULES.belowMin;
      out.push({ outletId, date, guests: guestsNow, sales: Math.round(s.sales * 100) / 100, toRooms: Math.round(s.toRooms * 100) / 100, expected: expected === null ? null : Math.round(expected * 100) / 100, below });
    }
  }
  return out;
}
