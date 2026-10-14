// Integration boundary. Real systems plug in by implementing these interfaces.
// The demo ships one read-only implementation of each, backed by the simulated dataset, in lib/server/adapters.ts.
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

export type ConnectionState = "simulated" | "not_connected" | "planned";

export interface DataSource {
  id: string;
  system: string;
  kind: string;
  state: ConnectionState;
  supplies: string;
  note: string;
}

/** What is and is not connected in this demo. Shown on the Settings page so nothing passes as a live integration. */
export const DATA_SOURCES: DataSource[] = [
  { id: "pos", system: "Point of sale", kind: "PosAdapter", state: "simulated", supplies: "Orders, modifications, discounts, refunds, voids, kitchen and bar tickets", note: "Simulated records. The website lists MICROS Simphony, Sapaad and HMS as systems Tyll can connect to." },
  { id: "pms", system: "Property management system", kind: "PmsAdapter", state: "simulated", supplies: "Guest bill postings, occupancy, arrivals, room status", note: "Simulated records. The website lists OPERA and Shiji Infrasys." },
  { id: "res", system: "Restaurant reservations", kind: "ReservationsAdapter", state: "simulated", supplies: "Booked covers per restaurant and day", note: "Simulated records." },
  { id: "stock", system: "Stock and purchasing", kind: "InventoryAdapter", state: "simulated", supplies: "Purchase orders, deliveries, supplier invoices, counts", note: "Simulated records. Waste and counts entered in this demo are stored in your browser." },
  { id: "ledger", system: "Accounting ledger and payroll", kind: "AccountingAdapter", state: "not_connected", supplies: "Posted labor cost, overheads, accounting profit", note: "Not connected. Labor is estimated from rostered hours and overheads are allocated, so every profit figure is labelled an estimate." },
  { id: "payments", system: "Payment reconciliation", kind: "Separate Tyll product", state: "not_connected", supplies: "Till, card company and bank matching", note: "Runs as its own Tyll product and is not rebuilt here." },
  { id: "ai", system: "Language model for explanations", kind: "ExplanationProvider", state: "planned", supplies: "Free-text investigation summaries", note: "Not called in this demo. Explanations are assembled by rules from the recorded facts." },
  { id: "kds", system: "Kitchen display and waste scales", kind: "KdsAdapter", state: "planned", supplies: "Live ticket status, Winnow and Orbisk waste weights", note: "Planned. Flow uses simulated live tickets." },
];
