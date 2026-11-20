// Builds the simulated demo dataset. Deterministic: the same records are produced on every load.
// Everything here is fictional and stands in for what POS, PMS and stock adapters would supply.
import type {
  Arrival, Attendant, Booking, BottleIssue, BreakfastVisit, InHouseRoom, CountRecord, DayItem, DayOutlet, Delivery, Exception, GuestRequest, HotelEvent, InvestigationState,
  LiveOrder, OccupancyDay, Order, OrderLine, Outcome, Outlet, ReservationDay, Room, RoomCharge, RoomStatus, Transfer, WasteLog, WasteReason,
} from "../types";
import { DATA_START, DEMO_NOW_MIN, DEMO_TODAY, addDays, diffDays, eachDay, isWeekend, rng, round2, weekday, rel } from "../util";
import { INGREDIENTS, MENU_ITEMS, OUTLETS, PROPERTIES, ingredientById, itemById, outletsOfProperty, propertyById } from "./catalog";
import { detectExceptions } from "../domain/detect";
import { avgDailyUsage, deliveryOvercharge, orderPack, usageFromSales, varianceAllocation, wasteQuantities } from "../domain/inventory";
import { buildRollups, lineValue, orderTotals } from "../domain/orders";
import { ingredientCostAt, menuPriceAt } from "../domain/pricing";

export interface Dataset {
  orders: Order[];
  ordersById: Map<string, Order>;
  dayItems: DayItem[];
  dayOutlets: DayOutlet[];
  roomCharges: RoomCharge[];
  chargesById: Map<string, RoomCharge>;
  exceptions: Exception[];
  seedInvestigations: Record<string, InvestigationState>;
  wasteLogs: WasteLog[];
  counts: CountRecord[];
  deliveries: Delivery[];
  transfers: Transfer[];
  occupancy: OccupancyDay[];
  reservations: ReservationDay[];
  events: HotelEvent[];
  liveOrders: LiveOrder[];
  rooms: Room[];
  arrivals: Arrival[];
  attendants: Attendant[];
  requests: GuestRequest[];
  /** Premium bottles issued to the bar, one for each empty handed back. Server only: the till rule check reads it. */
  bottleIssues: BottleIssue[];
  /** The reservation book, booking by booking, for closed days. Server only: the booked against billed check reads it. */
  bookings: Booking[];
  /** The PMS in-house list, room by room, each night with its rate. Server only: hotel guests against outlet charges reads it. */
  stays: InHouseRoom[];
  /** The rooms the breakfast host ticked in at Mercado each morning. Server only. */
  breakfasts: BreakfastVisit[];
  /** Sent to the browser instead of raw order history, for Flow's delay estimates. */
  prepRatios?: Record<string, number>;
}

import {
  BREAKFAST_EXAMPLE, BREAKFAST_EXAMPLE_EXCEPTION_ID, BREAKFAST_EXAMPLE_VISIT_ID, BREAKFAST_STORY, BREAKFAST_STORY_EXCEPTION_ID, BREAKFAST_STORY_VISIT_ID, BOUGHT_STORY, COVERS_EXAMPLE, COVERS_EXAMPLE_BOOKING_ID, COVERS_EXAMPLE_EXCEPTION_ID, COVERS_STORY, COVERS_STORY_BOOKING_ID, COVERS_STORY_EXCEPTION_ID, HERO_EXCEPTION_ID, HERO_ORDER_ID, MIX_HISTORY, MIX_STORY, MIX_STORY_EXCEPTION_ID, ROOM_STORY, ROOM_STORY_EXCEPTION_ID, ROOM_STORY_ORDER_ID, WAGYU_STORY,
  TILL_PRICE_ORDER_ID, TILL_RING_ORDER_ID, TILL_STORY_EXCEPTION_ID, TILL_STORY_ORDER_ID, WAITER_STORY,
} from "./constants";
import { MIX_LABELS, MIX_OUTLETS, detectMix, perBottle } from "../domain/till-rules";
import { COVER_RULES, detectSeatedNoBill, matchBookings, serviceOf } from "../domain/covers";
import { billFacts } from "../domain/waiters";
import { GUEST_RULES, RATE_PLANS, breakfastBills, breakfastUnits, detectBreakfastNotCharged, hasBreakfast, matchBreakfast } from "../domain/guests";
import { shiftOf } from "../domain/pour";
import { SCENARIOS, buildOutletStock, latestPeriods, type OutletStock } from "./outlet-stock";
import { headlineFor, needsCase, periodVariance } from "../domain/variance";
import { lossLevel } from "../domain/story";
export { HERO_EXCEPTION_ID, HERO_ORDER_ID };
/** From this date the demo story has Mercado drifting: more adjustments and more waste, building week by week. */
const DRIFT_FROM = rel(-21);
const driftLevel = (outletId: string, date: string) =>
  outletId !== "lis-terrace" ? 0 : Math.min(1, Math.max(0, diffDays(date, DRIFT_FROM) / 21)) ** 2;

type Rng = ReturnType<typeof rng>;

const gaussian = (r: Rng) => Math.sqrt(-2 * Math.log(Math.max(r.next(), 1e-9))) * Math.cos(2 * Math.PI * r.next());

const PEAKS: Record<string, [number, number, number][]> = {
  "Fine dining restaurant": [[20 * 60 + 15, 55, 1]],
  "Signature restaurant": [[20 * 60 + 30, 55, 1]],
  "Casual restaurant": [[13 * 60 + 15, 50, 0.4], [20 * 60, 65, 0.6]],
  "All-day dining": [[8 * 60 + 30, 50, 0.3], [13 * 60 + 15, 50, 0.3], [20 * 60, 60, 0.4]],
  "Pool bar": [[13 * 60 + 30, 60, 0.5], [16 * 60 + 30, 70, 0.5]],
  "Lobby lounge": [[10 * 60, 70, 0.35], [16 * 60, 70, 0.35], [21 * 60, 60, 0.3]],
  "In-room dining": [[8 * 60, 50, 0.35], [13 * 60, 60, 0.2], [21 * 60, 70, 0.45]],
  "Rooftop bar": [[21 * 60, 75, 1]],
  "Lobby bar": [[11 * 60, 70, 0.2], [18 * 60 + 30, 70, 0.4], [22 * 60, 70, 0.4]],
  "Banquets and events": [[10 * 60 + 30, 40, 0.25], [13 * 60, 45, 0.4], [20 * 60, 60, 0.35]],
};

const RATE_BY_KIND: Record<string, number> = {
  "Fine dining restaurant": 0.6, "Signature restaurant": 0.6, "Casual restaurant": 1, "All-day dining": 0.9,
  "Pool bar": 1.2, "Lobby lounge": 0.8, "In-room dining": 0.7, "Rooftop bar": 1.25, "Lobby bar": 1.15, "Banquets and events": 0.5,
};

const OK_REMOVE = ["Guest changed order", "Item unavailable", "Entered in error"];
const OK_COMP = ["Service recovery", "Manager's guest", "Birthday dessert"];
const OK_DISCOUNT = ["Loyalty member", "Hotel guest offer", "Staff meal"];
const OK_REFUND = ["Guest complaint", "Charged twice in error"];

function occupancyFor(propertyId: string, date: string): number {
  const p = propertyById[propertyId];
  const r = rng(`occ|${propertyId}|${date}`);
  const season = Math.min(0.08, Math.max(0, diffDays(date, DATA_START)) * 0.0012);
  const base = (propertyId === "lis" ? 0.72 : 0.66) + season + (isWeekend(date, p.city) ? 0.09 : 0) + (weekday(date) === 4 ? 0.03 : 0);
  return Math.min(0.97, Math.max(0.45, base + r.between(-0.04, 0.04)));
}

function sampleOpenMin(o: Outlet, r: Rng): number {
  const [center, spread] = r.weighted(PEAKS[o.kind], (p) => p[2]);
  const t = Math.round(center + gaussian(r) * spread);
  return Math.min(o.closeMin - 20, Math.max(o.openMin, t));
}

function makeOrder(o: Outlet, date: string, seq: number, r: Rng): Order {
  const k = driftLevel(o.id, date);
  const base = RATE_BY_KIND[o.kind];
  const rate = { remove: base * (1 + 3 * k), comp: base * (1 + 8 * k), discount: base * (1 + 8 * k), refund: base * (1 + 5 * k), void: base * (1 + 3 * k) };
  const openMin = sampleOpenMin(o, r);
  const evening = openMin >= 18 * 60;
  const servers = [1, 2, 3, 4, 5].map((n) => `${o.code}-S${n}`);
  const supervisor = `${o.code}-S6`;
  const manager = `${o.code}-S7`;
  const staffId = r.pick(servers);

  const nLines = Math.max(1, Math.round(o.linesPerOrder * r.between(0.45, 1.55)));
  const picked = new Map<string, number>();
  for (let i = 0; i < nLines; i++) {
    const m = r.weighted(o.menu, (e) => e.weight);
    picked.set(m.itemId, (picked.get(m.itemId) ?? 0) + 1);
  }
  const lines: OrderLine[] = [...picked].map(([itemId, qty]) => {
    const it = itemById[itemId];
    const second = it.category === "Desserts" || (it.category === "Coffee" && r.chance(0.5));
    const enteredMin = openMin + (second ? r.int(22, 40) : r.int(1, 4));
    const sentMin = enteredMin + 1;
    return {
      itemId, qty, unitPrice: menuPriceAt(itemId, o.id, date), state: "kept", enteredMin, sentMin,
      completedMin: it.station === "kitchen" ? sentMin + Math.max(3, Math.round(it.prepMinutes * r.between(0.75, 1.35))) : undefined,
    };
  });
  const isBar = o.kind.includes("bar") || o.kind.includes("lounge");
  const lastActivity = Math.max(...lines.map((l) => l.completedMin ?? l.sentMin ?? l.enteredMin));
  const closeMin = Math.max(lastActivity + r.int(6, isBar ? 30 : 45), openMin + r.int(isBar ? 18 : 35, isBar ? 55 : 95));
  const room = String(r.int(3, 24) * 100 + r.int(1, 28));
  const payment = r.chance(o.roomChargeShare) ? "room" : r.chance(0.86) ? "card" : "cash";
  const order: Order = {
    id: `${o.code}-${date.slice(5, 7)}${date.slice(8, 10)}-${String(seq).padStart(3, "0")}`,
    outletId: o.id, date, openMin, closeMin, covers: Math.max(1, Math.round(nLines / 2.2)), staffId,
    table: o.kind === "In-room dining" ? `Room ${room}` : `Table ${r.int(1, 42)}`,
    lines, discountPct: 0, payment, room: payment === "room" || o.kind === "In-room dining" ? room : undefined,
  };

  // Lines removed before they were sent: ordinary corrections, never flagged.
  if (r.chance(0.03) && lines.length > 1) {
    const l = r.pick(lines);
    l.state = "removed_pre";
    l.removedMin = l.enteredMin;
    l.removedBy = staffId;
    l.reason = "Entered in error";
    l.sentMin = undefined;
    l.completedMin = undefined;
  }

  // Lines removed after they were sent for preparation.
  if (r.chance(0.009 * rate.remove)) {
    const candidates = lines.filter((l) => l.state === "kept");
    const cheap = [...candidates].sort((a, b) => lineValue(a) - lineValue(b));
    const l = r.chance(0.6) ? cheap[0] : r.pick(candidates);
    if (l && candidates.length > 1) {
      l.state = "removed_post";
      l.removedMin = (l.sentMin ?? l.enteredMin) + r.int(3, 16);
      // In the drift period most unexplained removals at Mercado sit under two evening logins.
      l.removedBy = k > 0 && evening && r.chance(0.72) ? (r.chance(0.55) ? `${o.code}-S2` : `${o.code}-S4`) : staffId;
      if (r.chance(0.45 - 0.25 * k)) {
        l.reason = r.pick(OK_REMOVE);
        l.approvedBy = r.pick([supervisor, manager]);
      }
      if (r.chance(0.12)) {
        const other = candidates.find((x) => x !== l && x.state === "kept");
        if (other && candidates.length > 2 && !l.approvedBy) {
          other.state = "removed_post";
          other.removedMin = l.removedMin;
          other.removedBy = l.removedBy;
        }
      }
    }
  }

  // Complimentary items.
  if (r.chance(0.012)) {
    const l = r.pick(lines.filter((x) => x.state === "kept"));
    if (l && lines.filter((x) => x.state === "kept").length > 1) {
      l.state = "comped";
      l.reason = r.pick(OK_COMP);
      l.approvedBy = r.pick([supervisor, manager]);
    }
  } else if (r.chance(0.0025 * rate.comp)) {
    const kept = lines.filter((x) => x.state === "kept").sort((a, b) => lineValue(b) - lineValue(a));
    if (kept.length > 1) {
      kept[0].state = "comped";
      if (r.chance(0.4)) kept[0].approvedBy = supervisor;
    }
  }

  // Discounts.
  if (r.chance(0.05)) {
    order.discountPct = r.pick([10, 10, 15, 20]);
    order.discountReason = r.pick(OK_DISCOUNT);
    order.discountApprovedBy = r.pick([supervisor, manager]);
  } else if (r.chance(0.003 * rate.discount)) {
    order.discountPct = r.pick([30, 40, 50, 20]);
    if (r.chance(0.35)) order.discountReason = "Guest relations";
    if (r.chance(0.3)) order.discountApprovedBy = supervisor;
  }

  const t = orderTotals(order);
  // Refunds after payment.
  if (t.net > 60 && r.chance(0.0035)) {
    order.refund = { amount: round2(t.net * r.pick([0.15, 0.2, 0.25])), min: closeMin + r.int(2, 15), reason: r.pick(OK_REFUND), approvedBy: manager };
  } else if (t.net > 60 && r.chance(0.0012 * rate.refund)) {
    order.refund = { amount: round2(t.net * r.pick([0.6, 0.8, 1])), min: closeMin + r.int(35, 120), reason: r.chance(0.3) ? "Guest complaint" : undefined, approvedBy: r.chance(0.3) ? supervisor : undefined };
  }
  // Whole-order voids after dispatch.
  if (!order.refund && r.chance(0.001 * rate.void)) {
    order.voided = { min: closeMin - 1, reason: r.chance(0.25) ? "Guest left" : undefined };
    order.discountPct = 0;
    order.discountReason = undefined;
    order.discountApprovedBy = undefined;
  }
  return order;
}

