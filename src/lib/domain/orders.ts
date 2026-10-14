// Order arithmetic shared by the dashboard, Money, Investigations and Reports.
import { itemById, staffById } from "../data/catalog";
import type { DayItem, DayOutlet, Order, OrderLine, OrderTotals } from "../types";
import { DEMO_NOW_MIN, round2 } from "../util";

export const lineValue = (l: OrderLine) => l.qty * l.unitPrice;

export function orderTotals(o: Order): OrderTotals {
  let original = 0;
  let kept = 0;
  let comps = 0;
  let removedPost = 0;
  let removedPre = 0;
  for (const l of o.lines) {
    const v = lineValue(l);
    original += v;
    if (o.voided) {
      if (l.sentMin !== undefined) removedPost += v;
      else removedPre += v;
    } else if (l.state === "kept") kept += v;
    else if (l.state === "comped") comps += v;
    else if (l.state === "removed_post") removedPost += v;
    else removedPre += v;
  }
  const discounts = round2((kept * o.discountPct) / 100);
  const refunds = o.refund?.amount ?? 0;
  return {
    original,
    gross: kept + comps,
    comps,
    discounts,
    refunds,
    net: round2(kept - discounts - refunds),
    removedPost,
    removedPre,
  };
}

/** Rolls orders up to one row per outlet, day and item. Order-level discounts and refunds are spread over kept lines by value. */
export function buildRollups(orders: readonly Order[]): { dayItems: DayItem[]; dayOutlets: DayOutlet[] } {
  const items = new Map<string, DayItem>();
  const outlets = new Map<string, DayOutlet>();
  for (const o of orders) {
    const late = o.closeMin > DEMO_NOW_MIN;
    const ok = `${o.outletId}|${o.date}|${late ? 1 : 0}`;
    let d = outlets.get(ok);
    if (!d) outlets.set(ok, (d = { outletId: o.outletId, date: o.date, late, orders: 0, covers: 0 }));
    d.orders += 1;
    d.covers += o.covers;
    if (o.voided) continue;
    const t = orderTotals(o);
    const kept = t.gross - t.comps;
    for (const l of o.lines) {
      if (l.state !== "kept" && l.state !== "comped") continue;
      const key = `${ok}|${l.itemId}`;
      let row = items.get(key);
      if (!row) {
        row = { outletId: o.outletId, date: o.date, itemId: l.itemId, late, units: 0, gross: 0, comps: 0, discounts: 0, refunds: 0 };
        items.set(key, row);
      }
      const v = lineValue(l);
      row.units += l.qty;
      row.gross += v;
      if (l.state === "comped") row.comps += v;
      else if (kept > 0) {
        row.discounts += (v / kept) * t.discounts;
        row.refunds += (v / kept) * t.refunds;
      }
    }
  }
  return { dayItems: [...items.values()], dayOutlets: [...outlets.values()] };
}

export interface TimelineEvent {
  min: number;
  kind: "created" | "entered" | "sent" | "completed" | "removed" | "comped" | "discount" | "bill" | "paid" | "refund" | "void";
  title: string;
  detail?: string;
  flagged?: boolean;
  /** The order line the event belongs to, when there is one. */
  line?: OrderLine;
}

const stationOf = (itemId: string) => (itemById[itemId].station === "bar" ? "bar" : "kitchen");
const who = (staffId?: string) => (staffId ? (staffById[staffId]?.name ?? staffId) : "not recorded");

/** The full recorded history of an order, in time order. */
export function orderTimeline(o: Order): TimelineEvent[] {
  const ev: TimelineEvent[] = [
    { min: o.openMin, kind: "created", title: "Order opened", detail: `${o.table} · POS login ${who(o.staffId)} · ${o.covers} guest${o.covers === 1 ? "" : "s"}` },
  ];
  for (const l of o.lines) {
    const name = `${l.qty > 1 ? `${l.qty} × ` : ""}${itemById[l.itemId].name}`;
    ev.push({ min: l.enteredMin, kind: "entered", title: `${name} entered`, line: l });
    if (l.sentMin !== undefined) ev.push({ min: l.sentMin, kind: "sent", title: `${name} sent to ${stationOf(l.itemId)}`, detail: "Preparation ticket printed", line: l });
    if (l.completedMin !== undefined) ev.push({ min: l.completedMin, kind: "completed", title: `${name} marked ready`, detail: "Kitchen display", line: l });
    if ((l.state === "removed_pre" || l.state === "removed_post") && l.removedMin !== undefined) {
      const after = l.state === "removed_post";
      ev.push({
        min: l.removedMin,
        kind: "removed",
        title: `${name} removed from the order`,
        detail: `POS login ${who(l.removedBy)} · reason: ${l.reason ?? "none recorded"} · approval: ${l.approvedBy ? who(l.approvedBy) : "none recorded"}`,
        flagged: after && !l.approvedBy,
        line: l,
      });
    }
    if (l.state === "comped") {
      ev.push({
        min: l.removedMin ?? o.closeMin - 2,
        kind: "comped",
        title: `${name} marked complimentary`,
        detail: `Reason: ${l.reason ?? "none recorded"} · approval: ${l.approvedBy ? who(l.approvedBy) : "none recorded"}`,
        flagged: !l.reason || !l.approvedBy,
        line: l,
      });
    }
  }
  const t = orderTotals(o);
  if (o.voided) {
    ev.push({
      min: o.voided.min,
      kind: "void",
      title: "Whole order voided",
      detail: `Reason: ${o.voided.reason ?? "none recorded"} · approval: ${o.voided.approvedBy ? who(o.voided.approvedBy) : "none recorded"}`,
      flagged: !o.voided.reason || !o.voided.approvedBy,
    });
    return ev.sort((a, b) => a.min - b.min);
  }
  if (o.discountPct > 0) {
    ev.push({
      min: o.closeMin - 2,
      kind: "discount",
      title: `${o.discountPct}% discount applied`,
      detail: `Reason: ${o.discountReason ?? "none recorded"} · approval: ${o.discountApprovedBy ? who(o.discountApprovedBy) : "none recorded"}`,
      flagged: !o.discountReason || !o.discountApprovedBy,
    });
  }
  ev.push({ min: o.closeMin - 1, kind: "bill", title: "Final bill produced", detail: `Total ${t.net + t.refunds}` });
  ev.push({
    min: o.closeMin,
    kind: "paid",
    title: o.payment === "room" ? `Charged to room ${o.room}` : `Paid by ${o.payment}`,
    detail: o.payment === "room" ? "Sent to the guest bill in the PMS" : "Payment status: settled at the outlet",
  });
  if (o.refund) {
    ev.push({
      min: o.refund.min,
      kind: "refund",
      title: `Refund of ${o.refund.amount}`,
      detail: `Reason: ${o.refund.reason ?? "none recorded"} · approval: ${o.refund.approvedBy ? who(o.refund.approvedBy) : "none recorded"}`,
      flagged: !o.refund.reason || !o.refund.approvedBy,
    });
  }
  return ev.sort((a, b) => a.min - b.min);
}
