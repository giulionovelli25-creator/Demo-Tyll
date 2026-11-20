// Rule-based detection of unusual restaurant transactions and room-charge postings.
// Every rule reads recorded facts only. Nothing here decides intent or blame.
import { itemById, outletById, propertyById } from "../data/catalog";
import type { Exception, ExceptionType, Order, OrderLine, RoomCharge } from "../types";
import { addDays, fmtDate, fmtMoney, fmtTime, round2 } from "../util";
import { PRICE_BELOW_SHARE, belowMenu, fmtClock, TILL_PRICE_WORDS, lineValue, orderTotals } from "./orders";
export { belowMenu, fmtClock, TILL_PRICE_WORDS };

/** Thresholds a hotel would agree with Tyll during onboarding. */
export const POLICY = {
  discountMaxPct: 25,
  compMaxValue: 250,
  refundMaxShare: 0.5,
  refundLateMinutes: 30,
  roomChargeTolerance: 0.5,
  patternWindowDays: 14,
  patternMinCases: 5,
  patternMinShare: 0.25,
  /** Till rules (overnight feature 5). A reopened bill whose total fell by more than this, with no manager's approval. */
  reopenMinDrop: 0.5,
  /** An open item, misc line or price changed by hand more than this share below the menu price, with no approval. */
  priceBelowShare: PRICE_BELOW_SHARE,
  /** The same item entered twice within this many seconds, with more of it on the bill than guests at the table. */
  duplicateSeconds: 10,
  /** A quantity far above normal: at least this many of one item on one line, and more than `quantityPerGuest` a guest. */
  quantityMin: 6,
  quantityPerGuest: 3,
};

export const TYPE_LABEL: Record<ExceptionType, string> = {
  removed_after_dispatch: "Removed after it was sent",
  prepared_not_charged: "Prepared, not charged",
  bill_mismatch: "Order and bill differ",
  unusual_discount: "Unusual discount",
  excessive_comp: "Complimentary items",
  unusual_refund: "Unusual refund",
  unexplained_void: "Unexplained void",
  room_charge_missing: "Room charge missing",
  room_charge_duplicate: "Room charge posted more than once",
  room_charge_incorrect: "Room charge amount differs",
  room_charge_wrong_room: "Room charge on the wrong room",
  room_charge_after_checkout: "Room charge after check-out",
  stock_shortfall: "Stock shortfall",
  usage_variance: "Usage above sales",
  bought_not_used: "Bought more than used",
  bill_reopened: "Bill reopened after payment",
  cheaper_item_rung: "Cheaper item rung up",
  price_override: "Open item or price set by hand",
  duplicate_ring: "Rung twice or unusual quantity",
  seated_no_bill: "Seated table with no bill",
  breakfast_not_charged: "Breakfast not charged",
};

export const REMOVAL_TYPES: ExceptionType[] = ["removed_after_dispatch", "prepared_not_charged", "bill_mismatch"];
export const ROOM_TYPES: ExceptionType[] = ["room_charge_missing", "room_charge_duplicate", "room_charge_incorrect", "room_charge_wrong_room", "room_charge_after_checkout"];
/** The till rules: how bills were rung and changed at the till. Shown together on the till rule check (`/money?tab=till`). */
export const TILL_TYPES: ExceptionType[] = ["bill_reopened", "cheaper_item_rung", "price_override", "duplicate_ring"];

/** The till moment of a line, in seconds, when the till recorded seconds. */
const enteredAt = (l: OrderLine) => (l.enteredSec === undefined ? undefined : l.enteredMin * 60 + l.enteredSec);

/**
 * The entries of one item rung in a burst with `start`: every timed line of the same item reached from it by steps of at
 * most `duplicateSeconds`. Lines with no seconds recorded cannot be placed and are left out.
 */