function heroOrder(): Order {
  const t = (h: number, m: number) => h * 60 + m;
  return {
    id: HERO_ORDER_ID, outletId: "lis-terrace", date: DEMO_TODAY, openMin: t(20, 42), closeMin: t(20, 51), covers: 1,
    staffId: "MER-S2", table: "Table 14", discountPct: 0, payment: "card",
    lines: [
      { itemId: "burger", qty: 1, unitPrice: menuPriceAt("burger", "lis-terrace", DEMO_TODAY), state: "kept", enteredMin: t(20, 42), sentMin: t(20, 43), completedMin: t(20, 50) },
      { itemId: "coke", qty: 1, unitPrice: menuPriceAt("coke", "lis-terrace", DEMO_TODAY), state: "removed_post", enteredMin: t(20, 42), sentMin: t(20, 43), removedMin: t(20, 49), removedBy: "MER-S2" },
    ],
  };
}

/** The room charge worked example: a dinner for three at Mercado last night, signed to room 1412. */
function roomStoryOrder(): Order {
  const t = (h: number, m: number) => h * 60 + m;
  const date = rel(-1);
  const line = (itemId: string, qty: number, entered: number, prep?: number): OrderLine => ({
    itemId, qty, unitPrice: menuPriceAt(itemId, "lis-terrace", date), state: "kept", enteredMin: entered, sentMin: entered + 1, completedMin: prep === undefined ? undefined : entered + 1 + prep,
  });
  return {
    id: ROOM_STORY_ORDER_ID, outletId: "lis-terrace", date, openMin: t(19, 48), closeMin: t(21, 4), covers: 3,
    staffId: "MER-S3", table: "Table 22", discountPct: 0, payment: "room", room: ROOM_STORY.room,
    lines: [
      line("mezze", 1, t(19, 52), 9),
      line("sparkling", 2, t(19, 52)),
      line("lambchops", 2, t(20, 5), 19),
      line("risotto", 1, t(20, 5), 17),
      line("fondant", 2, t(20, 41), 12),
    ],
  };
}

/** Bills built for a story, never touched by the simulated till events below. */
const STORY_ORDERS = new Set<string>();

/**
 * The till rule worked example (TILL_STORY_ORDER_ID): last night at Mercado a table of three paid cash at 10:07 PM. At
 * 10:31 PM the bill was reopened under the same login, the two lamb chops came off and it closed again at 10:33 PM, with
 * no reason and no manager's approval. The lamb chops were marked ready by the kitchen before the guests paid.
 */
function tillStoryOrder(): Order {
  const t = (h: number, m: number) => h * 60 + m;
  const date = rel(-1);
  const line = (itemId: string, qty: number, entered: number, prep?: number): OrderLine => ({
    itemId, qty, unitPrice: menuPriceAt(itemId, "lis-terrace", date), state: "kept", enteredMin: entered, sentMin: entered + 1, completedMin: prep === undefined ? undefined : entered + 1 + prep,
  });
  const lines = [line("mezze", 1, t(21, 1), 9), line("sparkling", 2, t(21, 1)), line("lambchops", 2, t(21, 14), 19), line("salmon", 1, t(21, 14), 16)];
  const order: Order = { id: TILL_STORY_ORDER_ID, outletId: "lis-terrace", date, openMin: t(20, 58), closeMin: t(22, 7), covers: 3, staffId: "MER-S3", table: "Table 9", discountPct: 0, payment: "cash", lines };
  const paid = orderTotals(order).net;
  Object.assign(lines[2], { state: "removed_post", removedMin: t(22, 32), removedBy: "MER-S3" });
  order.reopened = { min: t(22, 31), closedMin: t(22, 33), by: "MER-S3", paid };
  return order;
}

/** Two days ago at In-Room Dining: two salmon dinners charged at a price changed by hand, well below the menu. Checked since. */
function tillPriceOrder(): Order {
  const t = (h: number, m: number) => h * 60 + m;
  const o = "lis-ird";
  const date = rel(-2);
  const salmon = menuPriceAt("salmon", o, date);
  return {
    id: TILL_PRICE_ORDER_ID, outletId: o, date, openMin: t(12, 38), closeMin: t(13, 31), covers: 2, staffId: "IRD-S2", table: "Room 1608", discountPct: 0, payment: "card", room: "1608",
    lines: [
      { itemId: "salmon", qty: 2, unitPrice: 18, state: "kept", enteredMin: t(12, 41), sentMin: t(12, 42), completedMin: t(12, 59), till: { kind: "override", menuPrice: salmon } },
      { itemId: "oj", qty: 2, unitPrice: menuPriceAt("oj", o, date), state: "kept", enteredMin: t(12, 41), sentMin: t(12, 42) },
    ],
  };
}

/** Two days ago at Bar Azulejo: twelve cappuccinos in one entry, on a bill for two guests. Checked since. */
function tillRingOrder(): Order {
  const t = (h: number, m: number) => h * 60 + m;
  const o = "lis-lobby";
  const date = rel(-2);
  return {
    id: TILL_RING_ORDER_ID, outletId: o, date, openMin: t(11, 18), closeMin: t(11, 52), covers: 2, staffId: "AZU-S3", table: "Table 6", discountPct: 0, payment: "card",
    lines: [
      { itemId: "cappuccino", qty: 12, unitPrice: menuPriceAt("cappuccino", o, date), state: "kept", enteredMin: t(11, 20), enteredSec: 14, sentMin: t(11, 21) },
      { itemId: "cheesecake", qty: 2, unitPrice: menuPriceAt("cheesecake", o, date), state: "kept", enteredMin: t(11, 20), enteredSec: 31, sentMin: t(11, 21), completedMin: t(11, 27) },
    ],
  };
}

/**
 * How often the simulated till does something the till rules look at, per bill. Most of these are ordinary (a tip added
 * after payment, a price raised for an extra shot, two coffees for two guests rung one by one) and are never flagged; a
 * minority break a rule. Small rates: a hotel this size sees a handful of each a month.
 */
export const TILL_RATES = { reopen: 0.0012, price: 0.004, splitPair: 0.01, twice: 0.0007, quantity: 0.0003 } as const;

/** A tip added after payment, in the words of how the bill was paid. The total of the bill does not change. */
const TIP_CHANGE: Record<Order["payment"], string> = {
  card: "Tip added to the card payment",
  cash: "Cash tip recorded on the bill",
  room: "Tip added to the room charge",
};

/** Items whose units feed a pinned story (Coca-Cola, Over pouring's wine and cocktails, the premium serves) are never changed in number. */
const PINNED_UNITS = new Set(["coke", "wine", "mojito", "martini", "winepkg", "reserve", "gintonic", "gintonic2"]);

/**
 * Simulated till events on ordinary bills, from their own random stream so every bill drawn before is unchanged. Only
 * whole, untouched bills take one (nothing removed, comped, discounted, refunded or voided, never a story bill), at most
 * one each. Mercado's evening bills are left alone, because the drinks per guest story is built from them, and no drink
 * at Mercado changes in number for the same reason.
 */
export function tillEvents(orders: Order[]): void {
  for (const o of orders) {
    if (STORY_ORDERS.has(o.id) || o.id === HERO_ORDER_ID || o.id === ROOM_STORY_ORDER_ID) continue;
    if (o.voided || o.refund || o.discountPct || o.lines.some((l) => l.state !== "kept")) continue;
    if (o.outletId === WAITER_STORY.outletId && shiftOf(o.openMin) === WAITER_STORY.shift) continue;
    const r = rng(`till|${o.date}|${o.outletId}|${o.id.slice(-3)}`);
    const code = OUTLETS.find((x) => x.id === o.outletId)!.code;
    const unitSafe = (l: OrderLine) => !PINNED_UNITS.has(l.itemId) && !(o.outletId === "lis-terrace" && itemById[l.itemId].dept === "beverage");
    let roll = r.next();
    const take = (p: number) => { const hit = roll < p; roll -= p; return hit; };

    if (take(TILL_RATES.reopen)) {
      const paid = orderTotals(o).net;
      const safe = o.lines.filter(unitSafe).sort((a, b) => lineValue(b) - lineValue(a));
      const variant = r.weighted(["down", "approved", "tip"] as const, (x) => ({ down: 0.5, approved: 0.25, tip: 0.25 })[x]);
      const min = o.closeMin + r.int(8, 45);
      if (variant === "tip" || o.payment === "room" || o.lines.length < 2 || !safe[0]) {
        o.reopened = { min, closedMin: min + 1, by: o.staffId, paid, change: TIP_CHANGE[o.payment] };
        continue;
      }
      const l = safe[0];
      Object.assign(l, { state: "removed_post", removedMin: min + 1, removedBy: o.staffId });
      if (variant === "approved") Object.assign(l, { reason: r.pick(["Dish sent back, charged in error", "Charged to the wrong table"]), approvedBy: `${code}-S7` });
      o.reopened = { min, closedMin: min + 2, by: variant === "approved" ? `${code}-S6` : o.staffId, paid, ...(variant === "approved" ? { reason: l.reason, approvedBy: l.approvedBy } : {}) };
      continue;
    }

    if (take(TILL_RATES.price)) {
      const l = r.pick(o.lines);
      const menu = l.unitPrice;
      const variant = r.weighted(["below", "approved", "small", "up"] as const, (x) => ({ below: 0.4, approved: 0.25, small: 0.15, up: 0.2 })[x]);
      const kind = r.pick(["open_item", "misc", "override"] as const);
      if (variant === "up") {
        l.unitPrice = menu + r.int(1, 3);
        l.till = { kind: "override", menuPrice: menu, reason: r.pick(["Extra shot", "Large", "Extra side"]) };
      } else if (variant === "small") {
        const price = Math.ceil(menu * 0.92);
        if (price >= menu) continue;
        l.unitPrice = price;
        l.till = { kind, menuPrice: menu };
      } else {
        l.unitPrice = Math.max(1, Math.round(menu * r.pick([0.5, 0.6, 0.65, 0.7])));
        l.till = { kind, menuPrice: menu };
        if (variant === "approved") Object.assign(l.till, { reason: r.pick(["Dish changed at the guest's request", "Half portion"]), approvedBy: `${code}-S6` });
      }
      continue;
    }

    if (take(TILL_RATES.splitPair)) {
      // Two of the same for two guests, rung one by one seconds apart: ordinary, never flagged.
      const i = o.lines.findIndex((l) => l.qty === 2 && o.covers >= 2);
      if (i < 0) continue;
      const l = o.lines[i];
      const sec = r.int(0, 50);
      l.qty = 1;
      l.enteredSec = sec;
      o.lines.splice(i + 1, 0, { ...l, enteredSec: sec + r.int(2, 8) });
      continue;
    }

    if (take(TILL_RATES.twice)) {
      const l = o.lines.find((x) => unitSafe(x) && x.qty >= o.covers);
      if (!l) continue;
      const sec = r.int(0, 50);
      l.enteredSec = sec;
      // The second entry sends a ticket of its own; the kitchen display shows one marked ready.
      o.lines.push({ itemId: l.itemId, qty: 1, unitPrice: l.unitPrice, state: "kept", enteredMin: l.enteredMin, enteredSec: sec + r.int(2, 8), sentMin: l.sentMin });
      continue;
    }

    if (take(TILL_RATES.quantity)) {
      const l = o.lines.find((x) => unitSafe(x) && x.qty === 1);
      if (!l || o.covers > 3) continue;
      l.qty = r.pick([10, 11, 12]);
    }
  }
}

