// Shared purchasing and preparation records, kept on the server in one JSON file so every user and device sees the
// same request. A demo store: a live system would use a database with transactions.
import fs from "node:fs";
import { dataFile } from "./data-file";
import path from "node:path";
import { ingredientById } from "../data/catalog";
import type { Assignment, Delivery, EventRecord, PrepPlan, PurchaseRequest, SupportRequest } from "../types";
import { seedOps } from "./ops-seed";
import { seedRequests } from "./orders-seed";
import { seedGuest, type GuestShape } from "./guest-seed";
import { emptyNotify, type NotifyShape } from "./notify";
import { seedStage6, type FinanceShape, type SalesShape, type StockLogShape } from "./stage6-seed";
import { DEMO_TODAY, addDays, diffDays } from "../util";
import { defaultAuto, type AutoShape } from "../domain/auto-order";
import { seedProcurement, type ProcurementShape } from "./procurement-seed";
import type { CashUp, StockTake } from "../types";

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
  /** The walking order for stock counts, per hotel. Absent until a manager sets one. */
  countRoutes?: Record<string, string[]>;
  /** Automatic ordering: the rules per hotel and each morning's run. Added on first use. */
  autoOrder?: AutoShape;
  /** Suppliers, catalogues, par levels, purchasing settings and the supplier email log. Added on first use. */
  procurement?: ProcurementShape;
  /** Stock takes, kept for month-end accounting whatever their outcome. */
  stockTakes?: StockTake[];
  /** Cash counted at the end of shifts, entered in Tyll. */
  cashUps?: CashUp[];
  /** The business date the records were last moved to, and the shape of the demo data they were built for. */
  businessDate?: string;
  dataVersion?: number;
}

/** 2: Grand Hotel Lumière, Lisbon, in euros. A store built for an older demo hotel is rebuilt from the seeds. */
const DATA_VERSION = 3;

/** Moves every date in the stored records forward by the days since they were saved, so the demo story stays current. */
function moveToToday(data: Shape): Shape {
  const days = data.businessDate ? diffDays(DEMO_TODAY, data.businessDate) : 0;
  if (days === 0) return { ...data, businessDate: DEMO_TODAY };
  const text = JSON.stringify(data).replace(/\d{4}-\d{2}-\d{2}/g, (d) => addDays(d, days));
  return { ...(JSON.parse(text) as Shape), businessDate: DEMO_TODAY };
}

const empty = (): Shape => ({ version: 1, seq: 7, requests: seedRequests(), plans: [], ...seedOps(), guest: seedGuest(), ...seedStage6(), notify: emptyNotify(), autoOrder: defaultAuto(), procurement: seedProcurement(), stockTakes: [], cashUps: [], businessDate: DEMO_TODAY, dataVersion: DATA_VERSION });

const file = () => process.env.TYLL_PURCHASING_STORE ?? dataFile("purchasing.json");
let cache: { path: string; mtime: number; data: Shape } | null = null;

export function loadStore(): Shape {
  const f = file();
  if (!fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    writeStore(empty());
  }
  const mtime = fs.statSync(f).mtimeMs;
  if (!cache || cache.path !== f || cache.mtime !== mtime) cache = { path: f, mtime, data: JSON.parse(fs.readFileSync(f, "utf8")) as Shape };
  if (cache.data.dataVersion !== DATA_VERSION) writeStore(empty());
  else if (cache.data.businessDate !== DEMO_TODAY) writeStore(moveToToday(cache.data));
  // A store from before Stage 4 gets its events and staffing records added once.
  if (!cache.data.events) {
    writeStore({ ...cache.data, ...seedOps() });
  }
  if (!cache.data.guest) {
    writeStore({ ...cache.data, guest: seedGuest() });
  }
  if (!cache.data.notify) writeStore({ ...cache.data, notify: emptyNotify() });
  if (!cache.data.autoOrder) writeStore({ ...cache.data, autoOrder: defaultAuto() });
  if (!cache.data.procurement || !cache.data.stockTakes || !cache.data.cashUps) writeStore({ ...cache.data, procurement: cache.data.procurement ?? seedProcurement(), stockTakes: cache.data.stockTakes ?? [], cashUps: cache.data.cashUps ?? [] });
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

/** Deliveries recorded against orders, as stock movements. This is the only way a request raises stock. */
export function receivedDeliveries(propertyId?: string): Delivery[] {
  const out: Delivery[] = [];
  for (const r of loadStore().requests) {
    // Orders for events are issued to the event on receipt, not added to the storeroom.
    // Orders that arrived as a delivery in the dataset are already counted there.
    if (r.eventId || r.deliveryId || (propertyId && r.propertyId !== propertyId)) continue;
    if (r.receipts?.length) {
      for (const rc of r.receipts) {
        const lines = rc.lines.filter((l) => l.accepted > 0).map((l) => {
          const o = r.lines.find((x) => x.ingredientId === l.ingredientId);
          return { ingredientId: l.ingredientId, ordered: o?.qty ?? l.delivered, delivered: l.accepted, invoiced: l.accepted, poPrice: o?.unitPrice ?? 0, invoicePrice: o?.unitPrice ?? 0 };
        });
        if (lines.length) out.push({ id: `${r.poNumber ?? r.id}-${rc.id}`, propertyId: r.propertyId, supplierId: r.supplierId ?? ingredientById[r.lines[0]?.ingredientId]?.supplierId ?? "dry", date: rc.at.slice(0, 10), status: "delivered", lines });
      }
      continue;
    }
    if (r.status !== "received") continue;
    out.push({
      id: r.poNumber ?? r.id, propertyId: r.propertyId, supplierId: ingredientById[r.lines[0]?.ingredientId]?.supplierId ?? "dry",
      // Received on the demo day, whatever the real clock says.
      date: DEMO_TODAY, status: "delivered" as const,
      lines: r.lines.filter((l) => (l.received ?? 0) > 0).map((l) => ({ ingredientId: l.ingredientId, ordered: l.qty, delivered: l.received ?? 0, invoiced: l.received ?? 0, poPrice: l.unitPrice, invoicePrice: l.unitPrice })),
    });
  }
  return out;
}