function burstOf(kept: readonly OrderLine[], start: OrderLine): OrderLine[] {
  const timed = kept.filter((l) => l.itemId === start.itemId && enteredAt(l) !== undefined).sort((x, y) => enteredAt(x)! - enteredAt(y)!);
  const groups: OrderLine[][] = [];
  for (const l of timed) {
    const last = groups[groups.length - 1];
    if (last && enteredAt(l)! - enteredAt(last[last.length - 1])! <= POLICY.duplicateSeconds) last.push(l);
    else groups.push([l]);
  }
  return groups.find((g) => g.includes(start)) ?? [start];
}

export type RingFinding =
  /** `total`: how many the entries of the burst add up to, which is what the rule compares with the guests. */
  | { kind: "twice"; first: OrderLine; second: OrderLine; seconds: number; total: number }
  | { kind: "quantity"; line: OrderLine };

/**
 * The duplicate and quantity rule on one bill. Twice: the same item entered twice within `duplicateSeconds`, both still on
 * the bill, with more of it on the bill than guests at the table (two coffees for two guests rung one by one are normal).
 * Quantity: one line of at least `quantityMin`, more than `quantityPerGuest` a guest. The first that applies wins.
 */
export function ringFinding(o: Order): RingFinding | null {
  const kept = o.lines.filter((l) => l.state === "kept");
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const [a, b] = [kept[i], kept[j]];
      const [ta, tb] = [enteredAt(a), enteredAt(b)];
      if (a.itemId !== b.itemId || ta === undefined || tb === undefined) continue;
      const seconds = Math.abs(tb - ta);
      if (seconds > POLICY.duplicateSeconds) continue;
      // Only the entries of this burst count: the same item entered within the window of one another. A second round
      // rung later is ordinary and does not make two coffees for two guests look like one too many.
      const burst = burstOf(kept, a);
      const total = burst.reduce((s, l) => s + l.qty, 0);
      if (total > o.covers) return ta <= tb ? { kind: "twice", first: a, second: b, seconds, total } : { kind: "twice", first: b, second: a, seconds, total };
    }
  }
  const big = kept.find((l) => l.qty >= POLICY.quantityMin && l.qty > POLICY.quantityPerGuest * o.covers);
  return big ? { kind: "quantity", line: big } : null;
}

/** How many of the burst's item the whole bill charges for, a later round included. */
export const ringOnBill = (o: Order, ring: Extract<RingFinding, { kind: "twice" }>) =>
  o.lines.filter((l) => l.state === "kept" && l.itemId === ring.second.itemId).reduce((s, l) => s + l.qty, 0);

/**
 * Flags raised on a day of their own. A 30 day bought against used check did not happen on a day and is raised again
 * each day, so per day charts and "new this week" leave it out; it still counts in open flags and value at risk.
 * Every page that counts flags by day uses this, so the flags page and the Money Back List agree.
 */
export const hasOwnDay = (e: { type: ExceptionType }) => e.type !== "bought_not_used";
export const datedFlags = <T extends { type: ExceptionType }>(list: readonly T[]): T[] => list.filter(hasOwnDay);

/**
 * Flags whose value was charged to the guest, not lost by the hotel: an item rung twice or a quantity keyed too high
 * overcharges the guest, and the remedy is a refund. They are prompts to check like any flag (open flags, value at risk,
 * alerts), but they are never money lost or money recovered, so a refund is never counted as revenue recovered.
 */
export const GUEST_CHARGE_TYPES: ExceptionType[] = ["duplicate_ring"];
export const chargedToGuest = (e: { type: ExceptionType }) => GUEST_CHARGE_TYPES.includes(e.type);

/**
 * The Overview's "Flagged bills" row of money lost and saved: bill cases only. Count cases (`period`) are the stock missing
 * at counts, so bills and counts never count the same money twice; bought against used gaps are estimates a count
 * confirms; and entries charged to the guest in error are the guest's money (see GUEST_CHARGE_TYPES).
 */
export const inBillsLedger = (e: { type: ExceptionType; period?: unknown }) => !e.period && e.type !== "bought_not_used" && !chargedToGuest(e);

const names = (o: Order, pred: (i: number) => boolean) =>
  o.lines
    .filter((_, i) => pred(i))
    .map((l) => itemById[l.itemId].name)
    .join(", ");