/** The premium serves Bar Azulejo sells, added to bar bills that already have a drink, from their own random stream. */
export const MIX_SALES = { reserve: 0.045, gintonic: 0.06, gintonic2: 0.018 } as const;

function barMix(orders: Order[]): void {
  for (const o of orders) {
    if (!MIX_OUTLETS.includes(o.outletId) || STORY_ORDERS.has(o.id) || o.voided || o.refund || o.discountPct || o.reopened) continue;
    if (!o.lines.some((l) => l.state === "kept" && itemById[l.itemId].dept === "beverage")) continue;
    const r = rng(`mix|${o.date}|${o.outletId}|${o.id.slice(-3)}`);
    for (const [itemId, p] of Object.entries(MIX_SALES)) {
      if (!r.chance(p)) continue;
      const qty = itemId === "gintonic" ? r.int(1, 2) : r.chance(0.2) ? 2 : 1;
      const entered = Math.min(o.closeMin - 3, o.openMin + r.int(2, 30));
      o.lines.push({ itemId, qty, unitPrice: menuPriceAt(itemId, o.outletId, o.date), state: "kept", enteredMin: entered, sentMin: entered + 1 });
    }
  }
}

/**
 * Premium bottles issued to the bar: the bar hands back each empty for a full one, so a bottle is issued on the day one
 * runs out. What is poured is what was billed, a little spillage, and the story's serves that were not billed as premium.
 */
function buildBottleIssues(orders: readonly Order[]): BottleIssue[] {
  const out: BottleIssue[] = [];
  const days = eachDay({ from: DATA_START, to: DEMO_TODAY });
  for (const outletId of MIX_OUTLETS) {
    const poured = new Map<string, number>();
    for (const o of orders) {
      if (o.outletId !== outletId || o.voided) continue;
      for (const l of o.lines) {
        if (l.state === "removed_pre") continue;
        for (const m of MIX_LABELS) {
          const units = l.itemId === m.premiumItemId ? (m.rule === "double" ? 2 : 1) : m.rule === "double" && l.itemId === m.cheapItemId ? 1 : 0;
          if (units) poured.set(`${m.id}|${o.date}`, (poured.get(`${m.id}|${o.date}`) ?? 0) + units * l.qty);
        }
      }
    }
    for (const m of MIX_LABELS) {
      const per = perBottle(m);
      // The bar starts with a bottle half used.
      let cum = per / 2;
      for (const date of days) {
        let units = (poured.get(`${m.id}|${date}`) ?? 0) * 1.02;
        if (outletId === MIX_STORY.outletId && m.id === MIX_STORY.labelId && date >= rel(-MIX_STORY.days) && date <= rel(-1)) units += MIX_STORY.extraPerDay;
        const histTo = rel(-1 - 7 * MIX_HISTORY.week);
        if (outletId === MIX_HISTORY.outletId && m.id === MIX_HISTORY.labelId && date >= addDays(histTo, -6) && date <= histTo) units += MIX_HISTORY.extraPerDay;
        const before = Math.floor(cum / per);
        cum += units;
        const bottles = Math.floor(cum / per) - before;
        if (bottles > 0) out.push({ outletId, date, labelId: m.id, bottles });
      }
    }
  }
  return out;
}

function buildOrders(): Order[] {
  const orders: Order[] = [];
  const days = eachDay({ from: DATA_START, to: DEMO_TODAY });
  for (const o of OUTLETS) {
    const p = propertyById[o.propertyId];
    for (const date of days) {
      const r = rng(`orders|${o.id}|${date}`);
      const occ = occupancyFor(p.id, date);
      const dow = isWeekend(date, p.city) ? 1.17 : weekday(date) === 4 ? 1.07 : 1;
      const n = Math.round(o.baseOrders * dow * (0.62 + 0.5 * occ) * r.between(0.93, 1.07));
      for (let i = 1; i <= n; i++) {
        const order = makeOrder(o, date, i, r);
        // Today only holds orders already closed by the demo clock time.
        if (date === DEMO_TODAY && order.closeMin > DEMO_NOW_MIN) continue;
        orders.push(order);
      }
    }
  }
  orders.push(heroOrder(), roomStoryOrder());
  const stories = [tillStoryOrder(), tillPriceOrder(), tillRingOrder()];
  for (const o of stories) STORY_ORDERS.add(o.id);
  orders.push(...stories);
  waiterStory(orders);
  // After the drinks per guest story, so the bills it moves between logins are exactly as before.
  tillEvents(orders);
  barMix(orders);
  return orders;
}

/**
 * The drinks per guest story (WAITER_STORY). Inside each Mercado evening, some of the story waiter's bills with food and
 * drinks change login with a colleague's bill with food and no drink from the same evening. Only whole, untouched bills
 * move (nothing removed, comped, discounted, refunded or voided, and never a worked example), and only the login changes,
 * so sales, guests, stock, flags and over pouring are exactly as before. Exported for the test that pins this.
 */
export function waiterStory(orders: Order[]): void {
  const S = WAITER_STORY;
  const clean = (o: Order) => o.id !== HERO_ORDER_ID && o.id !== ROOM_STORY_ORDER_ID && !STORY_ORDERS.has(o.id) && !o.voided && !o.refund && !o.discountPct && o.lines.every((l) => l.state === "kept");
  const byDate = new Map<string, Order[]>();
  for (const o of orders) {
    if (o.outletId !== S.outletId || shiftOf(o.openMin) !== S.shift || !clean(o)) continue;
    byDate.set(o.date, [...(byDate.get(o.date) ?? []), o]);
  }
  for (const [date, list] of byDate) {
    const r = rng(`waiter-story|${date}`);
    const shuffle = <T,>(xs: T[]) => xs.map((x) => ({ x, k: r.next() })).sort((a, b) => a.k - b.k).map((y) => y.x);
    const his = shuffle(list.filter((o) => { const f = billFacts(o); return o.staffId === S.staffId && !!f && f.food && f.drinks > 0; }));
    // A colleague's bill with food and no drink. `noDrink` already leaves out any bill with the breakfast buffet (it includes
    // coffee and juice), so no buffet bill reaches the story waiter's evening tables.
    const theirs = shuffle(list.filter((o) => o.staffId !== S.staffId && !!billFacts(o)?.noDrink));
    const k = Math.min(theirs.length, Math.floor(his.length * S.share + r.next()));
    for (const mine of his.slice(0, k)) {
      // A bill for the same number of guests where there is one, so each login's guests stay much as they were.
      const i = Math.max(0, theirs.findIndex((o) => o.covers === mine.covers));
      const other = theirs.splice(i, 1)[0];
      if (!other) break;
      [mine.staffId, other.staffId] = [other.staffId, mine.staffId];
    }
  }
}

/**
 * How often a room charge fails to match the guest bill. An interfaced till and PMS lose very few postings, so these stay
 * small: about one charge in two hundred, and room charges a minority of the flagged bills (pinned by a test).
 */
export const ROOM_RATES = {
  missing: { outlet: 0.0008, minibar: 0.003, spa: 0.002, laundry: 0.002 },
  duplicate: 0.0004,
  amount: 0.0015,
  /** A room number keyed one key off at an outlet till. */
  wrongRoom: 0.0008,
  afterCheckout: { minibar: 0.008, breakfast: 0.0015 },
} as const;

/** A room number one slip of the keyboard away: the last two digits swapped, or the last digit one off. */
function neighbourRoom(room: string, r: Rng): string {
  const floor = room.slice(0, -2);
  const swapped = `${room.at(-1)}${room.at(-2)}`;
  if (swapped !== room.slice(-2) && Number(swapped) >= 1 && Number(swapped) <= 28) return `${floor}${swapped}`;
  const n = Number(room.slice(-2));
  return `${floor}${String(n >= 28 ? n - 1 : n <= 1 ? n + 1 : n + (r.chance(0.5) ? 1 : -1)).padStart(2, "0")}`;
}

/**
 * The PMS side of a charge: when the posting reached the folio, the room it landed on and, for guests who have left,
 * when they checked out. A separate random stream, so the postings drawn before are unchanged.
 */
function withFolio(c: RoomCharge): RoomCharge {
  const r = rng(`folio|${c.id}`);
  let postedMin = c.min + r.int(0, 2);
  // About one guest in four leaves the morning after the charge. Tonight's guests have not left yet.
  let checkoutMin = c.date < DEMO_TODAY && r.chance(0.25) ? 24 * 60 + r.int(7 * 60, 11 * 60 + 45) : undefined;
  if (c.orderId === ROOM_STORY_ORDER_ID) return { ...c, posted: [c.expected], folioRoom: ROOM_STORY.folioRoom, postedMin: c.min + 1, checkoutMin: ROOM_STORY.checkoutMin };
  const clean = c.posted.length === 1 && c.posted[0] === c.expected;
  if (!clean) return { ...c, postedMin, checkoutMin };
  // A room number keyed by hand at an outlet till, one key off.
  if (c.source === "restaurant" && r.chance(ROOM_RATES.wrongRoom)) return { ...c, postedMin, checkoutMin, folioRoom: neighbourRoom(c.room, r) };
  if (c.source === "minibar" && c.min < 13 * 60 && r.chance(ROOM_RATES.afterCheckout.minibar)) {
    // Housekeeping found the minibar used when servicing a departure room, after the guest had gone. Rooms are serviced
    // late morning, and guests leave between 7 AM and noon, so only charges recorded before 1 PM can arrive this way.
    // Charges start at 8 AM, so check-out is always at least 15 minutes before the posting.
    checkoutMin = Math.min(12 * 60, Math.max(7 * 60, c.min - r.int(15, 150)));
  } else if ((c.source === "restaurant" || c.source === "room_service") && c.min < 11 * 60 && r.chance(ROOM_RATES.afterCheckout.breakfast)) {
    // A breakfast posting held in the interface queue while the guest checked out.
    postedMin = c.min + r.int(75, 200);
    checkoutMin = c.min + r.int(10, postedMin - c.min - 5);
  }
  return { ...c, postedMin, checkoutMin };
}

