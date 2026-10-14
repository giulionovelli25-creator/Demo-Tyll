// Starting records for rooms and guest service, taken from the existing Rooms demo data for Grand Resort Dubai.
// Housekeepers are the Stage 4 Housekeeping team. Earlier service times are seeded demo history, labelled as such.
import { getDataset } from "../data/generate";
import type { ServiceLogEntry } from "../domain/guest";
import type { ArrivalOps, BellTask, GcRequest, HkStatus, RoomOps, ServiceRequest } from "../types";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays } from "../util";

export interface GuestShape {
  /** Real time the demo clock started. The demo clock moves on one minute per real minute from 20:55. */
  clockBase: string;
  rooms: RoomOps[];
  arrivals: ArrivalOps[];
  bell: BellTask[];
  requests: ServiceRequest[];
  gc: GcRequest[];
  log: ServiceLogEntry[];
}

const HOUSEKEEPERS = ["HK-01", "HK-02", "HK-03", "HK-04", "HK-05", "HK-06", "HK-07"];
const STATUS: Record<string, HkStatus> = { occupied: "occupied", departure_due: "occupied", dirty: "vacant_dirty", cleaning: "cleaning", ready: "ready", out_of_order: "out_of_service" };

export function seedGuest(): GuestShape {
  const d = getDataset();
  const team = d.attendants.filter((a) => a.propertyId === "dxb").map((a) => a.id);
  const hkOf = (attendantId?: string) => (attendantId ? HOUSEKEEPERS[Math.max(0, team.indexOf(attendantId)) % HOUSEKEEPERS.length] : undefined);
  let dirty = 0;
  const rooms: RoomOps[] = d.rooms.filter((r) => r.propertyId === "dxb").map((r) => {
    const status = STATUS[r.status];
    // About half the rooms waiting to be cleaned already have a housekeeper.
    const housekeeperId = status === "cleaning" ? hkOf(r.attendantId) : status === "vacant_dirty" && dirty++ % 2 === 0 ? HOUSEKEEPERS[(dirty + 2) % HOUSEKEEPERS.length] : undefined;
    return {
      roomId: r.id, propertyId: r.propertyId, number: r.number, floor: Math.floor(Number(r.number) / 100), type: r.type, status,
      occupancy: r.status === "departure_due" ? "due_out" : r.status === "occupied" ? "occupied" : "vacant",
      housekeeperId, startedMin: status === "cleaning" ? r.cleaningStartedMin : undefined, readyMin: status === "ready" ? DEMO_NOW_MIN - 60 : undefined,
      priority: false, issues: [], history: [{ min: DEMO_NOW_MIN - 90, by: "system", action: `Status from the property system: ${status.replace("_", " ")}` }],
    };
  });
  const arrivals: ArrivalOps[] = d.arrivals.filter((a) => a.propertyId === "dxb").map((a) => ({
    id: a.id, propertyId: a.propertyId, guest: a.guest.split(" ").slice(-1)[0], roomId: `dxb-${a.room}`, etaMin: a.etaMin, vip: a.vip, status: a.status,
  }));
  const room = (n: number) => rooms.filter((r) => r.status === "occupied")[n]?.number ?? rooms[0].number;
  const bell: BellTask[] = [
    { id: "BT-DXB-0001", propertyId: "dxb", kind: "delivery", room: room(2), from: "Lobby", to: `Room ${room(2)}`, bags: 3, requestedBy: "u-fo", requestedMin: 19 * 60 + 40, assigneeId: "BELL-02", priority: "normal", status: "completed", handover: "Placed in the room with the guest present",
      history: [{ min: 19 * 60 + 40, by: "u-fo", action: "Requested" }, { min: 19 * 60 + 42, by: "u-bellcap", action: "Assigned" }, { min: 19 * 60 + 47, by: "BELL-02", action: "Collected" }, { min: 19 * 60 + 52, by: "BELL-02", action: "Delivered" }, { min: 19 * 60 + 53, by: "BELL-02", action: "Completed" }] },
    { id: "BT-DXB-0002", propertyId: "dxb", kind: "departure", room: room(5), from: `Room ${room(5)}`, to: "Lobby, taxi rank", bags: 2, requestedBy: "u-con", requestedMin: DEMO_NOW_MIN - 10, assigneeId: "BELL-02", priority: "normal", status: "on_the_way",
      history: [{ min: DEMO_NOW_MIN - 10, by: "u-con", action: "Requested" }, { min: DEMO_NOW_MIN - 8, by: "u-bellcap", action: "Assigned" }, { min: DEMO_NOW_MIN - 6, by: "BELL-02", action: "On the way" }] },
  ];
  const requests: ServiceRequest[] = d.requests.filter((r) => r.propertyId === "dxb").map((r, i) => ({
    id: `GR-DXB-${String(i + 1).padStart(4, "0")}`, propertyId: "dxb", kind: r.department === "front_office" ? "general" : "assistance", room: r.room, details: r.text, forMin: r.raisedMin,
    priority: r.department === "engineering" ? "urgent" : "normal", deptId: r.department === "housekeeping" ? "dxb-hk" : "dxb-fo", status: "new", createdBy: "u-con", createdMin: r.raisedMin,
    history: [{ min: r.raisedMin, by: "u-con", action: "Request raised" }],
  }));
  requests.push({ id: "GR-DXB-0006", propertyId: "dxb", kind: "taxi", room: room(7), details: "Taxi to the airport, 2 guests, 4 bags", forMin: 7 * 60 + 30, priority: "normal", deptId: "dxb-conc", status: "awaiting_confirmation", createdBy: "u-con", createdMin: DEMO_NOW_MIN - 25,
    history: [{ min: DEMO_NOW_MIN - 25, by: "u-con", action: "Request raised" }, { min: DEMO_NOW_MIN - 22, by: "u-con", action: "Asked the taxi company; waiting for their confirmation" }] });

  // Demo history: yesterday and earlier today. Recorded times only; no guest ratings.
  const log: ServiceLogEntry[] = [];
  const add = (date: string, kind: ServiceLogEntry["kind"], n: number, make: (i: number) => Partial<ServiceLogEntry>) => {
    for (let i = 0; i < n; i++) log.push({ id: `L-${date}-${kind}-${i}`, date, propertyId: "dxb", kind, ref: "", createdMin: 0, doneMin: 0, target: 0, seeded: true, ...make(i) } as ServiceLogEntry);
  };
  const yday = addDays(DEMO_TODAY, -1);
  add(yday, "room", 14, (i) => ({ createdMin: 11 * 60 + i * 20, doneMin: 13 * 60 + i * 22, target: 13 * 60 + i * 20 + (i % 4 === 0 ? -15 : 10) }));
  add(yday, "bell", 9, (i) => ({ createdMin: 10 * 60 + i * 45, assignedMin: 10 * 60 + i * 45 + 3 + (i % 3), doneMin: 10 * 60 + i * 45 + 12 + (i % 4) * 4, target: 15 }));
  add(yday, "request", 8, (i) => ({ createdMin: 9 * 60 + i * 60, assignedMin: 9 * 60 + i * 60 + 6, doneMin: 9 * 60 + i * 60 + 18 + (i % 3) * 9, target: 20, escalated: i === 5 }));
  add(yday, "gc", 4, (i) => ({ createdMin: 17 * 60 + i * 30, assignedMin: 17 * 60 + i * 30 + 7, doneMin: 17 * 60 + i * 30 + 7, target: 10, confirmed: i !== 2 }));
  add(DEMO_TODAY, "room", 9, (i) => ({ createdMin: 11 * 60 + i * 25, doneMin: 12 * 60 + 30 + i * 25, target: 12 * 60 + 30 + i * 25 + (i === 6 ? -10 : 15) }));
  add(DEMO_TODAY, "bell", 6, (i) => ({ createdMin: 10 * 60 + i * 50, assignedMin: 10 * 60 + i * 50 + 2, doneMin: 10 * 60 + i * 50 + 10 + (i % 2) * 3, target: 15 }));
  add(DEMO_TODAY, "request", 6, (i) => ({ createdMin: 9 * 60 + i * 70, assignedMin: 9 * 60 + i * 70 + 4, doneMin: 9 * 60 + i * 70 + 15 + (i % 2) * 6, target: 20 }));
  add(DEMO_TODAY, "gc", 2, (i) => ({ createdMin: 18 * 60 + i * 40, assignedMin: 18 * 60 + i * 40 + 5, doneMin: 18 * 60 + i * 40 + 5, target: 10, confirmed: true }));
  return { clockBase: new Date().toISOString(), rooms, arrivals, bell, requests, gc: [], log };
}
