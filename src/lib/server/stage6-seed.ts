// Stage 6 starting records: a small sales pipeline with fictional organisations, two deals already linked to the
// seeded events, one proposal awaiting the customer, and empty finance and shared-stock records.
import type { InvoiceReview, Opportunity, Proposal, SharedCount, SharedWaste, SharedWasteCorrection, TyllInvoice } from "../types";

export interface FinanceShape { invoices: TyllInvoice[]; reviews: Record<string, InvoiceReview> }
export interface SalesShape { opps: Opportunity[]; proposals: Proposal[] }
export interface StockLogShape { waste: SharedWaste[]; corrections: SharedWasteCorrection[]; counts: SharedCount[] }

const at = "2026-10-12T09:00:00.000Z";
const h = (hh: number, mm = 0) => hh * 60 + mm;

function opp(o: Omit<Opportunity, "createdAt" | "updatedAt" | "history" | "notes" | "nextAction"> & Partial<Pick<Opportunity, "notes" | "nextAction">>): Opportunity {
  return { notes: "", nextAction: "", ...o, createdAt: at, updatedAt: at, history: [{ at, by: o.ownerId, action: "Opportunity created", note: "Demo history" }] };
}

export function seedStage6(): { finance: FinanceShape; sales: SalesShape; stockLog: StockLogShape } {
  const opps: Opportunity[] = [
    opp({ id: "OPP-DXB-0001", propertyId: "dxb", type: "Group booking", customer: "Atlas Engineering", expectedDate: "2026-11-20", guests: 40, value: 64000, ownerId: "u-sales", status: "contacted", nextAction: "Send room block and meeting-room rates", nextActionDue: "2026-10-15" }),
    opp({ id: "OPP-DXB-0002", propertyId: "dxb", type: "Wedding", customer: "Al Safa family wedding", expectedDate: "2026-12-12", guests: 220, value: 210000, ownerId: "u-sales", status: "proposal_sent", nextAction: "Follow up on the proposal", nextActionDue: "2026-10-16" }),
    opp({ id: "OPP-DXB-0003", propertyId: "dxb", type: "Banquet", customer: "Northwind Logistics", expectedDate: "2026-10-30", guests: 80, value: 36000, ownerId: "u-dos", status: "new", nextAction: "Call to confirm the date and budget", nextActionDue: "2026-10-14" }),
    opp({ id: "OPP-DXB-0004", propertyId: "dxb", type: "Conference", customer: "Horizon Retail Group", expectedDate: "2026-10-15", guests: 180, value: 57600, ownerId: "u-dos", status: "confirmed", eventId: "EVT-DXB-0001", nextAction: "Final numbers due from the client", notes: "Regional sales conference dinner. Confirmed before Tyll; linked to the event record." }),
    opp({ id: "OPP-DXB-0005", propertyId: "dxb", type: "Private dining", customer: "Coral Bank", expectedDate: "2026-10-09", guests: 14, value: 9800, ownerId: "u-sales", status: "lost", lostReason: "Chose another venue" }),
    opp({ id: "OPP-DOH-0001", propertyId: "doh", type: "Conference", customer: "Gulf Maritime Forum", expectedDate: "2026-11-18", guests: 150, value: 120000, ownerId: "u-sales-doh", status: "contacted", nextAction: "Site visit", nextActionDue: "2026-10-20" }),
    opp({ id: "OPP-DOH-0002", propertyId: "doh", type: "Wedding", customer: "Pearl Ballroom wedding", expectedDate: "2026-10-16", guests: 240, value: 0, ownerId: "u-sales-doh", status: "confirmed", eventId: "EVT-DOH-0001", notes: "Confirmed before Tyll; price not recorded here." }),
  ];
  const proposals: Proposal[] = [
    {
      id: "PRP-DXB-0001", oppId: "OPP-DXB-0002", propertyId: "dxb", version: 1, date: "2026-12-12", start: h(19), end: h(23, 30), guests: 220, venue: "Grand Ballroom", format: "seated",
      services: ["three_course", "soft_drinks", "wine"], pricePerGuest: 950, extras: [{ label: "Stage and floral design", amount: 18000 }], discountPct: 0, validUntil: "2026-10-31",
      notes: "Includes a cake-cutting ceremony.", status: "sent", createdBy: "u-sales", createdAt: at, updatedAt: at,
      history: [{ at, by: "u-sales", action: "Proposal created" }, { at, by: "u-sales", action: "Marked as sent to the customer", note: "Demo history. Tyll does not send email." }],
    },
  ];
  return { finance: { invoices: [], reviews: {} }, sales: { opps, proposals }, stockLog: { waste: [], corrections: [], counts: [] } };
}