export function detectOrderException(o: Order): Exception | null {
  const propertyId = outletById[o.outletId].propertyId;
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);
  const yes = (v: unknown, what: string) => (v ? `${what} recorded` : `no ${what}`);
  const base = { id: `EX-${o.id}`, propertyId, outletId: o.outletId, date: o.date, orderId: o.id, staffId: o.staffId };
  const t = orderTotals(o);

  if (o.voided) {
    if (t.removedPost > 0 && (!o.voided.reason || (!o.voided.approvedBy && !o.approvalsNotInSource))) {
      return { ...base, type: "unexplained_void", min: o.voided.min, exposure: t.removedPost, headline: "Whole order voided after items were sent for preparation",
        comparedWith: `Compared with the void rule: an order voided after items were sent needs a reason and a manager's approval. This void: ${yes(o.voided.reason, "reason")}, ${yes(o.voided.approvedBy, "approval")}.` };
    }
    return null;
  }

  // A bill reopened after payment and closed again lower, with no manager's approval. Checked before removals: the lines
  // taken off after payment are the change, and this rule says so.
  if (o.reopened) {
    const r = o.reopened;
    const drop = round2(r.paid - t.net);
    if (drop > POLICY.reopenMinDrop && !r.approvedBy) {
      const cash = (n: number) => fmtMoney(n, propertyById[propertyId].currency, { decimals: n % 1 !== 0 });
      const after = r.min - o.closeMin;
      return {
        ...base, type: "bill_reopened", staffId: r.by, min: r.min, exposure: drop,
        headline: `Bill reopened ${after} min after payment and closed ${cash(drop)} lower`,
        comparedWith: `Compared with the reopen rule: a bill changed after payment so the total goes down needs a manager's approval. This bill: paid ${cash(r.paid)} by ${o.payment} at ${fmtTime(o.closeMin)}, reopened at ${fmtTime(r.min)}, closed again at ${cash(t.net)} at ${fmtTime(r.closedMin)}, ${yes(r.reason, "reason")}, ${yes(r.approvedBy, "approval")}.`,
      };
    }
  }

  const flagged = o.lines.map((l) => l.state === "removed_post" && !l.approvedBy && !o.approvalsNotInSource);
  const flaggedLines = o.lines.filter((_, i) => flagged[i]);
  if (flaggedLines.length > 0) {
    const exposure = flaggedLines.reduce((s, l) => s + lineValue(l), 0);
    const first = flaggedLines[0];
    const min = first.removedMin ?? o.closeMin;
    const wait = (first.removedMin ?? 0) - (first.sentMin ?? 0);
    const what = names(o, (i) => flagged[i]);
    const station = itemById[first.itemId].station;
    if (flaggedLines.length >= 2) {
      return { ...base, type: "bill_mismatch", staffId: first.removedBy ?? o.staffId, min, exposure, headline: `${flaggedLines.length} items sent for preparation are missing from the final bill`,
        comparedWith: `Compared with the kitchen and bar display: ${flaggedLines.length} items were sent for preparation and are not on the final bill, with no manager approval for removing them.` };
    }
    const prepared = first.completedMin !== undefined && first.completedMin <= (first.removedMin ?? 0);
    return {
      ...base,
      type: prepared ? "prepared_not_charged" : "removed_after_dispatch",
      staffId: first.removedBy ?? o.staffId,
      min,
      exposure,
      headline: prepared
        ? `${what} was marked ready by the kitchen, then removed from the bill`
        : `${what} removed ${wait} min after it was sent to the ${station}`,
      comparedWith: prepared
        ? `Compared with the kitchen display: marked ready at ${fmtTime(first.completedMin!)}, removed from the bill at ${fmtTime(first.removedMin ?? o.closeMin)}, with no manager approval.`
        : `Compared with the ${station} display: sent at ${fmtTime(first.sentMin ?? 0)}, removed at ${fmtTime(first.removedMin ?? o.closeMin)}, with no manager approval.`,
    };
  }

  if (o.refund) {
    const billed = t.net + t.refunds;
    const share = billed > 0 ? o.refund.amount / billed : 0;
    const late = o.refund.min - o.closeMin;
    if (share >= POLICY.refundMaxShare || !o.refund.reason || late > POLICY.refundLateMinutes) {
      return {
        ...base,
        type: "unusual_refund",
        min: o.refund.min,
        exposure: o.refund.amount,
        headline: !o.refund.reason ? "Refund issued with no reason recorded" : `Refund of ${Math.round(share * 100)}% of the bill, ${late} min after payment`,
        comparedWith: `Compared with the refund rule: a reason, at most ${Math.round(POLICY.refundMaxShare * 100)}% of the bill, within ${POLICY.refundLateMinutes} min of payment. This refund: ${yes(o.refund.reason, "reason")}, ${Math.round(share * 100)}% of the bill, ${late} min after payment.`,
      };
    }
  }

  if (o.discountPct > 0 && !o.approvalsNotInSource && (o.discountPct > POLICY.discountMaxPct || !o.discountReason || !o.discountApprovedBy)) {
    return {
      ...base,
      type: "unusual_discount",
      min: o.closeMin - 2,
      exposure: t.discounts,
      headline: o.discountPct > POLICY.discountMaxPct ? `${o.discountPct}% discount, above the ${POLICY.discountMaxPct}% policy limit` : `${o.discountPct}% discount with no ${!o.discountReason ? "reason" : "approval"} recorded`,
      comparedWith: `Compared with the discount rule: at most ${POLICY.discountMaxPct}%, with a reason and a manager's approval. This discount: ${o.discountPct}%, ${yes(o.discountReason, "reason")}, ${yes(o.discountApprovedBy, "approval")}.`,
    };
  }

  const comped = o.lines.filter((l) => l.state === "comped");
  if (comped.length > 0 && (t.comps > POLICY.compMaxValue || comped.some((l) => !l.reason || (!l.approvedBy && !o.approvalsNotInSource)))) {
    return {
      ...base,
      type: "excessive_comp",
      min: o.closeMin - 2,
      exposure: t.comps,
      headline: t.comps > POLICY.compMaxValue ? "Complimentary items above the agreed limit" : "Complimentary item with no reason or approval recorded",
      comparedWith: `Compared with the comp rule: up to ${money(POLICY.compMaxValue)} an order, each item with a reason and an approval. This order: ${money(t.comps)} complimentary, ${comped.filter((l) => !l.reason || !l.approvedBy).length} of ${comped.length} without a reason or approval.`,
    };
  }

  // Open items, the misc button and prices changed by hand, charged well below the menu price of the item on the ticket.
  const cheap = o.lines.filter((l) => l.state === "kept" && belowMenu(l) && !l.till!.approvedBy);
  if (cheap.length > 0) {
    const price = (n: number) => fmtMoney(n, propertyById[propertyId].currency, { decimals: n % 1 !== 0 });
    const first = cheap[0];
    const till = first.till!;
    const item = itemById[first.itemId];
    const below = Math.round((1 - first.unitPrice / till.menuPrice) * 100);
    return {
      ...base, type: "price_override", min: first.enteredMin, exposure: round2(cheap.reduce((s, l) => s + (l.till!.menuPrice - l.unitPrice) * l.qty, 0)),
      headline: `${item.name} ${TILL_PRICE_WORDS[till.kind]} at ${price(first.unitPrice)}, menu price ${price(till.menuPrice)}`,
      comparedWith: `Compared with the menu: the ${item.station} ticket shows ${first.qty} × ${item.name} at ${price(till.menuPrice)} each, and the bill charged ${price(first.unitPrice)} each, ${below}% below. A price set at the till more than ${Math.round(POLICY.priceBelowShare * 100)}% below the menu needs a manager's approval. This line: ${yes(till.reason, "reason")}, ${yes(till.approvedBy, "approval")}.`,
    };
  }

  // The same item rung twice within seconds, or a quantity far above normal.
  const ring = ringFinding(o);
  if (ring) {
    const price = (n: number) => fmtMoney(n, propertyById[propertyId].currency, { decimals: n % 1 !== 0 });
    const guests = `${o.covers} ${o.covers === 1 ? "guest" : "guests"}`;
    if (ring.kind === "twice") {
      const name = itemById[ring.second.itemId].name;
      // Usually the burst is all there is of the item; when a later round is on the bill too, say what the entries add up to.
      const whole = ringOnBill(o, ring) === ring.total;
      return {
        ...base, type: "duplicate_ring", min: ring.second.enteredMin, exposure: lineValue(ring.second),
        headline: `${name} rung twice ${ring.seconds} seconds apart, ${ring.total} ${whole ? "on the bill" : "in those entries"} for ${guests}`,
        comparedWith: `Compared with the duplicate rule: the same item entered twice within ${POLICY.duplicateSeconds} seconds, with more of it on the bill than guests at the table. This bill: ${name} at ${fmtClock(ring.first.enteredMin, ring.first.enteredSec)} and ${fmtClock(ring.second.enteredMin, ring.second.enteredSec)}, ${ring.total} for ${guests}, ${price(lineValue(ring.second))} on the second entry.`,
      };
    }
    const l = ring.line;
    const name = itemById[l.itemId].name;
    return {
      ...base, type: "duplicate_ring", min: l.enteredMin, exposure: round2(Math.max(0, l.qty - o.covers) * l.unitPrice),
      headline: `${l.qty} × ${name} on one bill for ${guests}`,
      comparedWith: `Compared with the quantity rule: at least ${POLICY.quantityMin} of one item and more than ${POLICY.quantityPerGuest} a guest is far above normal. This bill: ${l.qty} × ${name} in one entry at ${fmtTime(l.enteredMin)}, for ${guests}. The value involved is everything beyond one a guest, ${price(Math.max(0, l.qty - o.covers) * l.unitPrice)}.`,
    };
  }
  return null;
}

