// Shared purchasing and preparation records, kept on the server in one JSON file so every user and device sees the
// same request. A demo store: a live system would use a database with transactions.
import fs from "node:fs";
import path from "node:path";
import { ingredientById } from "../data/catalog";
import type { Assignment, Delivery, EventRecord, PrepPlan, PurchaseRequest, SupportRequest } from "../types";
import { seedOps } from "./ops-seed";
import { seedGuest, type GuestShape } from "./guest-seed";
import { emptyNotify, type NotifyShape } from "./notify";
import { seedStage6, type FinanceShape, type SalesShape, type StockLogShape } from "./stage6-seed";
import { DEMO_TODAY } from "../util";

export interface Shape {
  version: 1;
  seq: number;
  requests: PurchaseRequest[];
  plans: PrepPlan[];
  /** Events, staff support requests and assignments (Stage 4). Seeded on first use. */
  events: EventRecord[];
  support: SupportRequest[];
  assignments: Assignment[];
  counters: Record<string, number>;
  /** Rooms, arrivals, bell tasks, guest requests, Guest Connect and the service log (Stage 5). */
  guest: GuestShape;
  /** Supplier invoices recorded in Tyll and reviews of the dataset's invoices (Stage 6). */
  finance: FinanceShape;
  /** Opportunities and proposals (Stage 6). */
  sales: SalesShape;
  /** Waste, corrections and stock counts saved on the server, shared by every device (Stage 6). */
  stockLog: StockLogShape;
  /** Notifications and the email log (Stage 7). */
  notify: NotifyShape;
}

const empty = (): Shape => ({ version: 1, seq: 0, requests: [], plans: [], ...seedOps(), guest: seedGuest(), ...seedStage6(), notify: emptyNotify() });

const file = () => process.env.TYLL_PURCHASING_STORE ?? path.join(process.cwd(), ".data", "purchasing.json");
let cache: { path: string; mtime: number; data: Shape } | null = null;

export function loadStore(): Shape {
  const f = file();
  if (!fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    writeStore(empty());
  }
  const mtime = fs.statSync(f).mtimeMs;
  if (!cache || cache.path !== f || cache.mtime !== mtime) cache = { path: f, mtime, data: JSON.parse(fs.readFileSync(f, "utf8")) as Shape };
  // A store from before Stage 4 gets its events and staffing records added once.
  if (!cache.data.events) {
    writeStore({ ...cache.data, ...seedOps() });
  }
  if (!cache.data.guest) {
    writeStore({ ...cache.data, guest: seedGuest() });
  }
  if (!cache.data.notify) writeStore({ ...cache.data, notify: emptyNotify() });
  if (!cache.data.finance || !cache.data.sales || !cache.data.stockLog) {
    const add = seedStage6();
    writeStore({ ...cache.data, finance: cache.data.finance ?? add.finance, sales: cache.data.sales ?? add.sales, stockLog: cache.data.stockLog ?? add.stockLog });
  }
  return cache.data;
}

function writeStore(data: Shape) {
  const f = file();
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, f);
  cache = { path: f, mtime: fs.statSync(f).mtimeMs, data };
}

/** Runs a change against the store and saves it. Node runs one request handler at a time, so changes do not interleave. */
export function mutateStore<T>(run: (s: Shape) => T): T {
  const s = structuredClone(loadStore());
  const out = run(s);
  writeStore(s);
  return out;
}

export function resetPurchasingStore() {
  writeStore(empty());
}

/** Takes the next number in a sequence, such as events or support requests at one hotel. */
export const nextNumber = (s: Shape, key: string) => (s.counters[key] = (s.counters[key] ?? 0) + 1);

/** Approved orders that have been received, as deliveries. This is the only way a request raises stock. */
export function receivedDeliveries(propertyId?: string): Delivery[] {
  return loadStore().requests
    // Orders for events are issued to the event on receipt, not added to the storeroom.
    .filter((r) => r.status === "received" && !r.eventId && (!propertyId || r.propertyId === propertyId))
    .map((r) => {
      return {
        id: r.poNumber ?? r.id, propertyId: r.propertyId, supplierId: ingredientById[r.lines[0]?.ingredientId]?.supplierId ?? "dry",
        // Received on the demo day, whatever the real clock says.
        date: DEMO_TODAY, status: "delivered" as const,
        lines: r.lines.filter((l) => (l.received ?? 0) > 0).map((l) => ({ ingredientId: l.ingredientId, ordered: l.qty, delivered: l.received ?? 0, invoiced: l.received ?? 0, poPrice: l.unitPrice, invoicePrice: l.unitPrice })),
      };
    });
}
