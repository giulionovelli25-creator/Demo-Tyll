// Builds the simulated demo dataset. Deterministic: the same records are produced on every load.
// Everything here is fictional and stands in for what POS, PMS and stock adapters would supply.
import type {
  Arrival, Attendant, CountRecord, DayItem, DayOutlet, Delivery, Exception, GuestRequest, HotelEvent, InvestigationState,
  LiveOrder, OccupancyDay, Order, OrderLine, Outlet, ReservationDay, Room, RoomCharge, RoomStatus, Transfer, WasteLog, WasteReason,
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
  /** Sent to the browser instead of raw order history, for Flow's delay estimates. */
  prepRatios?: Record<string, number>;
}

import { BOUGHT_STORY, HERO_EXCEPTION_ID, HERO_ORDER_ID, ROOM_STORY, ROOM_STORY_EXCEPTION_ID, ROOM_STORY_ORDER_ID, WAITER_STORY } from "./constants";
import { billFacts } from "../domain/waiters";
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
  waiterStory(orders);
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
  const clean = (o: Order) => o.id !== HERO_ORDER_ID && o.id !== ROOM_STORY_ORDER_ID && !o.voided && !o.refund && !o.discountPct && o.lines.every((l) => l.state === "kept");
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

function seedInvestigation(e: Exception): InvestigationState {
  const r = rng(`inv|${e.id}`);
  const code = e.outletId ? OUTLETS.find((o) => o.id === e.outletId)!.code : "";
  const manager = code ? `${code}-S7` : "u-fc";
  const supervisor = code ? `${code}-S6` : "u-fc";
  const age = diffDays(DEMO_TODAY, e.date);
  const roomCharge = e.type.startsWith("room_charge");
  const closed = (): InvestigationState => {
    const outcome = roomCharge
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
    return {
      status: "closed", assigneeId: by, deadline: addDays(e.date, 3), outcome,
      confirmedLoss: outcome === "confirmed_loss" ? e.exposure : 0,
      recovered: outcome === "recovered" ? e.exposure : 0,
      closedAt, closedBy: by, notes: [{ at: closedAt, by, text }],
    };
  };
  if (e.id === HERO_EXCEPTION_ID || e.id === ROOM_STORY_EXCEPTION_ID) return { status: "new", notes: [], confirmedLoss: 0, recovered: 0 };
  if (age > 6) return closed();
  // The front office settles posting differences at the night audit, so only today's are still open. The worked example
  // survived it: nothing failed, the posting simply sat on another guest's folio.
  if (roomCharge && age >= 1) return closed();
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
  const exceptions = [...flagged, ...variances];
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
    ...buildContext(dayOutlets),
    liveOrders: buildLiveOrders(),
    ...buildRooms(),
  };
  return cached;
}

export { LAST_FULL_COUNT, MENU_ITEMS };