/** How a charge to a room compares with the guest folio in the PMS. Checked in this order; the first that applies wins. */
export type RoomChargeStatus = "matched" | "missing" | "wrong_room" | "after_checkout" | "duplicate" | "wrong_amount";

export function classifyRoomCharge(c: RoomCharge): RoomChargeStatus {
  if (c.posted.length === 0) return "missing";
  if (c.folioRoom !== undefined && c.folioRoom !== c.room) return "wrong_room";
  // Only when both times are known: a folio with no check-out time is still open.
  if (c.checkoutMin !== undefined && c.postedMin !== undefined && c.postedMin > c.checkoutMin) return "after_checkout";
  if (c.posted.length > 1) return "duplicate";
  if (Math.abs(round2(c.posted[0] - c.expected)) > POLICY.roomChargeTolerance) return "wrong_amount";
  return "matched";
}

export const ROOM_STATUS_TYPE: Record<Exclude<RoomChargeStatus, "matched">, ExceptionType> = {
  missing: "room_charge_missing",
  wrong_room: "room_charge_wrong_room",
  after_checkout: "room_charge_after_checkout",
  duplicate: "room_charge_duplicate",
  wrong_amount: "room_charge_incorrect",
};

/** A time on the folio, given in minutes from the start of the charge date: "19 Nov, 9:05 PM". */
export const folioTime = (date: string, min: number) => `${fmtDate(addDays(date, Math.floor(min / 1440)))}, ${fmtTime(min)}`;

