// The browser's copy of the data. It is filled only from /api/data, which filters records
// for the signed-in user on the server, and it is emptied whenever the session locks.
import type { Snapshot } from "../server/snapshot";
import type { Order } from "../types";
import type { Dataset } from "./generate";

let current: Dataset | null = null;

export function hydrateDataset(s: Snapshot): Dataset {
  current = { ...s, orders: [], ordersById: new Map(), chargesById: new Map(s.roomCharges.map((c) => [c.id, c])) };
  return current;
}

export function getDataset(): Dataset {
  if (!current) throw new Error("Data is not loaded yet.");
  return current;
}

export const hasDataset = () => current !== null;

export function clearDataset() {
  current = null;
}

/** Orders arrive one request at a time and are kept for the rest of the session. */
export function rememberOrders(orders: Order[]) {
  if (!current) return;
  for (const o of orders) current.ordersById.set(o.id, o);
}