function buildRoomCharges(orders: Order[]): RoomCharge[] {
  const out: RoomCharge[] = [];
  // The interface between the tills and the PMS rarely fails (ROOM_RATES).
  const posted = (expected: number, r: Rng, missRate: number): number[] => {
    if (r.chance(missRate)) return [];
    if (r.chance(ROOM_RATES.duplicate)) return [expected, expected];
    if (r.chance(ROOM_RATES.amount)) return [round2(expected * r.pick([0.5, 0.75, 0.9, 1.1]))];
    return [expected];
  };
  for (const o of orders) {
    if (o.payment !== "room" || o.voided) continue;
    const t = orderTotals(o);
    if (t.net <= 0) continue;
    const outlet = OUTLETS.find((x) => x.id === o.outletId)!;
    const r = rng(`charge|${o.id}`);
    out.push({
      id: `RC-${o.id}`, propertyId: outlet.propertyId, outletId: o.outletId, date: o.date, min: o.closeMin, room: o.room!,
      source: outlet.kind === "In-room dining" ? "room_service" : "restaurant", description: `${outlet.name} check ${o.id}`,
      orderId: o.id, expected: t.net, posted: posted(t.net, r, ROOM_RATES.missing.outlet),
    });
  }
  // Minibar, spa and laundry postings over the whole history, so every period and its trend compares like with like.
  for (const p of PROPERTIES) {
    for (const date of eachDay({ from: DATA_START, to: DEMO_TODAY })) {
      const r = rng(`svc|${p.id}|${date}`);
      const mk = (source: RoomCharge["source"], n: number, lo: number, hi: number, label: string, miss: number) => {
        for (let i = 1; i <= n; i++) {
          const min = r.int(8 * 60, 21 * 60);
          if (date === DEMO_TODAY && min > DEMO_NOW_MIN) continue;
          const expected = Math.round(r.between(lo, hi));
          out.push({
            id: `RC-${p.id.toUpperCase()}-${source.slice(0, 2).toUpperCase()}-${date.slice(5, 7)}${date.slice(8, 10)}-${i}`,
            propertyId: p.id, date, min, room: String(r.int(3, 24) * 100 + r.int(1, 28)), source, description: label,
            expected, posted: posted(expected, r, miss),
          });
        }
      };
      mk("minibar", r.int(16, 26), 5, 35, "Minibar consumption recorded by housekeeping", ROOM_RATES.missing.minibar);
      mk("spa", r.int(5, 10), 70, 240, "Spa treatment", ROOM_RATES.missing.spa);
      mk("laundry", r.int(4, 9), 12, 65, "Laundry and pressing", ROOM_RATES.missing.laundry);
    }
  }
  return out.map(withFolio);
}

const OUTCOMES: readonly Outcome[] = ["legitimate", "confirmed_loss", "recovered", "inconclusive"];
/** How the till rule cases of the past were closed: the likely outcomes and what the manager wrote. */
const TILL_CLOSING: Partial<Record<Exception["type"], { weights: Record<Outcome, number>; text: Record<Outcome, string | string[]> }>> = {
  bill_reopened: {
    weights: { legitimate: 0.45, confirmed_loss: 0.35, recovered: 0.15, inconclusive: 0.05 },
    text: {
      legitimate: "A manager confirmed the change: the dish was sent back and had been charged in error. The approval was added afterwards.",
      confirmed_loss: "The items taken off had been served. Recorded as a loss, and the reopen rule repeated at the shift briefing.",
      recovered: "The guest was still in house. The items were charged to the room with the guest's agreement.",
      inconclusive: "Nobody on shift remembered the table. Closed without a finding.",
    },
  },
  price_override: {
    weights: { legitimate: 0.5, confirmed_loss: 0.3, recovered: 0.15, inconclusive: 0.05 },
    text: {
      legitimate: "The manager on duty had agreed the price at the table. The approval was added afterwards.",
      confirmed_loss: "Charged below the menu without agreement. Recorded as a loss; open prices now need a manager's code at this till.",
      recovered: "The guest was still in house. The difference was added to the room bill with the guest's agreement.",
      inconclusive: "No record of who agreed the price. Closed without a finding.",
    },
  },
  // The value of an item rung twice is what the guest was charged in error: a refund gives the guest's money back, it is
  // not money the hotel lost or recovered (GUEST_CHARGE_TYPES), so these close as legitimate, with what was done.
  duplicate_ring: {
    weights: { legitimate: 0.85, confirmed_loss: 0, recovered: 0, inconclusive: 0.15 },
    text: {
      legitimate: [
        "Checked with the table: everything on the bill was served.",
        "The guest had been charged for one too many. The extra was refunded to the guest before they left, so nothing was lost or recovered.",
      ],
      confirmed_loss: "",
      recovered: "",
      inconclusive: "The guest had left and nobody on shift could say. Closed without a finding.",
    },
  },
  // A seated table with no bill: most turn out to be a party that paid on another table's bill. Recovered only when the
  // booking was made by a hotel guest (the meal can go on the room); see `closingOf`.
  seated_no_bill: {
    weights: { legitimate: 0.55, confirmed_loss: 0.15, recovered: 0.2, inconclusive: 0.1 },
    text: {
      legitimate: [
        "The party joined friends at another table and paid on that bill. Checked with the server.",
        "The host had marked the wrong booking as seated. The bill for the table was under the walk-in's name.",
      ],
      confirmed_loss: "The table was served and left without paying. Recorded as a loss; the host now checks for a bill before marking a table finished.",
      recovered: "The guests were staying in the hotel. The meal was added to their room with their agreement.",
      inconclusive: "Nobody on shift remembered the table. Closed without a finding.",
    },
  },
  // A breakfast not charged: most are posted to the room before the guest checks out.
  breakfast_not_charged: {
    weights: { legitimate: 0.15, confirmed_loss: 0.2, recovered: 0.6, inconclusive: 0.05 },
    text: {
      legitimate: [
        "The host ticked the wrong room. The guests were from a room with breakfast in the rate.",
        "The manager on duty offered the breakfast after a late check-in. Noted on the guest folio.",
      ],
      confirmed_loss: "The guest had checked out before the breakfast was posted. Recorded as a loss; the host now rings each breakfast to charge before ticking the room in.",
      recovered: "Posted the breakfast to the room before check-out, with the guest's agreement.",
      inconclusive: "Nobody at the breakfast desk remembered the room. Closed without a finding.",
    },
  },
  cheaper_item_rung: {
    weights: { legitimate: 0.3, confirmed_loss: 0.55, recovered: 0, inconclusive: 0.15 },
    text: {
      legitimate: "The bottles went to a private tasting billed on the event's account, not at the bar.",
      confirmed_loss: "Doubles were being rung as singles on busy nights. Coached the bar team on the till keys; recorded as a loss.",
      recovered: "",
      inconclusive: "The bar could not account for the bottles either way. Closed without a finding, and the bar will scan its empties.",
    },
  },
};

/** How a past case of this type closes. A table with no bill can only be recovered on the room of a hotel guest who booked. */
function closingOf(e: Exception) {
  const c = TILL_CLOSING[e.type];
  if (!c || e.type !== "seated_no_bill" || e.booking?.room) return c;
  return { ...c, weights: { ...c.weights, recovered: 0 } };
}

const TILL_EXAMPLES: Record<string, { outcome: Outcome; note: string }> = {
  [BREAKFAST_EXAMPLE_EXCEPTION_ID]: { outcome: "recovered", note: "A friend of the guests joined them for breakfast. The third breakfast was posted to room 1204 with the guest's agreement before check-out." },
  [COVERS_EXAMPLE_EXCEPTION_ID]: { outcome: "legitimate", note: "The four guests joined colleagues who were already seated at another table and paid on their bill. Checked with the server on that section." },
  [`EX-${TILL_PRICE_ORDER_ID}`]: { outcome: "confirmed_loss", note: "Charged below the menu without agreement. Recorded as a loss; open prices now need a manager's code at this till." },
  [`EX-${TILL_RING_ORDER_ID}`]: { outcome: "legitimate", note: "The guests confirmed 12 cappuccinos: colleagues joined them at the table after the order was taken. Everything on the bill was served." },
};

function seedInvestigation(e: Exception): InvestigationState {
  const r = rng(`inv|${e.id}`);
  const code = e.outletId ? OUTLETS.find((o) => o.id === e.outletId)!.code : "";
  const manager = code ? `${code}-S7` : "u-fc";
  const supervisor = code ? `${code}-S6` : "u-fc";
  const age = diffDays(DEMO_TODAY, e.date);
  const roomCharge = e.type.startsWith("room_charge");
  const till = closingOf(e);
  const closed = (): InvestigationState => {
    const outcome = till ? r.weighted(OUTCOMES, (x) => till.weights[x]) : roomCharge
      ? r.weighted(["recovered", "legitimate", "confirmed_loss", "inconclusive"] as const, (x) => ({ recovered: 0.7, legitimate: 0.15, confirmed_loss: 0.12, inconclusive: 0.03 })[x])
      : r.weighted(["legitimate", "confirmed_loss", "recovered", "inconclusive"] as const, (x) => ({ legitimate: 0.3, confirmed_loss: 0.14, recovered: 0.52, inconclusive: 0.04 })[x]);
    const by = r.pick([manager, supervisor]);
    const closedAt = addDays(e.date, Math.min(age, r.int(1, 4)));
    const text = {
      legitimate: "Checked with the team on shift. The correction was valid and the approval was added afterwards.",
      confirmed_loss: "The item was served and could not be charged. Recorded as a loss and discussed at the shift briefing.",
      recovered: e.type === "room_charge_wrong_room" ? "Moved to the right room on the guest folio, and the other guest's bill corrected."
        : e.type === "room_charge_after_checkout" ? "Charged to the card on file as a late charge."
        : roomCharge ? "Posting corrected on the guest bill before check-out." : "Guest was still in house. The item was added back and paid.",
      inconclusive: "No further records available. Closed without a finding.",
    }[outcome];
    const own = till?.text[outcome];
    const said = Array.isArray(own) ? r.pick(own) : own || text;
    return {
      status: "closed", assigneeId: by, deadline: addDays(e.date, 3), outcome,
      confirmedLoss: outcome === "confirmed_loss" ? e.exposure : 0,
      recovered: outcome === "recovered" ? e.exposure : 0,
      closedAt, closedBy: by, notes: [{ at: closedAt, by, text: said }],
    };
  };
  // The checked examples (two till rules, one covers): closed the day after by the outlet's manager, with what they found.
  const example = TILL_EXAMPLES[e.id];
  if (example) {
    const by = `${code}-S7`;
    const closedAt = addDays(e.date, 1);
    return { status: "closed", assigneeId: by, deadline: addDays(e.date, 3), outcome: example.outcome, confirmedLoss: example.outcome === "confirmed_loss" ? e.exposure : 0, recovered: example.outcome === "recovered" ? e.exposure : 0, closedAt, closedBy: by, notes: [{ at: closedAt, by, text: example.note.replace("room 1204", `room ${e.breakfast?.room ?? "1204"}`) }] };
  }
  if (e.id === HERO_EXCEPTION_ID || e.id === ROOM_STORY_EXCEPTION_ID || e.id === TILL_STORY_EXCEPTION_ID || e.id === MIX_STORY_EXCEPTION_ID || e.id === COVERS_STORY_EXCEPTION_ID || e.id === BREAKFAST_STORY_EXCEPTION_ID) return { status: "new", notes: [], confirmedLoss: 0, recovered: 0 };
  if (age > 6) return closed();
  // The front office settles posting differences at the night audit, so only today's are still open. The worked example
  // survived it: nothing failed, the posting simply sat on another guest's folio.
  if (roomCharge && age >= 1) return closed();
  // A breakfast not charged is settled with the front office the same day, before the guest checks out.
  if (e.type === "breakfast_not_charged" && age >= 1) return closed();
  const roll = r.next();
  if (age >= 2 && roll < 0.24) return closed();
  if (age >= 1 && roll < 0.38) {
    return { status: "in_review", assigneeId: manager, deadline: addDays(e.date, 3), notes: [{ at: addDays(e.date, 1), by: manager, text: "Asked the shift supervisor for the paper ticket and the table notes." }], confirmedLoss: 0, recovered: 0 };
  }
  if (age >= 1 && roll < 0.6) return { status: "assigned", assigneeId: r.pick([manager, supervisor]), deadline: addDays(e.date, 3), notes: [], confirmedLoss: 0, recovered: 0 };
  return { status: "new", notes: [], confirmedLoss: 0, recovered: 0 };
}

