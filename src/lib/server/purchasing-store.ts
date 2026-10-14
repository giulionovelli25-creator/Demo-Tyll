// Shared purchasing and preparation records, kept on the server in one JSON file so every user and device sees the
// same request. A demo store: a live system would use a database with transactions.
import fs from "node:fs";
import path from "node:path";
import { ingredientById } from "../data/catalog";
import type { Delivery, PrepPlan, PurchaseRequest } from "../types";
import { DEMO_TODAY } from "../util";

interface Shape {
  version: 1;
  seq: number;
  requests: PurchaseRequest[];
  plans: PrepPlan[];
}

const file = () => process.env.TYLL_PURCHASING_STORE ?? path.join(process.cwd(), ".data", "purchasing.json");
let cache: { path: string; mtime: number; data: Shape } | null = null;

export function loadStore(): Shape {
  const f = file();
  if (!fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    writeStore({ version: 1, seq: 0, requests: [], plans: [] });
  }
  const mtime = fs.statSync(f).mtimeMs;
  if (!cache || cache.path !== f || cache.mtime !== mtime) cache = { path: f, mtime, data: JSON.parse(fs.readFileSync(f, "utf8")) as Shape };
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
  writeStore({ version: 1, seq: 0, requests: [], plans: [] });
}

/** Approved orders that have been received, as deliveries. This is the only way a request raises stock. */
export function receivedDeliveries(propertyId?: string): Delivery[] {
  return loadStore().requests
    .filter((r) => r.status === "received" && (!propertyId || r.propertyId === propertyId))
    .map((r) => {
      return {
        id: r.poNumber ?? r.id, propertyId: r.propertyId, supplierId: ingredientById[r.lines[0]?.ingredientId]?.supplierId ?? "dry",
        // Received on the demo day, whatever the real clock says.
        date: DEMO_TODAY, status: "delivered" as const,
        lines: r.lines.filter((l) => (l.received ?? 0) > 0).map((l) => ({ ingredientId: l.ingredientId, ordered: l.qty, delivered: l.received ?? 0, invoiced: l.received ?? 0, poPrice: l.unitPrice, invoicePrice: l.unitPrice })),
      };
    });
}
