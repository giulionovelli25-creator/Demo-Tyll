// Tyll Flow (service delay prediction) and Tyll Rooms (front office and housekeeping coordination).
import { itemById, outletById } from "../data/catalog";
import type { Arrival, FlowStatus, LiveOrder, Order, Room, Station } from "../types";
import { sum } from "../util";

// ---- Flow -------------------------------------------------------------------

export interface FlowSim {
  kitchenExtra: number;
  barExtra: number;
}

export const ACTIVE_STATUSES: FlowStatus[] = ["new", "sent", "preparing"];
export const NEXT_STATUS: Partial<Record<FlowStatus, FlowStatus>> = { new: "sent", sent: "preparing", preparing: "ready", ready: "served" };
export const BAR_TARGET_MINUTES = 8;
export const ROOM_DELIVERY_MINUTES = 10;

export function stationCapacity(outletId: string, station: Station): number {
  const o = outletById[outletId];
  return Math.round(o.baseOrders / (station === "kitchen" ? 12 : 14)) + 3;
}

export interface StationLoad {
  outletId: string;
  station: Station;
  active: number;
  capacity: number;
  /** How much longer tickets take at this load. 1 means normal speed. */
  factor: number;
}

export function stationLoad(outletId: string, station: Station, orders: readonly LiveOrder[], sim: FlowSim): StationLoad {
  const active = orders.filter((o) => o.outletId === outletId && o.station === station && ACTIVE_STATUSES.includes(o.status)).length + (station === "kitchen" ? sim.kitchenExtra : sim.barExtra);
  const capacity = stationCapacity(outletId, station);
  return { outletId, station, active, capacity, factor: 1 + 0.55 * Math.max(0, (active - capacity) / capacity) };
}

const ratioCache = new WeakMap<readonly Order[], Map<string, number>>();

/** How long this outlet's kitchen has actually taken, relative to recipe preparation times, over its recorded orders. */
export function historicalPrepRatio(orders: readonly Order[], outletId: string): number {
  let cache = ratioCache.get(orders);
  if (!cache) ratioCache.set(orders, (cache = new Map()));
  const hit = cache.get(outletId);
  if (hit !== undefined) return hit;
  let actual = 0;
  let standard = 0;
  for (const o of orders) {
    if (o.outletId !== outletId) continue;
    for (const l of o.lines) {
      if (l.completedMin === undefined || l.sentMin === undefined) continue;
      actual += l.completedMin - l.sentMin;
      standard += itemById[l.itemId].prepMinutes;
    }
  }
  const ratio = standard > 0 ? actual / standard : 1;
  cache.set(outletId, ratio);
  return ratio;
}

export type FlowRisk = "done" | "on_track" | "at_risk" | "late";

export interface TicketPrediction {
  elapsed: number;
  target: number;
  basePrep: number;
  predictedTotal: number;
  remaining: number;
  risk: FlowRisk;
  cancelRisk: boolean;
  load: StationLoad;
}

export function predictTicket(t: LiveOrder, orders: readonly LiveOrder[], sim: FlowSim, nowMin: number, prepRatio: number): TicketPrediction {
  const load = stationLoad(t.outletId, t.station, orders, sim);
  const prepTimes = t.items.map((i) => itemById[i.itemId].prepMinutes);
  const count = sum(t.items, (i) => i.qty);
  const basePrep = t.station === "kitchen" ? Math.max(...prepTimes) + 1.5 * (count - 1) : sum(t.items, (i) => itemById[i.itemId].prepMinutes * i.qty) * 0.7 + 1;
  const target = t.roomService ? outletById[t.outletId].targetMinutes : t.station === "bar" ? BAR_TARGET_MINUTES : outletById[t.outletId].targetMinutes;
  const elapsed = Math.max(0, nowMin - t.placedMin);
  const delivery = t.roomService ? ROOM_DELIVERY_MINUTES : 0;
  const predictedTotal = basePrep * (t.station === "kitchen" ? prepRatio : 1) * load.factor + delivery;
  if (t.status === "served" || t.status === "cancelled") {
    return { elapsed, target, basePrep, predictedTotal, remaining: 0, risk: "done", cancelRisk: false, load };
  }
  const remaining = t.status === "ready" ? (t.roomService ? delivery : 1) : Math.max(1, predictedTotal - elapsed);
  const finish = elapsed + remaining;
  const risk: FlowRisk = elapsed > target ? "late" : finish > target ? "at_risk" : "on_track";
  return { elapsed, target, basePrep, predictedTotal, remaining, risk, cancelRisk: t.status !== "ready" && finish > target * 1.5, load };
}

// ---- Rooms ------------------------------------------------------------------

/** A second attendant on a priority room shortens the remaining clean. Demo assumption. */
export const PRIORITY_SPEEDUP = 0.55;
export const QUEUE_WAIT_MINUTES = 12;

/** Minute of day the room is expected to be ready for a guest. */
export function roomReadyAt(room: Room, nowMin: number): number | null {
  if (room.status === "ready") return nowMin;
  if (room.status === "cleaning") {
    const done = Math.max(0, nowMin - (room.cleaningStartedMin ?? nowMin));
    const left = Math.max(2, room.cleanMinutes - done);
    return nowMin + left * (room.priority ? PRIORITY_SPEEDUP : 1);
  }
  if (room.status === "dirty") return nowMin + (room.priority ? 3 : QUEUE_WAIT_MINUTES) + room.cleanMinutes * (room.priority ? PRIORITY_SPEEDUP : 1);
  return null;
}

export type ArrivalRisk = "ready" | "ok" | "tight" | "late" | "waiting" | "blocked";

export interface ArrivalView {
  arrival: Arrival;
  room?: Room;
  readyAt: number | null;
  /** Minutes between the room being ready and the guest arriving. Negative means the guest waits. */
  slack: number | null;
  risk: ArrivalRisk;
}

export function assessArrival(arrival: Arrival, room: Room | undefined, nowMin: number): ArrivalView {
  if (!room) return { arrival, room, readyAt: null, slack: null, risk: "blocked" };
  const readyAt = roomReadyAt(room, nowMin);
  if (room.status === "ready") return { arrival, room, readyAt, slack: arrival.etaMin - nowMin, risk: "ready" };
  if (readyAt === null) return { arrival, room, readyAt, slack: null, risk: "blocked" };
  const slack = arrival.etaMin - readyAt;
  if (arrival.status === "waiting") return { arrival, room, readyAt, slack, risk: "waiting" };
  return { arrival, room, readyAt, slack, risk: slack < 0 ? "late" : slack < 10 ? "tight" : "ok" };
}