function buildWaste(): WasteLog[] {
  const out: WasteLog[] = [];
  const meanByKind: Record<string, number> = {
    "Fine dining restaurant": 2.2, "Signature restaurant": 2.1, "Casual restaurant": 3, "All-day dining": 2.9,
    "Pool bar": 1.2, "Lobby lounge": 0.8, "In-room dining": 0.8, "Rooftop bar": 1.1, "Lobby bar": 1, "Banquets and events": 0.6,
  };
  for (const o of OUTLETS) {
    const used = new Map<string, number>();
    for (const m of o.menu) for (const l of itemById[m.itemId].recipe ?? []) used.set(l.ingredientId, (used.get(l.ingredientId) ?? 0) + m.weight * l.qty);
    const pool = [...used.keys()].map((id) => ingredientById[id]);
    for (const date of eachDay({ from: DATA_START, to: DEMO_TODAY })) {
      const r = rng(`waste|${o.id}|${date}`);
      const mean = 1.2 * lossLevel(date) * meanByKind[o.kind] * (date === DEMO_TODAY ? 0.7 : 1);
      const n = Math.max(0, Math.round(mean + gaussian(r) * 0.9));
      for (let i = 1; i <= n; i++) {
        const id = `W-${o.code}-${date.slice(5, 7)}${date.slice(8, 10)}-${i}`;
        const by = r.pick([`${o.code}-S8`, `${o.code}-S9`]);
        const roll = r.next();
        if (roll < 0.16) {
          const g = r.pick(["wineglass", "highball", "plate", "flute", "rocks"]);
          out.push({ id, outletId: o.id, date, ingredientId: g, qty: r.int(1, 5), reason: "breakage", by, synced: true, seq: 0 });
        } else if (roll < 0.28) {
          const m = r.weighted(o.menu.filter((e) => itemById[e.itemId].recipe && itemById[e.itemId].dept === "food" && !e.itemId.startsWith("banq")), (e) => e.weight);
          if (m) out.push({ id, outletId: o.id, date, itemId: m.itemId, qty: r.int(1, 3), reason: r.pick<WasteReason>(["waste", "waste", "other"]), by, synced: true, seq: 0 });
        } else {
          const g = r.weighted(pool, (x) => (x.shelfLifeDays <= 7 ? 5 : 1) * Math.sqrt(used.get(x.id) ?? 0.01));
          const scale = Math.min(1.6, 30 / g.cost);
          const qty = g.unit === "each" ? r.int(3, 18) : Math.round(r.between(0.25, 2.2) * scale * 100) / 100;
          const reason = r.weighted<WasteReason>(["spoilage", "waste", "damaged", "other"], (x) => ({ spoilage: 0.45, waste: 0.4, damaged: 0.1, other: 0.05, breakage: 0, expired: 0 })[x]);
          out.push({ id, outletId: o.id, date, ingredientId: g.id, qty: Math.max(0.05, qty), reason, by, synced: true, seq: 0 });
        }
      }
    }
  }
  // Banquets make food for the guests booked, and some of it comes back. Yesterday's conference dinner is the worked example.
  for (const date of eachDay({ from: DATA_START, to: addDays(DEMO_TODAY, -1) })) {
    const r = rng(`overmade|${date}`);
    const big = date === addDays(DEMO_TODAY, -1);
    if (!big && !r.chance(0.3)) continue;
    const itemId = big ? "banqdinner" : r.chance(0.7) ? "banqlunch" : "banqdinner";
    const qty = big ? 40 : Math.round(r.between(14, 26) * lossLevel(date));
    out.push({ id: `W-BQT-${date.slice(5, 7)}${date.slice(8, 10)}-OP`, outletId: "lis-banquets", date, itemId, qty, reason: "waste", by: "BQT-S8", synced: true, seq: 0 });
  }
  return out;
}

const LAST_FULL_COUNT = rel(-2);
const TERRACE_HEAVY = ["wagyu", "hammour", "coke", "potato", "brioche", "mozzarella", "chicken"];

/**
 * The Coca-Cola story's extra cases delivered to a hotel up to a date. They sit in the main store, so the store's
 * book stock includes them and the weekly counts find them on the shelf: the counts and the bought against used check agree.
 */
function storyOnShelf(deliveries: readonly Delivery[], propertyId: string, date: string): number {
  if (propertyId !== "lis") return 0;
  return deliveries.filter((d) => d.propertyId === propertyId && d.status === "delivered" && d.supplierId === "bev" && d.date >= rel(BOUGHT_STORY.fromDay) && d.date <= date)
    .reduce((s, d) => s + (d.lines.some((l) => l.ingredientId === BOUGHT_STORY.ingredientId) ? BOUGHT_STORY.extraPerDelivery : 0), 0);
}

function buildCounts(orders: Order[], dayItems: DayItem[], deliveries: readonly Delivery[]): CountRecord[] {
  const out: CountRecord[] = [];
  // Quantities on tickets that were sent for preparation and then removed without approval, by property and day.
  const leak = new Map<string, number>();
  for (const o of orders) {
    for (const l of o.lines) {
      if (l.state !== "removed_post" || l.approvedBy) continue;
      const pid = OUTLETS.find((x) => x.id === o.outletId)!.propertyId;
      for (const rl of itemById[l.itemId].recipe ?? []) {
        const k = `${pid}|${o.date}|${rl.ingredientId}`;
        leak.set(k, (leak.get(k) ?? 0) + rl.qty * l.qty);
      }
    }
  }
  const sundays = eachDay({ from: DATA_START, to: LAST_FULL_COUNT }).filter((d) => weekday(d) === 0);
  for (const p of PROPERTIES) {
    const avg = avgDailyUsage(dayItems, p.id);
    for (const date of sundays) {
      const full = date === LAST_FULL_COUNT || date === rel(-30);
      const weekUsage = usageFromSales(dayItems, (r) => r.date > addDays(date, -7) && r.date <= date && propertyById[OUTLETS.find((o) => o.id === r.outletId)!.propertyId].id === p.id);
      for (const g of INGREDIENTS) {
        if (!g.priority && !full) continue;
        const r = rng(`count|${p.id}|${date}|${g.id}`);
        const daily = avg.get(g.id) ?? 0;
        if (g.dept === "glassware") {
          const expected = r.int(180, 420);
          out.push({ id: `C-${p.id}-${date}-${g.id}`, propertyId: p.id, ingredientId: g.id, date, kind: "weekly", expected, counted: expected - r.int(0, 6), by: `${outletsOfProperty(p.id)[1].code}-S9`, seq: 0, allocation: {} });
          continue;
        }
        if (daily === 0) continue;
        const expected = daily * r.between(2.3, 3.4);
        let leaked = 0;
        for (let i = 0; i < 7; i++) leaked += leak.get(`${p.id}|${addDays(date, -i)}|${g.id}`) ?? 0;
        // Items Mercado uses most go missing faster as its drift builds.
        const drifting = p.id === "lis" && TERRACE_HEAVY.includes(g.id) ? 0.06 * driftLevel("lis-terrace", date) : 0;
        const shrink = (weekUsage.get(g.id) ?? 0) * (r.between(0.02, 0.08) + drifting) + leaked * 0.75 - (r.chance(0.15) ? daily * 0.05 : 0);
        const precision = g.unit === "each" ? 1 : 100;
        const shelf = g.id === BOUGHT_STORY.ingredientId ? storyOnShelf(deliveries, p.id, date) : 0;
        const counted = Math.max(0, Math.round((expected - shrink) * precision) / precision) + shelf;
        out.push({
          id: `C-${p.id}-${date}-${g.id}`, propertyId: p.id, ingredientId: g.id, date, kind: "weekly",
          expected: Math.round(expected * precision) / precision + shelf, counted, by: `${outletsOfProperty(p.id)[1].code}-S9`, seq: 0,
          allocation: varianceAllocation(dayItems, p.id, g.id, date),
        });
      }
    }
    // Housekeeping supplies, counted in the storeroom at the last full count. Amenity kits are running low.
    if (p.id === "lis") {
      for (const [id, qty] of [["amenity", 60], ["towel", 420], ["chem", 38]] as const) {
        out.push({ id: `C-${p.id}-${LAST_FULL_COUNT}-${id}`, propertyId: p.id, ingredientId: id, date: LAST_FULL_COUNT, kind: "weekly", expected: qty, counted: qty, by: "HK-09", seq: 0, allocation: {} });
      }
    }
    // Daily spot checks on a few items, up to the day before the last full count.
    for (const date of eachDay({ from: addDays(LAST_FULL_COUNT, -14), to: addDays(LAST_FULL_COUNT, -1) })) {
      if (weekday(date) === 0) continue;
      const r = rng(`spot|${p.id}|${date}`);
      const pool = INGREDIENTS.filter((g) => (avg.get(g.id) ?? 0) > 0);
      for (let i = 0; i < 4; i++) {
        const g = r.pick(pool);
        const daily = avg.get(g.id)!;
        const precision = g.unit === "each" ? 1 : 100;
        const shelf = g.id === BOUGHT_STORY.ingredientId ? storyOnShelf(deliveries, p.id, date) : 0;
        const expected = Math.round(daily * r.between(1.2, 3) * precision) / precision + shelf;
        const counted = Math.max(0, Math.round((expected - shelf - daily * r.between(-0.01, 0.035)) * precision) / precision) + shelf;
        const id = `C-${p.id}-${date}-${g.id}-spot`;
        if (out.some((c) => c.id === id)) continue;
        out.push({ id, propertyId: p.id, ingredientId: g.id, date, kind: "spot", expected, counted, by: `${outletsOfProperty(p.id)[1].code}-S9`, seq: 0, allocation: varianceAllocation(dayItems, p.id, g.id, date) });
      }
    }
  }
  return out;
}

const SUPPLIER_DAYS: Record<string, (wd: number) => boolean> = {
  meat: () => true, sea: () => true, produce: () => true, bakery: () => true,
  dry: (wd) => wd === 1 || wd === 4, bev: (wd) => wd === 2 || wd === 5, wine: (wd) => wd === 2 || wd === 5, ware: () => false,
};
const SUPPLIER_COVER: Record<string, number> = { meat: 1.02, sea: 1.02, produce: 1.02, bakery: 1.02, dry: 3.6, bev: 3.6, wine: 3.6, ware: 0 };

