// The suppliers' side of sending, simulated for the demo. Nothing here reaches a real company. Each supplier's ordering
// system keeps the sending references it has received, so an order retried with the same reference is recognised and
// never booked twice. Two fixed behaviours make the demo show what a real connection meets:
// - Douro Cellars' system receives the first try but its answer is lost (a timeout), so the order shows as failed and is
//   retried safely.
// - Mercearia Lusa confirms with a change: less of one item this week, for purchasing to accept or decline.
import { addDays } from "../util";
import type { PurchaseRequest, SupplierConfirmation } from "../types";

export const SUPPLIER_SIM: Record<string, { timeoutFirst?: boolean; change?: "qty" | "date" }> = {
  wine: { timeoutFirst: true },
  dry: { change: "qty" },
};

export interface InboxEntry { key: string; supplierId: string; at: string }

/** What happens when an order is pushed to a supplier's ordering system. */
export function pushOutcome(inbox: InboxEntry[], supplierId: string, key: string, attempt: number): "received" | "timeout" | "already" {
  if (inbox.some((e) => e.key === key && e.supplierId === supplierId)) return "already";
  if (SUPPLIER_SIM[supplierId]?.timeoutFirst && attempt === 1) return "timeout";
  return "received";
}

/** The supplier's answer once it has the order. */
export function confirmationFor(r: PurchaseRequest, contact: string, at: string, nameOf: (ingredientId: string) => string, unitOf: (ingredientId: string) => string): SupplierConfirmation {
  const sim = r.supplierId ? SUPPLIER_SIM[r.supplierId] : undefined;
  if (sim?.change === "qty") {
    // The largest line that is at least two packs: a third less this week, in whole packs.
    const line = [...r.lines].filter((l) => l.qty >= 2 * (l.packSize ?? 1)).sort((a, b) => b.qty * b.unitPrice - a.qty * a.unitPrice)[0];
    if (line) {
      const pack = line.packSize ?? 1;
      const to = Math.max(pack, Math.round((Math.floor((line.qty * 2) / 3 / pack + 1e-9) * pack) * 1000) / 1000);
      if (to < line.qty) return { state: "changed", at, from: contact, changes: [{ kind: "qty", ingredientId: line.ingredientId, from: String(line.qty), to: String(to), reason: `Only ${to} ${unitOf(line.ingredientId)} of ${nameOf(line.ingredientId)} available for this delivery. The rest can come on the next one.` }] };
    }
  }
  if (sim?.change === "date" && r.deliveryDate) {
    return { state: "changed", at, from: contact, changes: [{ kind: "date", from: r.deliveryDate, to: addDays(r.deliveryDate, 1), reason: "The van is full on the day asked for." }] };
  }
  return { state: "confirmed", at, from: contact, changes: [] };
}
