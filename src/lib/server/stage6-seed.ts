// Stage 6 starting records: a small sales pipeline with fictional organisations, two deals already linked to the
// seeded events, one proposal awaiting the customer, and empty finance and shared-stock records.
import type { InvoiceReview, Opportunity, Proposal, SharedCount, SharedWaste, SharedWasteCorrection, TyllInvoice } from "../types";
import { rel } from "../util";

export interface FinanceShape { invoices: TyllInvoice[]; reviews: Record<string, InvoiceReview> }
export interface SalesShape { opps: Opportunity[]; proposals: Proposal[] }
export interface StockLogShape { waste: SharedWaste[]; corrections: SharedWasteCorrection[]; counts: SharedCount[] }

const at = `${rel(-1)}T09:00:00.000Z`;
const h = (hh: number, mm = 0) => hh * 60 + mm;

function opp(o: Omit<Opportunity, "createdAt" | "updatedAt" | "history" | "notes" | "nextAction"> & Partial<Pick<Opportunity, "notes" | "nextAction">>): Opportunity {
  return { notes: "", nextAction: "", ...o, createdAt: at, updatedAt: at, history: [{ at, by: o.ownerId, action: "Opportunity created", note: "Demo history" }] };
}

export function seedStage6(): { finance: FinanceShape; sales: SalesShape; stockLog: StockLogShape } {
  const opps: Opportunity[] = [
    opp({ id: "OPP-LIS-0001", propertyId: "lis", type: "Group booking", customer: "Atlas Engineering", expectedDate: rel(38), guests: 40, value: 16000, ownerId: "u-sales", status: "contacted", nextAction: "Send room block and meeting-room rates", nextActionDue: rel(2) }),
    opp({ id: "OPP-LIS-0002", propertyId: "lis", type: "Wedding", customer: "Almeida family wedding", expectedDate: rel(60), guests: 220, value: 52000, ownerId: "u-sales", status: "proposal_sent", nextAction: "Follow up on the proposal", nextActionDue: rel(3) }),
    opp({ id: "OPP-LIS-0003", propertyId: "lis", type: "Banquet", customer: "Northwind Logistics", expectedDate: rel(17), guests: 80, value: 9000, ownerId: "u-dos", status: "new", nextAction: "Call to confirm the date and budget", nextActionDue: rel(1) }),
    opp({ id: "OPP-LIS-0004", propertyId: "lis", type: "Conference", customer: "Horizon Retail Group", expectedDate: rel(2), guests: 180, value: 15300, ownerId: "u-dos", status: "confirmed", eventId: "EVT-LIS-0001", nextAction: "Final numbers due from the client", notes: "Regional sales conference dinner. Confirmed before Tyll; linked to the event record." }),
    opp({ id: "OPP-LIS-0005", propertyId: "lis", type: "Private dining", customer: "Banco Atlântida", expectedDate: rel(-4), guests: 14, value: 2400, ownerId: "u-sales", status: "lost", lostReason: "Chose another venue" }),
  ];
  const proposals: Proposal[] = [
    {
      id: "PRP-LIS-0001", oppId: "OPP-LIS-0002", propertyId: "lis", version: 1, date: rel(60), start: h(19), end: h(23, 30), guests: 220, venue: "Grand Ballroom", format: "seated",
      services: ["three_course", "soft_drinks", "wine"], pricePerGuest: 235, extras: [{ label: "Stage and floral design", amount: 4500 }], discountPct: 0, validUntil: rel(18),
      notes: "Includes a cake-cutting ceremony.", status: "sent", createdBy: "u-sales", createdAt: at, updatedAt: at,
      history: [{ at, by: "u-sales", action: "Proposal created" }, { at, by: "u-sales", action: "Marked as sent to the customer", note: "Demo history. Tyll does not send email." }],
    },
  ];
  return { finance: { invoices: [], reviews: {} }, sales: { opps, proposals }, stockLog: { waste: [], corrections: [], counts: [] } };
}