function buildDeliveries(dayItems: DayItem[]): Delivery[] {
  const out: Delivery[] = [];
  for (const p of PROPERTIES) {
    const avg = avgDailyUsage(dayItems, p.id);
    // What each item still needs, carried from one delivery to the next. A slow item is ordered in whole packs only when
    // a pack is due, so over the month the hotel buys about what it uses instead of a pack every day.
    const owed = new Map<string, number>();
    // Suppliers confirm the next day's delivery; anything later is still to be ordered.
    for (const date of eachDay({ from: addDays(DEMO_TODAY, -29), to: addDays(DEMO_TODAY, 1) })) {
      for (const supplierId of Object.keys(SUPPLIER_DAYS)) {
        if (!SUPPLIER_DAYS[supplierId](weekday(date))) continue;
        const r = rng(`delivery|${p.id}|${date}|${supplierId}`);
        const future = date > DEMO_TODAY;
        // Carnes Ribeiro & Filhos could not confirm chicken for Lisbon tomorrow.
        const lines = INGREDIENTS.filter((g) => g.supplierId === supplierId && (avg.get(g.id) ?? 0) > 0 && !(p.id === "lis" && g.id === "chicken" && date === addDays(DEMO_TODAY, 1))).map((g) => {
          // Before the last full count a slow item waits until a whole pack is due. From the count on, the store orders at
          // least a pack of everything it uses, so the stock estimate since that count is what it always was.
          const carried = date < LAST_FULL_COUNT;
          const want = avg.get(g.id)! * SUPPLIER_COVER[supplierId] * r.between(0.94, 1.08) + (carried ? owed.get(g.id) ?? 0 : 0);
          const pack = orderPack(g);
          const ordered = carried ? Math.max(0, Math.round(want / pack) * pack) : Math.max(pack, Math.round(want / pack) * pack);
          if (carried) owed.set(g.id, want - ordered);
          const poPrice = round2(ingredientCostAt(g.id, date) * p.costFactor);
          let delivered = ordered;
          let invoicePrice = poPrice;
          if (!future && r.chance(0.035)) delivered = Math.max(0, ordered - pack * r.int(1, 2));
          if (!future && r.chance(0.03)) invoicePrice = round2(poPrice * r.pick([1.03, 1.05, 1.08]));
          const invoiced = delivered < ordered && r.chance(0.6) ? ordered : delivered;
          return { ingredientId: g.id, ordered, delivered: future ? 0 : delivered, invoiced: future ? 0 : invoiced, poPrice, invoicePrice };
        }).filter((l) => l.ordered > 0);
        if (lines.length === 0) continue;
        // The worked examples: yesterday's beef came 4 kg short but was invoiced in full, and two days ago
        // Mercearia Lusa invoiced €180 above what was delivered.
        if (p.id === "lis" && supplierId === "meat" && date === addDays(DEMO_TODAY, -1)) {
          const beef = lines.find((l) => l.ingredientId === "tenderloin");
          if (beef) Object.assign(beef, { ordered: 20, delivered: 16, invoiced: 20, invoicePrice: beef.poPrice });
          // The 30 kg of chicken for Thursday's conference came with the same delivery (issued today as T-7).
          const chicken = lines.find((l) => l.ingredientId === "chicken");
          if (chicken) for (const k of ["ordered", "delivered", "invoiced"] as const) chicken[k] += 30;
        }
        // Late delivery story (lib/server/late-delivery.ts): today's meat delivery came with no Wagyu mince, and the supplier
        // did not charge it. Goods in recorded the difference (a saved record, seeded on the server), and the 5 kg are owed
        // with tomorrow's delivery, so tomorrow's lunch depends on that delivery arriving on time.
        if (p.id === "lis" && supplierId === WAGYU_STORY.supplierId && date === DEMO_TODAY) {
          const wagyu = lines.find((l) => l.ingredientId === WAGYU_STORY.ingredientId);
          if (wagyu) wagyu.invoiced = 0;
        }
        if (p.id === "lis" && supplierId === WAGYU_STORY.supplierId && date === addDays(DEMO_TODAY, 1)) {
          const wagyu = lines.find((l) => l.ingredientId === WAGYU_STORY.ingredientId);
          if (wagyu) wagyu.ordered += WAGYU_STORY.owed;
        }
        // Bought against used: a standing order adds three cases of Coca-Cola to every drinks delivery, whatever the bars
        // need. The cases go into the main store, where the weekly counts find them (see storyOnShelf).
        if (p.id === "lis" && supplierId === "bev" && !future && date >= rel(BOUGHT_STORY.fromDay)) {
          let coke = lines.find((l) => l.ingredientId === BOUGHT_STORY.ingredientId);
          if (!coke) {
            const price = round2(ingredientCostAt(BOUGHT_STORY.ingredientId, date) * p.costFactor);
            lines.push((coke = { ingredientId: BOUGHT_STORY.ingredientId, ordered: 0, delivered: 0, invoiced: 0, poPrice: price, invoicePrice: price }));
          }
          for (const k of ["ordered", "delivered", "invoiced"] as const) coke[k] += BOUGHT_STORY.extraPerDelivery;
        }
        if (p.id === "lis" && supplierId === "dry" && date <= addDays(DEMO_TODAY, -2) && date >= addDays(DEMO_TODAY, -4)) {
          const l = lines.find((x) => x.ingredientId === "parmesan") ?? lines[0];
          if (l.delivered > 0) Object.assign(l, { invoiced: l.delivered, invoicePrice: round2(l.poPrice + 180 / l.delivered) });
        }
        const delivery: Delivery = { id: `PO-${p.id.toUpperCase()}-${date.slice(5, 7)}${date.slice(8, 10)}-${supplierId.toUpperCase()}`, propertyId: p.id, supplierId, date, status: future ? "expected" : "delivered", lines };
        // Since the hotel started checking invoices with Tyll, most older differences have been credited by the supplier.
        const over = deliveryOvercharge(delivery);
        if (over > 0 && diffDays(DEMO_TODAY, date) >= 6 && r.chance(0.8)) delivery.credit = { amount: round2(over), date: addDays(date, r.int(3, 5)) };
        out.push(delivery);
      }
    }
  }
  return out;
}

function buildTransfers(): Transfer[] {
  return [
    { id: "T-1", propertyId: "lis", ingredientId: "wine", date: rel(-1), qty: 4.5, direction: "out", counterparty: "Banqueting", outletId: "lis-banquets" },
    { id: "T-2", propertyId: "lis", ingredientId: "chicken", date: rel(0), qty: 6, direction: "out", counterparty: "Staff restaurant" },
    { id: "T-3", propertyId: "lis", ingredientId: "coke", date: rel(0), qty: 48, direction: "in", counterparty: "Banqueting", outletId: "lis-banquets" },
    { id: "T-7", propertyId: "lis", ingredientId: "chicken", date: rel(0), qty: 30, direction: "out", counterparty: "Banqueting, for Thursday's conference dinner", outletId: "lis-banquets" },
    { id: "T-6", propertyId: "lis", ingredientId: "lobster", date: rel(0), qty: 3, direction: "out", counterparty: "Banqueting, for Thursday's conference dinner", outletId: "lis-banquets" },
  ];
}

function buildContext(dayOutlets: DayOutlet[]): { occupancy: OccupancyDay[]; reservations: ReservationDay[]; events: HotelEvent[] } {
  const occupancy: OccupancyDay[] = [];
  const reservations: ReservationDay[] = [];
  const horizon = eachDay({ from: DATA_START, to: addDays(DEMO_TODAY, 7) });
  for (const p of PROPERTIES) for (const date of horizon) occupancy.push({ propertyId: p.id, date, occupancy: occupancyFor(p.id, date), forecast: date > DEMO_TODAY });
  const covers = new Map<string, number>();
  for (const d of dayOutlets) covers.set(`${d.outletId}|${d.date}`, (covers.get(`${d.outletId}|${d.date}`) ?? 0) + d.covers);
  for (const o of OUTLETS.filter((x) => x.reservable)) {
    const p = propertyById[o.propertyId];
    for (const date of horizon) {
      const r = rng(`res|${o.id}|${date}`);
      const share = o.kind.includes("ining restaurant") || o.kind === "Signature restaurant" ? 0.72 : 0.38;
      const past = covers.get(`${o.id}|${date}`);
      const typical = o.baseOrders * (o.linesPerOrder / 2.2) * (isWeekend(date, p.city) ? 1.17 : 1) * (0.62 + 0.5 * occupancyFor(p.id, date));
      reservations.push({ outletId: o.id, date, covers: Math.round((date < DEMO_TODAY && past ? past : typical) * share * r.between(0.9, 1.1)), forecast: date > DEMO_TODAY });
    }
  }
  const events: HotelEvent[] = [
    { id: "EV-1", propertyId: "lis", date: rel(2), name: "Regional sales conference dinner", attendance: 180 },
  ];
  return { occupancy, reservations, events };
}

/**
 * How often the simulated reservation book holds something the covers check looks at. Per booking: a party one guest
 * bigger or smaller than booked, a party seated at another table than the one booked, two bookings seated together on
 * one bill. Per outlet and day: a party that left before ordering, and a seated booking whose table never got a bill
 * (rare: two or three a month, most of them explained when checked).
 */
export const BOOKING_RATES = { sizeChange: 0.12, moved: 0.05, joined: 0.03, leftEarlyPerDay: 0.2, noBillPerDay: 0.12, noShowShare: 0.06, cancelledPerDay: 2 } as const;
const VIA: Booking["via"][] = ["phone", "online", "online", "concierge"];

/** A table at the outlet with no bill opened from `from` to `to` that day: the first free one of `prefer`. */
function freeTable(bills: readonly Order[], date: string, outletId: string, from: number, to: number, prefer: readonly number[]): string {
  const busy = new Set(bills.filter((o) => o.outletId === outletId && o.date === date && o.openMin >= from - 120 && o.openMin <= to).map((o) => o.table));
  const n = prefer.find((t) => !busy.has(`Table ${t}`)) ?? prefer[0];
  return `Table ${n}`;
}

/**
 * The reservation book of each outlet that takes bookings, for every closed day. Built from that day's lunch and dinner
 * bills, from its own random stream, so no bill changes: most bookings are a bill's party (sometimes a guest more or
 * less), seated a few minutes before the bill was opened. Booked covers each day add up exactly to the reservation book
 * figure Predictions uses (`ReservationDay`): the bookings that sat down plus the no-shows. Breakfast is hotel guests
 * walking in, so it takes no bookings. A few seated bookings have no bill (the stories and `noBillPerDay`), and a few
 * parties leave before ordering; neither changes a bill.
 */
function buildBookings(orders: readonly Order[], reservations: readonly ReservationDay[]): Booking[] {
  const out: Booking[] = [];
  const target = new Map(reservations.map((r) => [`${r.outletId}|${r.date}`, r.covers]));
  const byDay = new Map<string, Order[]>();
  for (const o of orders) byDay.set(`${o.outletId}|${o.date}`, [...(byDay.get(`${o.outletId}|${o.date}`) ?? []), o]);
  const days = eachDay({ from: DATA_START, to: rel(-1) });
  for (const outlet of OUTLETS.filter((x) => x.reservable)) {
    for (const date of days) {
      const r = rng(`book|${outlet.id}|${date}`);
      const mmdd = `${date.slice(5, 7)}${date.slice(8, 10)}`;
      let seq = 0;
      let left = target.get(`${outlet.id}|${date}`) ?? 0;
      const bills = byDay.get(`${outlet.id}|${date}`) ?? [];
      const add = (b: Omit<Booking, "id" | "outletId" | "date" | "service" | "via"> & { id?: string; via?: Booking["via"] }) => {
        const booking: Booking = { id: b.id ?? `BK-${outlet.code}-${mmdd}-${String(++seq).padStart(2, "0")}`, outletId: outlet.id, date, service: serviceOf(b.bookedFor), via: b.via ?? r.pick(VIA), ...b } as Booking;
        out.push(booking);
        if (booking.status !== "cancelled") left -= booking.party;
        return booking;
      };
      const roomOf = () => (r.chance(0.3) ? String(r.int(3, 24) * 100 + r.int(1, 28)) : undefined);
      const quarter = (min: number) => Math.round(min / 15) * 15;

      // The worked example (last night) and the checked example (two days ago): seated, and no bill at the table.
      for (const st of [{ ...COVERS_STORY, id: COVERS_STORY_BOOKING_ID }, { ...COVERS_EXAMPLE, id: COVERS_EXAMPLE_BOOKING_ID, room: undefined }]) {
        if (outlet.id !== st.outletId || date !== rel(st.date)) continue;
        const table = freeTable(orders, date, outlet.id, st.seatedMin - COVER_RULES.beforeSeat, st.leftMin, st.tables);
        add({ id: st.id, party: st.party, table, bookedFor: st.bookedFor, status: "seated", seatedMin: st.seatedMin, leftMin: st.leftMin, via: "phone", room: st.room });
      }
      // A seated table with no bill, rarely, and a party that left before ordering.
      const extra = (stay: [number, number], party: [number, number]) => {
        const dinner = r.chance(0.65);
        const seatedMin = dinner ? r.int(19 * 60 + 15, 21 * 60 + 30) : r.int(12 * 60 + 30, 14 * 60);
        add({ party: r.int(party[0], party[1]), table: `Table ${r.int(1, 42)}`, bookedFor: quarter(seatedMin - r.int(0, 12)), status: "seated", seatedMin, leftMin: seatedMin + r.int(stay[0], stay[1]), room: roomOf() });
      };
      if (r.chance(BOOKING_RATES.noBillPerDay)) extra([55, 120], [2, 5]);
      if (r.chance(BOOKING_RATES.leftEarlyPerDay)) extra([6, COVER_RULES.leftEarly - 3], [2, 4]);
      // No-shows: a share of the book that never came.
      const noShowGuests = Math.round(left * BOOKING_RATES.noShowShare);
      for (let g = noShowGuests; g > 0;) {
        const party = Math.min(g, r.int(1, 3));
        const at = r.chance(0.65) ? r.int(19 * 60, 21 * 60) : r.int(12 * 60 + 30, 14 * 60);
        add({ party, table: `Table ${r.int(1, 42)}`, bookedFor: quarter(at), status: "no_show", room: roomOf() });
        g -= party;
      }
      // The rest of the book: the parties of lunch and dinner bills, taken in a random order until the day's figure is met.
      const meals = bills.filter((o) => !o.voided && serviceOf(o.openMin) !== "breakfast").map((o) => ({ o, k: r.next() })).sort((a, b) => a.k - b.k).map((x) => x.o);
      for (const o of meals) {
        if (left <= 0) break;
        const seatedMin = o.openMin - r.int(1, 6);
        const leftMin = o.closeMin + r.int(2, 12);
        const bookedFor = quarter(seatedMin - r.int(-8, 12));
        if (o.covers >= 2 && r.chance(BOOKING_RATES.joined)) {
          // Two bookings that sat together and paid on one bill.
          const a = r.int(1, o.covers - 1);
          if (o.covers > left) continue;
          add({ party: a, table: o.table, bookedFor, status: "seated", seatedMin, leftMin, room: roomOf() });
          add({ party: o.covers - a, table: o.table, bookedFor, status: "seated", seatedMin: seatedMin + r.int(0, 8), leftMin, room: roomOf() });
          continue;
        }
        const party = Math.max(1, o.covers + (r.chance(BOOKING_RATES.sizeChange) ? (r.chance(0.5) ? 1 : -1) : 0));
        if (party > left) continue;
        const table = r.chance(BOOKING_RATES.moved) ? `Table ${r.int(1, 42)}` : o.table;
        add({ party, table, bookedFor, status: "seated", seatedMin, leftMin, room: roomOf() });
      }
      // Whatever the bills could not fill is booked and never came, so the day adds up to the reservation book.
      while (left > 0) {
        const party = Math.min(left, 4);
        add({ party, table: `Table ${r.int(1, 42)}`, bookedFor: quarter(r.int(19 * 60, 21 * 60)), status: "no_show", room: roomOf() });
      }
      // Cancellations are in the book, never in its figure.
      for (let i = r.int(0, BOOKING_RATES.cancelledPerDay); i > 0; i--) add({ party: r.int(2, 4), table: `Table ${r.int(1, 42)}`, bookedFor: quarter(r.int(12 * 60 + 30, 21 * 60)), status: "cancelled" });
    }
  }
  return out;
}