export function detectRoomChargeException(c: RoomCharge): Exception | null {
  const status = classifyRoomCharge(c);
  if (status === "matched") return null;
  const base = { id: `EX-${c.id}`, propertyId: c.propertyId, outletId: c.outletId, date: c.date, min: c.min, chargeId: c.id, orderId: c.orderId, type: ROOM_STATUS_TYPE[status] };
  const what = c.source === "restaurant" || c.source === "room_service" ? "charge" : `${c.source} charge`;
  const money = (n: number) => fmtMoney(n, propertyById[c.propertyId].currency, { decimals: true });
  const total = round2(c.posted.reduce((s, x) => s + x, 0));
  const ref = c.orderId ? `check ${c.orderId}` : "this charge";
  switch (status) {
    case "missing":
      return { ...base, exposure: c.expected, headline: `Room ${c.room}: ${what} has not reached the guest bill`, comparedWith: `Compared with the guest folio in the PMS: the till charged ${money(c.expected)} to room ${c.room}; the folio has no matching posting.` };
    case "wrong_room":
      return { ...base, exposure: c.expected, headline: `Room ${c.room}: ${what} posted to room ${c.folioRoom}`, comparedWith: `Compared with the guest folio in the PMS: ${money(c.expected)} was charged to room ${c.room}, and the folio line for ${ref} is on room ${c.folioRoom}.` };
    case "after_checkout":
      return { ...base, exposure: total, headline: `Room ${c.room}: ${what} reached the guest bill after check-out`, comparedWith: `Compared with the guest folio in the PMS: the guest checked out on ${folioTime(c.date, c.checkoutMin!)}, and the ${money(total)} posting arrived on ${folioTime(c.date, c.postedMin!)}, after the bill was settled.` };
    case "duplicate":
      return { ...base, exposure: round2(c.posted.slice(1).reduce((s, x) => s + x, 0)), headline: `Room ${c.room}: ${what} posted ${c.posted.length} times`, comparedWith: `Compared with the guest folio in the PMS: one charge of ${money(c.expected)} on the till, ${c.posted.length} postings on the folio.` };
    case "wrong_amount": {
      const diff = round2(c.posted[0] - c.expected);
      return { ...base, exposure: Math.abs(diff), headline: `Room ${c.room}: guest bill shows ${diff > 0 ? "more" : "less"} than the ${what}`, comparedWith: `Compared with the guest folio in the PMS: ${money(c.expected)} on the till, ${money(c.posted[0])} on the folio. Differences up to ${money(POLICY.roomChargeTolerance)} are ignored.` };
    }
  }
}

