// Rule-based detection of unusual restaurant transactions and room-charge postings.
// Every rule reads recorded facts only. Nothing here decides intent or blame.
import { itemById, outletById } from "../data/catalog";
import type { Exception, ExceptionType, Order, RoomCharge } from "../types";
import { addDays, round2 } from "../util";
import { lineValue, orderTotals } from "./orders";

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
};

export const TYPE_LABEL: Record<ExceptionType, string> = {
  removed_after_dispatch: "Removed after dispatch",
  prepared_not_charged: "Prepared, not charged",
  bill_mismatch: "Order and bill differ",
  unusual_discount: "Unusual discount",
  excessive_comp: "Complimentary items",
  unusual_refund: "Unusual refund",
  unexplained_void: "Unexplained void",
  room_charge_missing: "Room charge missing",
  room_charge_duplicate: "Room charge duplicated",
  room_charge_incorrect: "Room charge amount differs",
};

export const REMOVAL_TYPES: ExceptionType[] = ["removed_after_dispatch", "prepared_not_charged", "bill_mismatch"];
export const ROOM_TYPES: ExceptionType[] = ["room_charge_missing", "room_charge_duplicate", "room_charge_incorrect"];

const names = (o: Order, pred: (i: number) => boolean) =>
  o.lines
    .filter((_, i) => pred(i))
    .map((l) => itemById[l.itemId].name)
    .join(", ");

export function detectOrderException(o: Order): Exception | null {
  const propertyId = outletById[o.outletId].propertyId;
  const base = { id: `EX-${o.id}`, propertyId, outletId: o.outletId, date: o.date, orderId: o.id, staffId: o.staffId };
  const t = orderTotals(o);

  if (o.voided) {
    if (t.removedPost > 0 && (!o.voided.reason || !o.voided.approvedBy)) {
      return { ...base, type: "unexplained_void", min: o.voided.min, exposure: t.removedPost, headline: "Whole order voided after items were sent for preparation" };
    }
    return null;
  }

  const flagged = o.lines.map((l) => l.state === "removed_post" && !l.approvedBy);
  const flaggedLines = o.lines.filter((_, i) => flagged[i]);
  if (flaggedLines.length > 0) {
    const exposure = flaggedLines.reduce((s, l) => s + lineValue(l), 0);
    const first = flaggedLines[0];
    const min = first.removedMin ?? o.closeMin;
    const wait = (first.removedMin ?? 0) - (first.sentMin ?? 0);
    const what = names(o, (i) => flagged[i]);
    const station = itemById[first.itemId].station;
    if (flaggedLines.length >= 2) {
      return { ...base, type: "bill_mismatch", staffId: first.removedBy ?? o.staffId, min, exposure, headline: `${flaggedLines.length} items sent for preparation are missing from the final bill` };
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
      };
    }
  }

  if (o.discountPct > 0 && (o.discountPct > POLICY.discountMaxPct || !o.discountReason || !o.discountApprovedBy)) {
    return {
      ...base,
      type: "unusual_discount",
      min: o.closeMin - 2,
      exposure: t.discounts,
      headline: o.discountPct > POLICY.discountMaxPct ? `${o.discountPct}% discount, above the ${POLICY.discountMaxPct}% policy limit` : `${o.discountPct}% discount with no ${!o.discountReason ? "reason" : "approval"} recorded`,
    };
  }

  const comped = o.lines.filter((l) => l.state === "comped");
  if (comped.length > 0 && (t.comps > POLICY.compMaxValue || comped.some((l) => !l.reason || !l.approvedBy))) {
    return {
      ...base,
      type: "excessive_comp",
      min: o.closeMin - 2,
      exposure: t.comps,
      headline: t.comps > POLICY.compMaxValue ? `Complimentary items worth more than the ${POLICY.compMaxValue} limit` : "Complimentary item with no reason or approval recorded",
    };
  }
  return null;
}

export function detectRoomChargeException(c: RoomCharge): Exception | null {
  const base = { id: `EX-${c.id}`, propertyId: c.propertyId, outletId: c.outletId, date: c.date, min: c.min, chargeId: c.id, orderId: c.orderId };
  const what = c.source === "restaurant" || c.source === "room_service" ? "charge" : `${c.source} charge`;
  if (c.posted.length === 0) {
    return { ...base, type: "room_charge_missing", exposure: c.expected, headline: `Room ${c.room}: ${what} has not reached the guest bill` };
  }
  if (c.posted.length > 1) {
    return { ...base, type: "room_charge_duplicate", exposure: round2(c.posted.slice(1).reduce((s, x) => s + x, 0)), headline: `Room ${c.room}: ${what} posted ${c.posted.length} times` };
  }
  const diff = round2(c.posted[0] - c.expected);
  if (Math.abs(diff) > POLICY.roomChargeTolerance) {
    return { ...base, type: "room_charge_incorrect", exposure: Math.abs(diff), headline: `Room ${c.room}: guest bill shows ${diff > 0 ? "more" : "less"} than the ${what}` };
  }
  return null;
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