/**
 * How the simulated breakfast list and in-house list are drawn (overnight feature 7). Per breakfast bill charged to a room:
 * the share that paid for a guest beyond a rate with breakfast (the rest are room only guests). Per breakfast bill paid at
 * the table: the share from a room only guest in house, and from a guest beyond a rate with breakfast; the rest are outside
 * guests. Per room with breakfast in the rate: the chance its guests come down, and one of them stays in bed. Per morning:
 * a room only room ticked in with nothing charged, and a guest beyond the rate not charged (rare: a few a month).
 */
export const BREAKFAST_RATES = { roomExtra: 0.15, directResident: 0.45, directExtra: 0.08, attend: 0.78, fewer: 0.1, notCharged: 0.1, extraNotCharged: 0.04 } as const;
const ROOM_POOL: string[] = [];
for (let f = 3; f <= 24; f++) for (let n = 1; n <= 28; n++) ROOM_POOL.push(String(f * 100 + n));
const RO_PLANS = RATE_PLANS.filter((p) => !p.breakfast);
const BB_PLANS = RATE_PLANS.filter((p) => p.breakfast);
/** A breakfast bill charged to a room that paid for a guest beyond a rate with breakfast. Both builders read it. */
const extraOnRoom = (o: Order) => rng(`bfx|${o.id}`).chance(BREAKFAST_RATES.roomExtra);
/** The story rooms: the first of the list with no breakfast bill charged to it that morning. */
function storyRoom(orders: readonly Order[], date: string, rooms: readonly string[]): string {
  const charged = new Set(breakfastBills(orders, date).filter((o) => o.payment === "room").map((o) => o.room));
  return rooms.find((r) => !charged.has(r)) ?? rooms[0];
}
/** A tick time with no breakfast bill paid at the table in the window the rule searches: the first of `prefer`, else every 5 minutes. */
function quietTime(direct: readonly Order[], prefer: readonly number[], r?: Rng): number {
  const quiet = (t: number) => !direct.some((o) => o.openMin >= t - GUEST_RULES.paidBefore && o.openMin <= t + GUEST_RULES.paidAfter);
  const hit = prefer.find(quiet);
  if (hit !== undefined) return hit;
  const all: number[] = [];
  for (let t = 6 * 60 + 40; t <= 10 * 60 + 20; t += 5) if (quiet(t)) all.push(t);
  return all.length ? (r ? r.pick(all) : all[0]) : (prefer[0] ?? 6 * 60 + 40);
}

/**
 * The PMS in-house list for every night from the night before the data starts to tonight. Rooms occupied follow the
 * occupancy (250 rooms) and guests add up to 1.6 a room, the figure Predictions uses. Every room charged that night, every
 * room a guest booked a table from and every room with a breakfast bill the next morning is in house, so the records agree:
 * a room with breakfast charged is on a room only rate, or on a rate with breakfast when the bill paid for an extra guest.
 * Its own random streams, so no other record changes.
 */
function buildStays(orders: readonly Order[], charges: readonly RoomCharge[], bookings: readonly Booking[]): { stays: InHouseRoom[]; story: string; example: string } {
  const out: InHouseRoom[] = [];
  const nights = eachDay({ from: addDays(DATA_START, -1), to: DEMO_TODAY });
  const charged = new Map<string, Set<string>>();
  const at = (night: string, room: string) => { if (!charged.has(night)) charged.set(night, new Set()); charged.get(night)!.add(room); };
  // A charge before breakfast ends belongs to a guest who slept there the night before.
  for (const c of charges) at(c.min < GUEST_RULES.breakfastEnds ? addDays(c.date, -1) : c.date, c.room);
  for (const b of bookings) if (b.room) at(b.date, b.room);
  const story = storyRoom(orders, rel(BREAKFAST_STORY.date), BREAKFAST_STORY.rooms);
  const example = storyRoom(orders, rel(BREAKFAST_EXAMPLE.date), BREAKFAST_EXAMPLE.rooms);
  for (const night of nights) {
    const p = PROPERTIES[0];
    const r = rng(`stays|${night}`);
    const occRooms = Math.round(p.rooms * occupancyFor(p.id, night));
    type Pick = { rate?: string; min: number; fixed?: number };
    const forced = new Map<string, Pick>();
    for (const room of charged.get(night) ?? []) forced.set(room, { min: 1 });
    for (const o of breakfastBills(orders, addDays(night, 1))) {
      if (o.payment !== "room" || !o.room) continue;
      const cur = forced.get(o.room) ?? { min: 1 };
      if (cur.rate) { cur.min = Math.max(cur.min, hasBreakfast(cur.rate) ? 1 : breakfastUnits(o)); continue; }
      const extra = extraOnRoom(o);
      forced.set(o.room, { rate: (extra ? r.weighted(BB_PLANS, (x) => x.share) : r.weighted(RO_PLANS, (x) => x.share)).code, min: extra ? 1 : Math.min(3, breakfastUnits(o)) });
    }
    if (night === rel(BREAKFAST_STORY.date - 1) || night === rel(BREAKFAST_STORY.date)) forced.set(story, { rate: BREAKFAST_STORY.rate, min: 1, fixed: BREAKFAST_STORY.registered });
    if (night === rel(BREAKFAST_EXAMPLE.date - 1)) forced.set(example, { rate: BREAKFAST_EXAMPLE.rate, min: 1, fixed: BREAKFAST_EXAMPLE.registered });
    const rooms = new Map(forced);
    const free = ROOM_POOL.filter((x) => !rooms.has(x));
    while (rooms.size < occRooms && free.length) rooms.set(free.splice(r.int(0, free.length - 1), 1)[0], { min: 1 });
    const list = [...rooms].map(([room, f]) => ({
      room, f, rate: f.rate ?? r.weighted(RATE_PLANS, (x) => x.share).code,
      guests: f.fixed ?? Math.max(f.min, r.weighted([1, 2, 3], (g) => (g === 1 ? 0.42 : g === 2 ? 0.53 : 0.05))),
    }));
    // Guests add up to 1.6 a room, as Predictions counts them.
    const target = Math.round(occRooms * GUEST_RULES.guestsPerRoom);
    let total = list.reduce((t, x) => t + x.guests, 0);
    for (let pass = 0; pass < 6 && total !== target; pass++) {
      for (const x of list) {
        if (total === target) break;
        if (x.f.fixed !== undefined) continue;
        if (total > target && x.guests > Math.max(1, x.f.min)) { x.guests -= 1; total -= 1; }
        else if (total < target && x.guests < 3 && r.chance(0.5)) { x.guests += 1; total += 1; }
      }
    }
    for (const x of list.sort((a, b) => Number(a.room) - Number(b.room))) out.push({ propertyId: p.id, date: night, room: x.room, guests: x.guests, rate: x.rate });
  }
  return { stays: out, story, example };
}

/**
 * The breakfast list at Mercado for every morning: the rooms the host ticked in, from last night's in-house list. Built
 * from the breakfast bills, so every bill charged to a room or paid at the table by a hotel guest has its room on the list,
 * and from the rooms with breakfast in the rate, most of whose guests come down. A few rooms are ticked in with nothing
 * charged (`notCharged`, `extraNotCharged`), at a time with no breakfast bill paid at the table near it. This morning holds
 * the worked example only, so the public demo's open list stays short.
 */
function buildBreakfasts(orders: readonly Order[], stays: readonly InHouseRoom[], story: string, example: string): BreakfastVisit[] {
  const out: BreakfastVisit[] = [];
  const outletId = GUEST_RULES.breakfastOutletId;
  const code = OUTLETS.find((o) => o.id === outletId)!.code;
  const byNight = new Map<string, InHouseRoom[]>();
  for (const st of stays) byNight.set(st.date, [...(byNight.get(st.date) ?? []), st]);
  for (const date of eachDay({ from: DATA_START, to: DEMO_TODAY })) {
    const r = rng(`bfast|${date}`);
    const list = new Map((byNight.get(addDays(date, -1)) ?? []).map((x) => [x.room, x]));
    const bills = breakfastBills(orders, date).sort((a, b) => a.openMin - b.openMin || a.id.localeCompare(b.id));
    const day: { room: string; guests: number; min: number; id?: string }[] = [];
    const visiting = new Set<string>();
    const add = (room: string, guests: number, min: number, id?: string) => { visiting.add(room); day.push({ room, guests, min: Math.max(6 * 60 + 30, min), id }); };
    const direct = bills.filter((o) => o.payment !== "room");
    // The worked examples, at a quiet time.
    if (date === rel(BREAKFAST_STORY.date) && list.has(story)) add(story, BREAKFAST_STORY.guests, quietTime(direct, BREAKFAST_STORY.times), BREAKFAST_STORY_VISIT_ID);
    if (date === rel(BREAKFAST_EXAMPLE.date) && list.has(example)) add(example, BREAKFAST_EXAMPLE.guests, quietTime(direct, BREAKFAST_EXAMPLE.times), BREAKFAST_EXAMPLE_VISIT_ID);
    // Breakfasts charged to a room: the room was ticked in a few minutes before its bill opened.
    const toRoom = new Map<string, Order[]>();
    for (const o of bills) if (o.payment === "room" && o.room && list.has(o.room)) toRoom.set(o.room, [...(toRoom.get(o.room) ?? []), o]);
    for (const [room, os] of toRoom) {
      const st = list.get(room)!;
      const units = os.reduce((t, o) => t + breakfastUnits(o), 0);
      add(room, (hasBreakfast(st.rate) ? st.guests : 0) + units, os[0].openMin - r.int(1, 5));
    }
    // Breakfasts paid at the table: some by hotel guests, ticked in just before the bill opened; the rest outside guests.
    for (const o of direct) {
      const x = rng(`bfd|${o.id}`).next();
      const units = breakfastUnits(o);
      const pool = [...list.values()].filter((st) => !visiting.has(st.room) && (x < BREAKFAST_RATES.directResident ? !hasBreakfast(st.rate) && st.guests >= units : hasBreakfast(st.rate)));
      if (x >= BREAKFAST_RATES.directResident + BREAKFAST_RATES.directExtra || pool.length === 0) continue;
      const st = r.pick(pool);
      add(st.room, x < BREAKFAST_RATES.directResident ? units : st.guests + units, o.openMin - r.int(1, 5));
    }
    // Rarely, a room ticked in with nothing charged. Never this morning: it holds the worked example.
    if (date < DEMO_TODAY && r.chance(BREAKFAST_RATES.notCharged)) {
      const pool = [...list.values()].filter((st) => !visiting.has(st.room) && !hasBreakfast(st.rate) && st.guests <= 2);
      if (pool.length) { const st = r.pick(pool); add(st.room, st.guests, quietTime(direct, [], r)); }
    }
    if (date < DEMO_TODAY && r.chance(BREAKFAST_RATES.extraNotCharged)) {
      const pool = [...list.values()].filter((st) => !visiting.has(st.room) && hasBreakfast(st.rate) && st.guests <= 2);
      if (pool.length) { const st = r.pick(pool); add(st.room, st.guests + 1, quietTime(direct, [], r)); }
    }
    // Rooms with breakfast in the rate: most come down, between half past six and half past ten.
    for (const st of list.values()) {
      if (visiting.has(st.room) || !hasBreakfast(st.rate) || !r.chance(BREAKFAST_RATES.attend)) continue;
      const guests = st.guests >= 2 && r.chance(BREAKFAST_RATES.fewer) ? st.guests - 1 : st.guests;
      add(st.room, guests, Math.min(10 * 60 + 30, Math.round(8 * 60 + 20 + gaussian(r) * 55)));
    }
    const mmdd = `${date.slice(5, 7)}${date.slice(8, 10)}`;
    let seq = 0;
    for (const v of day.sort((a, b) => a.min - b.min || a.room.localeCompare(b.room))) {
      out.push({ id: v.id ?? `BF-${code}-${mmdd}-${String(++seq).padStart(3, "0")}`, propertyId: "lis", outletId, date, room: v.room, guests: v.guests, min: v.min });
    }
  }
  return out;
}