export function detectExceptions(orders: readonly Order[], charges: readonly RoomCharge[]): Exception[] {
  const out: Exception[] = [];
  for (const o of orders) {
    const e = detectOrderException(o);
    if (e) out.push(e);
  }
  for (const c of charges) {
    const e = detectRoomChargeException(c);
    if (e) out.push(e);
  }
  return out.sort((a, b) => (a.date === b.date ? b.min - a.min : a.date < b.date ? 1 : -1));
}

export interface Pattern {
  outletId: string;
  staffId: string;
  cases: number;
  value: number;
  outletCases: number;
  share: number;
  eveningShare: number;
  exceptionIds: string[];
}

/** Repeated removals under one POS login. A login shows who was signed in, not who made the change. */
export function detectPatterns(exceptions: readonly Exception[], today: string): Pattern[] {
  const from = addDays(today, -(POLICY.patternWindowDays - 1));
  const recent = exceptions.filter((e) => REMOVAL_TYPES.includes(e.type) && e.date >= from && e.outletId && e.staffId);
  const byOutlet = new Map<string, Exception[]>();
  for (const e of recent) byOutlet.set(e.outletId!, [...(byOutlet.get(e.outletId!) ?? []), e]);
  const out: Pattern[] = [];
  for (const [outletId, list] of byOutlet) {
    const byStaff = new Map<string, Exception[]>();
    for (const e of list) byStaff.set(e.staffId!, [...(byStaff.get(e.staffId!) ?? []), e]);
    for (const [staffId, cases] of byStaff) {
      const share = cases.length / list.length;
      if (cases.length >= POLICY.patternMinCases && share >= POLICY.patternMinShare) {
        out.push({
          outletId,
          staffId,
          cases: cases.length,
          value: cases.reduce((s, e) => s + e.exposure, 0),
          outletCases: list.length,
          share,
          eveningShare: cases.filter((e) => e.min >= 18 * 60).length / cases.length,
          exceptionIds: cases.map((e) => e.id),
        });
      }
    }
  }
  return out.sort((a, b) => b.cases - a.cases);
}
