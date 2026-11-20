// Integration boundary. Real systems plug in by implementing these interfaces.
// The demo ships one read-only implementation of each, backed by the simulated dataset, in lib/server/adapters.ts.
// First real adapters (built from public API documentation, tested on sample responses only, not connected to a live
// account): Lightspeed Restaurant K Series (PosAdapter) and Mews (PmsAdapter), in lib/server/integrations.
import type { CountRecord, Delivery, OccupancyDay, Order, ReservationDay, RoomCharge, WasteLog } from "./types";

export interface PosAdapter {
  /** Orders with every line, modification, discount, refund and void, for one business date. */
  fetchOrders(outletId: string, businessDate: string): Promise<Order[]>;
}

export interface PmsAdapter {
  /** Lines posted to guest bills, matched to the charge the source system recorded. */
  fetchRoomCharges(propertyId: string, businessDate: string): Promise<RoomCharge[]>;
  fetchOccupancy(propertyId: string, from: string, to: string): Promise<OccupancyDay[]>;
}

export interface ReservationsAdapter {
  fetchCovers(outletId: string, from: string, to: string): Promise<ReservationDay[]>;
}

export interface InventoryAdapter {
  fetchDeliveries(propertyId: string, from: string, to: string): Promise<Delivery[]>;
  fetchCounts(propertyId: string, from: string, to: string): Promise<CountRecord[]>;
  fetchWaste(outletId: string, from: string, to: string): Promise<WasteLog[]>;
}

export interface AccountingAdapter {
  /** Returns null until a ledger is connected. Tyll then labels profit as an estimate. */
  fetchPostedLabor(outletId: string, from: string, to: string): Promise<number | null>;
}

/** `adapter_built`: code written and tested on sample responses, not yet connected to a live account (unverified). */
/** `demo_connection`: the adapter runs in the demo on recorded responses from the system, replayed on a schedule. Not a live account. */
export type ConnectionState = "simulated" | "adapter_built" | "demo_connection" | "not_connected" | "planned";

export interface DataSource {
  id: string;
  system: string;
  kind: string;
  state: ConnectionState;
  supplies: string;
  note: string;
  /** False until the adapter has been tested with real sandbox credentials. */
  verified?: boolean;
  /** A page showing what the adapter reads, for roles that may see it. */
  detail?: string;
}

/** What is and is not connected in this demo. Shown on the Settings page so nothing passes as a live integration. */
export const DATA_SOURCES: DataSource[] = [
  { id: "pos", system: "Point of sale", kind: "PosAdapter", state: "simulated", supplies: "Orders, modifications, discounts, refunds, voids, kitchen and bar tickets", note: "Simulated records. The website lists MICROS Simphony, Sapaad and HMS as systems Tyll can connect to." },
  { id: "pos-simphony", system: "Oracle Simphony (MICROS)", kind: "PosAdapter: SimphonyPos", state: "demo_connection", verified: false, detail: "/settings/adapters", supplies: "Sales (guest checks), menu items and prices, modifiers, voids and discounts", note: "Last sync 06:00, demo connection. Recorded Simphony responses for Mercado are replayed each morning; no Oracle account is connected. The menu sync on Recipes and costs reads from it." },
  { id: "pos-lightspeed", system: "Lightspeed Restaurant K Series", kind: "PosAdapter: LightspeedKSeriesPos", state: "adapter_built", verified: false, detail: "/settings/adapters", supplies: "Bills, lines, voids, discounts, refunds, payments and room charges, per business day", note: "Built from Lightspeed's public API documentation and tested on sample responses only. Unverified until tested with sandbox credentials. The demo keeps using simulated records." },
  { id: "pms", system: "Property management system", kind: "PmsAdapter", state: "simulated", supplies: "Guest bill postings, occupancy, arrivals, room status", note: "Simulated records. The website lists OPERA and Shiji Infrasys." },
  { id: "pms-mews", system: "Mews", kind: "PmsAdapter: MewsPms", state: "adapter_built", verified: false, detail: "/settings/adapters", supplies: "Guest bill postings, rooms in house, guests per room, check-out times", note: "Built from Mews's public Connector API documentation and tested on sample responses only. Unverified until tested with sandbox credentials. The demo keeps using simulated records." },
  { id: "res", system: "Restaurant reservations", kind: "ReservationsAdapter", state: "simulated", supplies: "Booked covers per restaurant and day", note: "Simulated records." },
  { id: "stock", system: "Stock and purchasing", kind: "InventoryAdapter", state: "simulated", supplies: "Purchase orders, deliveries, supplier invoices, counts", note: "Simulated records. Waste, counts and corrections entered in this demo are saved on the demo server." },
  { id: "ledger", system: "Accounting ledger and payroll", kind: "AccountingAdapter", state: "not_connected", supplies: "Posted labor cost, overheads, accounting profit", note: "Not connected. Labor is estimated from rostered hours and overheads are allocated, so every profit figure is labelled an estimate." },
  { id: "payments", system: "Payment reconciliation", kind: "Separate Tyll product", state: "not_connected", supplies: "Till, card company and bank matching", note: "Runs as its own Tyll product and is not rebuilt here." },
  { id: "ai", system: "Language model for explanations", kind: "ExplanationProvider", state: "planned", supplies: "Free-text investigation summaries", note: "Not called in this demo. Explanations are assembled by rules from the recorded facts." },
  { id: "kds", system: "Kitchen display and waste scales", kind: "KdsAdapter", state: "planned", supplies: "Live ticket status, Winnow and Orbisk waste weights", note: "Planned. Flow uses simulated live tickets." },
];