function buildLiveOrders(): LiveOrder[] {
  const out: LiveOrder[] = [];
  for (const o of OUTLETS) {
    if (DEMO_NOW_MIN >= o.closeMin || DEMO_NOW_MIN < o.openMin) continue;
    const r = rng(`live|${o.id}`);
    const n = Math.round(o.baseOrders / 9) + r.int(2, 4);
    for (let i = 1; i <= n; i++) {
      for (const station of ["kitchen", "bar"] as const) {
        const pool = o.menu.filter((m) => itemById[m.itemId].station === station);
        if (pool.length === 0 || !r.chance(station === "kitchen" ? 0.75 : 0.6)) continue;
        const picked = new Map<string, number>();
        for (let k = 0, kn = r.int(1, 3); k < kn; k++) {
          const m = r.weighted(pool, (e) => e.weight);
          picked.set(m.itemId, (picked.get(m.itemId) ?? 0) + 1);
        }
        const age = Math.round(r.between(0, station === "kitchen" ? o.targetMinutes * 1.25 : 11));
        const done = age / (station === "kitchen" ? o.targetMinutes : 8);
        const status = done < 0.08 ? "new" : done < 0.2 ? "sent" : done < 0.85 || r.chance(0.35) ? "preparing" : done < 1.1 ? "ready" : "served";
        out.push({
          id: `LIVE-${o.code}-${i}${station === "kitchen" ? "K" : "B"}`, outletId: o.id, station, placedMin: DEMO_NOW_MIN - age, status,
          table: o.kind === "In-room dining" ? `Room ${r.int(3, 24) * 100 + r.int(1, 28)}` : `Table ${r.int(1, 42)}`,
          items: [...picked].map(([itemId, qty]) => ({ itemId, qty })), roomService: o.kind === "In-room dining",
        });
      }
    }
  }
  return out;
}

const GUESTS = ["A. Castellane", "R. Venkataraman", "S. Lindholm", "M. Al Thani", "J. Okonkwo", "P. Duarte", "H. Nakamura", "E. Rossi", "K. Baptiste", "N. Farouki", "T. Brandt", "L. Moreau", "D. Iyer", "C. Whitlock"];
const ATTENDANT_NAMES = ["Rosa M.", "Bina K.", "Thandi N.", "Mariam S.", "Liang W.", "Grace O."];
const ROOM_TYPES = ["Deluxe king", "Deluxe twin", "Club room", "Junior suite", "One-bedroom suite"];

function buildRooms(): { rooms: Room[]; arrivals: Arrival[]; attendants: Attendant[]; requests: GuestRequest[] } {
  const rooms: Room[] = [];
  const arrivals: Arrival[] = [];
  const attendants: Attendant[] = [];
  const requests: GuestRequest[] = [];
  for (const p of PROPERTIES) {
    const r = rng(`rooms|${p.id}`);
    const team = ATTENDANT_NAMES.slice(0, p.id === "lis" ? 6 : 5).map((name, i) => ({ id: `HK-${p.id}-${i + 1}`, propertyId: p.id, name }));
    attendants.push(...team);
    const floors = p.id === "lis" ? [12, 14, 15] : [8, 9, 10];
    for (const floor of floors) {
      for (let n = 1; n <= 12; n++) {
        const number = String(floor * 100 + n);
        const type = n >= 11 ? ROOM_TYPES[4] : n >= 9 ? ROOM_TYPES[3] : r.pick(ROOM_TYPES.slice(0, 3));
        const status = r.weighted<RoomStatus>(["occupied", "departure_due", "dirty", "cleaning", "ready", "out_of_order"], (s) => ({ occupied: 0.42, departure_due: 0.06, dirty: 0.16, cleaning: 0.1, ready: 0.24, out_of_order: 0.02 })[s]);
        const cleanMinutes = type.includes("suite") ? 50 : 32;
        rooms.push({
          id: `${p.id}-${number}`, propertyId: p.id, number, type, status, cleanMinutes, priority: false,
          attendantId: status === "cleaning" ? r.pick(team).id : undefined,
          cleaningStartedMin: status === "cleaning" ? DEMO_NOW_MIN - r.int(6, cleanMinutes - 8) : undefined,
        });
      }
    }
    // The guided example: a suite still being cleaned with its guest 35 minutes away.
    const hero = rooms.find((x) => x.propertyId === p.id && x.type === ROOM_TYPES[4])!;
    Object.assign(hero, { status: "cleaning", attendantId: team[0].id, cleaningStartedMin: DEMO_NOW_MIN - 6, cleanMinutes: 50 });
    const targets = rooms.filter((x) => x.propertyId === p.id && x.id !== hero.id && ["dirty", "cleaning", "ready"].includes(x.status));
    arrivals.push({ id: `ARR-${p.id}-0`, propertyId: p.id, guest: GUESTS[0], room: hero.number, etaMin: DEMO_NOW_MIN + 35, status: "expected", vip: true });
    targets.slice(0, 9).forEach((room, i) => {
      const waiting = room.status !== "ready" && i % 4 === 1;
      arrivals.push({
        id: `ARR-${p.id}-${i + 1}`, propertyId: p.id, guest: GUESTS[(i + 1) % GUESTS.length], room: room.number,
        etaMin: waiting ? DEMO_NOW_MIN - r.int(8, 25) : DEMO_NOW_MIN + r.int(15, 170), status: waiting ? "waiting" : "expected", vip: i === 3,
      });
    });
    const texts: [string, GuestRequest["department"]][] = [
      ["Extra pillows and a baby cot", "housekeeping"], ["Air conditioning not cooling", "engineering"], ["Late check-out tomorrow, 2 PM", "front_office"],
      ["Towels for the pool", "housekeeping"], ["Bill copy to company address", "front_office"],
    ];
    texts.forEach(([text, department], i) => {
      const occupied = rooms.filter((x) => x.propertyId === p.id && x.status === "occupied");
      requests.push({ id: `REQ-${p.id}-${i + 1}`, propertyId: p.id, room: occupied[(i * 3) % occupied.length].number, text, department, raisedMin: DEMO_NOW_MIN - [52, 38, 21, 12, 5][i], done: false });
    });
  }
  return { rooms, arrivals, attendants, requests };
}

let cached: Dataset | null = null;
let outletStock: OutletStock | null = null;

/** Outlet stock periods. Server only: they hold timed sales for every outlet. */
export function getOutletStock(): OutletStock {
  getDataset();
  return outletStock!;
}

/** Usage differences large enough to open a case by themselves. */
function varianceExceptions(stock: OutletStock): Exception[] {
  return latestPeriods(stock.periods).flatMap((p) => {
    const v = periodVariance(p);
    if (!needsCase(v)) return [];
    const code = OUTLETS.find((o) => o.id === p.outletId)!.code;
    return [{
      id: `EX-VAR-${code}-${p.ingredientId.toUpperCase()}-${p.to.date.slice(5).replace("-", "")}`,
      type: "usage_variance" as const, propertyId: p.propertyId, outletId: p.outletId, date: p.to.date, min: p.to.min,
      ingredientId: p.ingredientId, exposure: Math.round(v.value * 100) / 100, headline: headlineFor(p, v), period: p,
      comparedWith: `Compared with sales: the outlet's counts on ${p.from.date} and ${p.to.date} show more used than the recipes of what was sold, after recorded waste and issues.`,
      basis: "estimate" as const,
    }];
  });
}

export function getDataset(): Dataset {
  if (cached) return cached;
  const orders = buildOrders();
  const { dayItems, dayOutlets } = buildRollups(orders);
  const roomCharges = buildRoomCharges(orders);
  // The worked examples assume no waste was recorded for their item at their outlet during the period.
  const wasteLogs = buildWaste().filter((w) => !SCENARIOS.some((s) => w.outletId === s.outletId && w.date >= s.fromDate && w.date <= s.to.date && wasteQuantities(w).some((q) => q.ingredientId === s.ingredientId)));
  outletStock = buildOutletStock(orders, wasteLogs);
  const flagged = detectExceptions(orders, roomCharges);
  const seedInvestigations: Record<string, InvestigationState> = {};
  for (const e of flagged) seedInvestigations[e.id] = seedInvestigation(e);
  // Stock differences found by today's counts are new, except the Wagyu case, which the outlet manager already has.
  const variances = varianceExceptions(outletStock);
  for (const e of variances) {
    seedInvestigations[e.id] = e.ingredientId === "wagyu" && e.outletId === "lis-terrace"
      ? { status: "assigned", assigneeId: "MER-S7", deadline: addDays(DEMO_TODAY, 2), notes: [], confirmedLoss: 0, recovered: 0 }
      : { status: "new", notes: [], confirmedLoss: 0, recovered: 0 };
  }
  // Cheaper item rung up: a week of bottles issued against a week of sales, checked each morning for the week to yesterday.
  const bottleIssues = buildBottleIssues(orders);
  const mixed = detectMix(dayItems, bottleIssues, DEMO_TODAY);
  for (const e of mixed) seedInvestigations[e.id] = seedInvestigation(e);
  // Booked against billed covers: each seated booking on a closed day against the bills at its table.
  const context = buildContext(dayOutlets);
  const bookings = buildBookings(orders, context.reservations);
  const seated = detectSeatedNoBill(bookings, orders, matchBookings(bookings, orders));
  for (const e of seated) seedInvestigations[e.id] = seedInvestigation(e);
  // Hotel guests against outlet charges: each room on the breakfast list against its rate and the breakfast bills.
  const { stays, story, example } = buildStays(orders, roomCharges, bookings);
  const breakfasts = buildBreakfasts(orders, stays, story, example);
  const unpaid = detectBreakfastNotCharged(breakfasts, stays, orders, matchBreakfast(breakfasts, stays, orders));
  for (const e of unpaid) seedInvestigations[e.id] = seedInvestigation(e);
  const exceptions = [...flagged, ...variances, ...mixed, ...seated, ...unpaid];
  const deliveries = buildDeliveries(dayItems);
  cached = {
    orders,
    ordersById: new Map(orders.map((o) => [o.id, o])),
    dayItems,
    dayOutlets,
    roomCharges,
    chargesById: new Map(roomCharges.map((c) => [c.id, c])),
    exceptions,
    seedInvestigations,
    wasteLogs,
    counts: buildCounts(orders, dayItems, deliveries),
    deliveries,
    transfers: buildTransfers(),
    ...context,
    liveOrders: buildLiveOrders(),
    ...buildRooms(),
    bottleIssues,
    bookings,
    stays,
    breakfasts,
  };
  return cached;
}

export { LAST_FULL_COUNT, MENU_ITEMS };
