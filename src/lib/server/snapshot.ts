// What each user is allowed to receive. Records outside a user's outlets never leave the server,
// and operational staff receive quantities only, with no sales or cost figures.
import { outletById, storeOwner } from "../data/catalog";
import { demoCases } from "../data/demo-cases";
import { getDataset, type Dataset } from "../data/generate";
import { allowedOutlets, allowedProperties, can, hasWholeProperty } from "../domain/access";
import { detectOrderException } from "../domain/detect";
import { historicalPrepRatio } from "../domain/operations";
import { orderTotals } from "../domain/orders";
import type { Order, User } from "../types";
import { publicDemo } from "./auth";
import { confirmedByStockTake } from "./stocktake";
import { boughtUsedCases } from "./bought-used";
import type { Exception } from "../types";

/** The dataset as sent to the browser: no orders (fetched one by one) and no lookup maps. */
export type Snapshot = Omit<Dataset, "orders" | "ordersById" | "chargesById"> & { prepRatios: Record<string, number> };

const cache = new Map<string, Snapshot>();

export function snapshotFor(user: User): Snapshot {
  const props = new Set(allowedProperties(user));
  const whole = new Set([...props].filter((p) => hasWholeProperty(user, p)));
  // Staff and the head chef get quantities without money. Purchasing gets no sales at all: it needs stock, suppliers and prices.
  const staff = user.role === "employee" || user.role === "chef";
  const flags = !staff && user.role !== "purchasing";
  // Bought against used is worked out from today's server records (deliveries received in Tyll, shared waste, checks),
  // so its flags are added on every call and their state is part of the cache key.
  const bought = flags && can(user, "stock.boughtUsed") ? boughtUsedCases([...whole]) : { exceptions: [], seed: {} };
  // The whole starting state (who closed it, the notes) and the count beside it are in the key, not only the status.
  const signature = JSON.stringify(bought.exceptions.map((e) => [e.id, e.exposure, e.boughtUsed?.lastCount ?? null, bought.seed[e.id]]));
  const key = `${publicDemo()}|${user.role}|${JSON.stringify(user.propertyIds)}|${JSON.stringify(user.outletIds)}|${signature}`;
  const hit = cache.get(key);
  if (hit) return withBasis(hit);
  if (cache.size > 200) cache.clear();
  const d = getDataset();
  const outlets = new Set(allowedOutlets(user));
  // Purchasing and the hotel departments get no outlet sales.
  const procurement = user.role === "purchasing" || !!user.deptId;
  const byOutlet = <T extends { outletId: string }>(rows: T[]) => rows.filter((r) => outlets.has(r.outletId));
  const all = [...d.exceptions, ...bought.exceptions];
  const seed = { ...d.seedInvestigations, ...bought.seed };
  const cases = publicDemo() ? demoCases(all, seed) : all;
  const exceptions = flags ? cases.filter((e) => (e.outletId ? outlets.has(e.outletId) : whole.has(e.propertyId))) : [];
  const seedInvestigations = Object.fromEntries(exceptions.map((e) => [e.id, seed[e.id]]));

  const snap: Snapshot = {
    dayItems: procurement ? [] : byOutlet(d.dayItems).map((r) => (staff ? { ...r, gross: 0, comps: 0, discounts: 0, refunds: 0 } : r)),
    dayOutlets: staff || procurement ? [] : byOutlet(d.dayOutlets),
    // Room numbers and check-out times are guest data: only roles that work the room charge check receive them.
    roomCharges: staff || procurement || !can(user, "roomcharge.view") ? [] : d.roomCharges.filter((c) => (c.outletId ? outlets.has(c.outletId) : whole.has(c.propertyId))),
    exceptions,
    seedInvestigations,
    wasteLogs: byOutlet(d.wasteLogs),
    // Counts of an outlet's own store go only to people with access to that outlet.
    counts: d.counts.filter((c) => props.has(c.propertyId) && (!storeOwner(c.propertyId, c.ingredientId) || outlets.has(storeOwner(c.propertyId, c.ingredientId)!))),
    deliveries: d.deliveries.filter((x) => props.has(x.propertyId)).map((x) => (staff ? { ...x, lines: x.lines.map((l) => ({ ...l, poPrice: 0, invoicePrice: 0 })) } : x)),
    transfers: d.transfers.filter((t) => props.has(t.propertyId)),
    occupancy: d.occupancy.filter((o) => props.has(o.propertyId)),
    reservations: byOutlet(d.reservations),
    events: d.events.filter((e) => props.has(e.propertyId)),
    liveOrders: byOutlet(d.liveOrders),
    rooms: d.rooms.filter((r) => whole.has(r.propertyId)),
    arrivals: d.arrivals.filter((a) => whole.has(a.propertyId)),
    attendants: d.attendants.filter((a) => whole.has(a.propertyId)),
    requests: d.requests.filter((r) => whole.has(r.propertyId)),
    prepRatios: Object.fromEntries([...outlets].map((id) => [id, historicalPrepRatio(d.orders, id)])),
  };
  cache.set(key, snap);
  return withBasis(snap);
}

