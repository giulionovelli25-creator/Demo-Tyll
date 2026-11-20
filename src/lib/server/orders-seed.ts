// Example orders at every stage, so the outlet and purchasing teams see the same records from the first visit.
// Simulated: nothing is sent to a supplier. Delivered orders point at the delivery record they arrived as.
import { ingredientById } from "../data/catalog";
import { getDataset } from "../data/generate";
import { ingredientCostAt } from "../domain/pricing";
import type { PurchaseRequest, RequestEvent, RequestLine, RequestStatus } from "../types";
import { DEMO_TODAY, rel, round2 } from "../util";
import { nextDeliveryDate } from "../domain/procurement";

const at = (day: number, time: string) => `${rel(day)}T${time}:00.000Z`;
const local = (day: number, time: string) => `${rel(day)}T${time}`;

function line(ingredientId: string, qty: number, received?: number, receiveNote?: string): RequestLine {
  return {
    ingredientId, qty, suggested: qty, requirement: qty, available: 0, incoming: 0, safety: 0,
    supplierId: ingredientById[ingredientId].supplierId, unitPrice: round2(ingredientCostAt(ingredientId, DEMO_TODAY)),
    ...(received !== undefined ? { received } : {}), ...(receiveNote ? { receiveNote } : {}),
  };
}
const ev = (when: string, by: string, action: string, status: RequestStatus, comment?: string): RequestEvent => ({ at: when, by, action, status, ...(comment ? { comment } : {}) });

/** The latest delivery from a supplier on or before a day, so a delivered order opens its own three way check. */
function deliveryOf(supplierId: string, onOrBefore: string) {
  return getDataset().deliveries.filter((d) => d.propertyId === "lis" && d.supplierId === supplierId && d.status === "delivered" && d.date <= onOrBefore).sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function seedRequests(): PurchaseRequest[] {
  const base = (n: number, outletIds: string[], createdBy: string, created: string, status: RequestStatus, lines: RequestLine[], extra: Partial<PurchaseRequest> = {}, history: RequestEvent[] = []): PurchaseRequest => ({
    id: `PR-LIS-${String(n).padStart(4, "0")}`, propertyId: "lis", outletIds, period: { from: rel(1), to: rel(3) }, createdBy, createdAt: created,
    updatedAt: history.at(-1)?.at ?? created, status, lines, history: [ev(created, createdBy, "Request created", "draft"), ...history], ...extra,
  });
  const beef = deliveryOf("meat", rel(-1));
  const drinks = deliveryOf("bev", rel(-1));
  return [
    base(1, ["lis-terrace"], "u-fnb", at(0, "16:20"), "draft", [line("saladveg", 20), line("romaine", 10), line("asparagus", 6), line("herbs", 2), line("berries", 5)],
      { comment: "Weekend brunch. Still checking the berry quantity." }),
    // A purchase order to one supplier, Douro Cellars, which takes orders through its own ordering system (simulated).
    base(2, ["lis-lobby"], "u-lby", at(0, "11:05"), "purchasing", [line("wine", 54), line("rum", 6), line("vodka", 6)],
      { supplierId: "wine", deliveryDate: nextDeliveryDate(DEMO_TODAY, 11 * 60, "12:00", 2, [2, 4]) }, [ev(at(0, "11:12"), "u-lby", "Submitted to purchasing", "purchasing")]),
    base(3, ["lis-banquets"], "u-events", at(-1, "10:30"), "manager", [line("tenderloin", 70), line("chicken", 60), line("lamb", 25)],
      { comment: "Gala dinner for 220 on Saturday." },
      [ev(at(-1, "10:41"), "u-events", "Submitted to purchasing", "purchasing"), ev(at(-1, "14:02"), "u-buy", "Purchasing review approved", "accounting"), ev(at(0, "09:15"), "u-fc", "Accounting review approved", "manager", "Within the events budget.")]),
    base(4, ["lis-terrace"], "u-chef", at(0, "08:10"), "approved", [line("butter", 20), line("cream", 24), line("parmesan", 6), line("flour", 50), line("eggs", 360), line("milk", 60)],
      { poNumber: "PO-LIS-0004", sentAt: local(0, "09:40"), expectedAt: local(1, "07:30") },
      [ev(at(0, "08:14"), "u-chef", "Submitted to purchasing", "purchasing"), ev(at(0, "09:02"), "u-buy", "Purchasing review approved", "accounting"), ev(at(0, "09:31"), "u-fc", "Accounting review approved", "approved"), ev(at(0, "09:40"), "u-buy", "Sent to Mercearia Lusa (simulated)", "approved", "Arrives tomorrow at 07:30.")]),
    base(5, ["lis-terrace"], "u-chef", at(-1, "13:30"), "approved", [line("salmon", 25), line("hammour", 15), line("lobster", 2)],
      { poNumber: "PO-LIS-0005", sentAt: local(-1, "16:10"), expectedAt: local(0, "15:00") },
      [ev(at(-1, "13:34"), "u-chef", "Submitted to purchasing", "purchasing"), ev(at(-1, "15:20"), "u-buy", "Purchasing review approved", "accounting"), ev(at(-1, "16:02"), "u-fc", "Accounting review approved", "approved"), ev(at(-1, "16:10"), "u-buy", "Sent to Peixaria Atlântico (simulated)", "approved", "Due today at 15:00.")]),
    base(6, ["lis-lobby"], "u-lby", at(-3, "12:00"), "received", [line("coke", 96, 96), line("water", 240, 240), line("sparklingwater", 120, 120), line("beerkeg", 100, 100)],
      { poNumber: "PO-LIS-0006", sentAt: local(-3, "15:30"), expectedAt: local(-1, "08:00"), deliveryId: drinks?.id },
      [ev(at(-3, "12:04"), "u-lby", "Submitted to purchasing", "purchasing"), ev(at(-3, "14:40"), "u-buy", "Purchasing review approved", "accounting"), ev(at(-3, "15:22"), "u-fc", "Accounting review approved", "approved"), ev(at(-3, "15:30"), "u-buy", "Sent to Fonte Clara Bebidas (simulated)", "approved"), ev(at(-1, "08:05"), "u-store", "Delivered and checked", "received", "Complete.")]),
    base(7, ["lis-banquets"], "u-events", at(-3, "09:45"), "received", [line("tenderloin", 20, 16, "4 kg short. Invoice shows the full 20 kg."), line("chicken", 30, 30), line("lamb", 12, 12)],
      { poNumber: "PO-LIS-0007", sentAt: local(-3, "13:10"), expectedAt: local(-1, "07:00"), deliveryId: beef?.id },
      [ev(at(-3, "09:50"), "u-events", "Submitted to purchasing", "purchasing"), ev(at(-3, "11:30"), "u-buy", "Purchasing review approved", "accounting"), ev(at(-3, "12:55"), "u-fc", "Accounting review approved", "approved"), ev(at(-3, "13:10"), "u-buy", "Sent to Carnes Ribeiro & Filhos (simulated)", "approved"), ev(at(-1, "07:20"), "u-store", "Delivered short", "received", "Beef tenderloin: 16 kg of 20 kg arrived.")]),
  ];
}