/** Stock based losses stay estimates until an approved stock take on or after the flag counted the item. */
function withBasis(snap: Snapshot): Snapshot {
  const confirm = (e: Exception): Exception => {
    if ((e.type !== "usage_variance" && e.type !== "stock_shortfall") || !e.ingredientId) return e;
    // Confirmed only by a stock take of the same place: the outlet for its working stock, otherwise the store holding it.
    const location = e.type === "usage_variance" && e.outletId ? e.outletId : storeOwner(e.propertyId, e.ingredientId) ?? "main";
    const take = confirmedByStockTake(e.propertyId, e.ingredientId, e.date, location);
    return take ? { ...e, basis: "confirmed", comparedWith: `${e.comparedWith ?? ""} Confirmed by stock take ${take}.`.trim() } : { ...e, basis: "estimate" };
  };
  return { ...snap, exceptions: snap.exceptions.map(confirm) };
}

export const canSeeOrder = (user: User, o: Order) => user.role !== "employee" && allowedOutlets(user).includes(o.outletId);

export function orderById(user: User, id: string): Order | null {
  const o = getDataset().ordersById.get(id);
  return o && canSeeOrder(user, o) ? o : null;
}

export function ordersOnDate(user: User, date: string): Order[] {
  return getDataset().orders.filter((o) => o.date === date && canSeeOrder(user, o));
}

export interface ItemOrderRow {
  id: string;
  outletId: string;
  date: string;
  openMin: number;
  qty: number;
  state: string;
  flagged: boolean;
}

/** Orders containing one menu item, reduced to what the item page lists. */
export function ordersWithItem(user: User, itemId: string, from: string, to: string, outletIds: string[]): ItemOrderRow[] {
  const wanted = new Set(outletIds.filter((id) => allowedOutlets(user).includes(id)));
  if (user.role === "employee") return [];
  const out: ItemOrderRow[] = [];
  for (const o of getDataset().orders) {
    if (o.date < from || o.date > to || !wanted.has(o.outletId)) continue;
    const line = o.lines.find((l) => l.itemId === itemId);
    if (!line) continue;
    out.push({ id: o.id, outletId: o.outletId, date: o.date, openMin: o.openMin, qty: line.qty, state: o.voided ? "voided" : line.state, flagged: !!detectOrderException(o) });
  }
  return out.sort((a, b) => (a.date === b.date ? b.openMin - a.openMin : a.date < b.date ? 1 : -1));
}

export function searchOrders(user: User, q: string, limit = 8): { id: string; outletId: string; date: string; openMin: number; net: number }[] {
  const term = q.trim().toUpperCase();
  if (term.length < 3 || user.role === "employee") return [];
  const out = [];
  for (const o of getDataset().orders) {
    if (out.length >= limit) break;
    if (o.id.includes(term) && canSeeOrder(user, o)) out.push({ id: o.id, outletId: o.outletId, date: o.date, openMin: o.openMin, net: orderTotals(o).net });
  }
  return out;
}

export const outletName = (id: string) => outletById[id]?.name ?? id;
