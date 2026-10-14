// Room readiness, arrival risk, venue availability and service measurements. Plain arithmetic on recorded times and
// stated demo planning assumptions. Estimates are estimates: nothing here is a guarantee or a guest outcome.
import type { ArrivalOps, RoomOps } from "../types";

/** Demo planning assumptions, shown wherever an estimate uses them. */
export const HK_RULES = {
  cleanMinutes: { standard: 30, suite: 50 },
  /** A second person on the room takes this share of the time. */
  helperFactor: 0.6,
  inspectMinutes: 10,
  priorityInspectMinutes: 5,
  /** Hotels that inspect every room before it is released. */
  inspectionRequired: { dxb: true, doh: false } as Record<string, boolean>,
};

export const SERVICE_TARGETS = {
  /** Minutes from request to bags delivered. */
  bell: 15,
  /** Minutes for an outlet to answer a Guest Connect request. */
  gcResponse: 10,
  /** Minutes to complete a guest service request, by kind. */
  request: { taxi: 15, restaurant: 20, spa: 30, activity: 30, assistance: 20, bell: 15, general: 30 } as Record<string, number>,
};

export const isSuite = (type: string) => /suite/i.test(type);
export const cleanMinutes = (r: Pick<RoomOps, "type" | "helperId">) => Math.round((isSuite(r.type) ? HK_RULES.cleanMinutes.suite : HK_RULES.cleanMinutes.standard) * (r.helperId ? HK_RULES.helperFactor : 1));
export const needsInspection = (propertyId: string) => HK_RULES.inspectionRequired[propertyId] ?? false;

export interface ReadyEstimate {
  /** Minute of the day the room should be ready, or null when it cannot be estimated. */
  readyAt: number | null;
  /** Each step behind the estimate, in plain words. */
  steps: string[];
}

const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

/**
 * When will this room be ready? A housekeeper works through their rooms in order: the room in progress, then priority
 * rooms, then the rest. Unassigned rooms wait for whoever on shift frees up first. Inspection is added where required.
 */
export function estimateReady(room: RoomOps, all: readonly RoomOps[], housekeepers: readonly string[], now: number): ReadyEstimate {
  const inspect = needsInspection(room.propertyId) ? (room.priority ? HK_RULES.priorityInspectMinutes : HK_RULES.inspectMinutes) : 0;
  const inspectStep = inspect ? [`Inspection by a supervisor: about ${inspect} minutes${room.priority ? " (priority)" : ""}.`] : [];
  if (room.status === "ready") return { readyAt: room.readyMin ?? now, steps: [`Released as ready at ${hm(room.readyMin ?? now)}.`] };
  if (room.status === "out_of_service") return { readyAt: null, steps: ["Out of service. It cannot be offered until engineering releases it."] };
  if (room.status === "occupied") return { readyAt: null, steps: [room.occupancy === "due_out" ? "The guest has not checked out yet." : "A guest is staying in this room."] };
  if (room.status === "inspection") return { readyAt: now + inspect, steps: [`Cleaned at ${hm(room.cleanedMin ?? now)}.`, ...inspectStep] };

  // When each housekeeper becomes free, given the rooms ahead of this one.
  const queueOf = (hk: string) => all.filter((r) => r.housekeeperId === hk && (r.status === "cleaning" || r.status === "vacant_dirty"))
    .sort((a, b) => Number(b.status === "cleaning") - Number(a.status === "cleaning") || Number(b.priority) - Number(a.priority) || (a.priorityRequestedMin ?? 1e9) - (b.priorityRequestedMin ?? 1e9) || a.number.localeCompare(b.number));
  const finish = (hk: string, stopAt?: string) => {
    let t = now;
    for (const r of queueOf(hk)) {
      if (r.status === "cleaning") t = Math.max(now, (r.startedMin ?? now) + cleanMinutes(r));
      else t += cleanMinutes(r);
      if (r.roomId === stopAt) return t;
    }
    return t;
  };

  if (room.status === "cleaning") {
    const end = Math.max(now + 2, (room.startedMin ?? now) + cleanMinutes(room));
    return {
      readyAt: end + inspect,
      steps: [
        `Cleaning started at ${hm(room.startedMin ?? now)}; a ${isSuite(room.type) ? "suite" : "standard room"} takes about ${cleanMinutes(room)} minutes${room.helperId ? " with a second person" : ""}.`,
        `Cleaning should finish about ${hm(end)}.`, ...inspectStep,
      ],
    };
  }
  // Vacant and dirty.
  if (room.housekeeperId) {
    const ahead = queueOf(room.housekeeperId).findIndex((r) => r.roomId === room.roomId);
    const end = finish(room.housekeeperId, room.roomId);
    return {
      readyAt: end + inspect,
      steps: [
        ahead > 0 ? `${ahead} room${ahead === 1 ? "" : "s"} ahead of it for the same housekeeper${room.priority ? ", priority rooms first" : ""}.` : "Next for its housekeeper.",
        `Then about ${cleanMinutes(room)} minutes to clean, finishing about ${hm(end)}.`, ...inspectStep,
      ],
    };
  }
  if (!housekeepers.length) return { readyAt: null, steps: ["Nobody from housekeeping is on shift."] };
  const free = Math.min(...housekeepers.map((h) => finish(h)));
  return {
    readyAt: free + cleanMinutes(room) + inspect,
    steps: [`Not assigned yet. The first housekeeper is free about ${hm(free)}.`, `Then about ${cleanMinutes(room)} minutes to clean.`, ...inspectStep],
  };
}

export type ArrivalRisk = "ready" | "on_time" | "tight" | "late" | "waiting" | "unknown";

export interface ArrivalAssessment {
  risk: ArrivalRisk;
  /** Minutes the guest would wait after arriving. Positive is a delay. */
  delay: number | null;
}

export function assessArrival(a: ArrivalOps, est: ReadyEstimate, room: RoomOps | undefined, now: number): ArrivalAssessment {
  if (room?.status === "ready") return { risk: "ready", delay: 0 };
  if (est.readyAt === null) return { risk: "unknown", delay: null };
  const delay = Math.round(est.readyAt - a.etaMin);
  if (a.status === "waiting" || a.etaMin <= now) return { risk: "waiting", delay: Math.max(0, Math.round(est.readyAt - now)) };
  return { risk: delay > 0 ? "late" : delay > -10 ? "tight" : "on_time", delay };
}

// ---- Venues ------------------------------------------------------------------------------------------------------

export type VenueKind = "restaurant" | "lounge" | "spa" | "activity";

export interface Venue {
  id: string;
  propertyId: string;
  name: string;
  kind: VenueKind;
  /** Outlet that answers requests, when the venue is an outlet. */
  outletId?: string;
  /** Seats or treatment rooms per half-hour slot. Null when there is no capacity record: requests only. */
  capacity: number | null;
  opens: number;
  closes: number;
  note: string;
}

export const VENUES: Venue[] = [
  { id: "dxb-terrace", propertyId: "dxb", name: "The Terrace", kind: "restaurant", outletId: "dxb-terrace", capacity: 30, opens: 12 * 60, closes: 23 * 60, note: "All-day casual dining, terrace seating" },
  { id: "dxb-lune", propertyId: "dxb", name: "Maison Lune", kind: "restaurant", outletId: "dxb-lune", capacity: 16, opens: 18 * 60 + 30, closes: 23 * 60, note: "Fine dining, French" },
  { id: "dxb-lobby", propertyId: "dxb", name: "Lobby Lounge", kind: "lounge", outletId: "dxb-lobby", capacity: 24, opens: 9 * 60, closes: 24 * 60, note: "Afternoon tea, coffee and cocktails" },
  { id: "dxb-pool", propertyId: "dxb", name: "Azure Pool Bar", kind: "lounge", outletId: "dxb-pool", capacity: 20, opens: 10 * 60, closes: 22 * 60, note: "Poolside drinks and light meals" },
  { id: "dxb-spa", propertyId: "dxb", name: "Serenity Spa", kind: "spa", capacity: 3, opens: 9 * 60, closes: 21 * 60, note: "Massage and facial treatments" },
  { id: "dxb-tour", propertyId: "dxb", name: "Desert sunrise tour", kind: "activity", capacity: null, opens: 5 * 60, closes: 7 * 60, note: "Arranged with a partner; availability on request" },
  { id: "doh-dana", propertyId: "doh", name: "Al Dana", kind: "restaurant", outletId: "doh-dana", capacity: 20, opens: 18 * 60, closes: 23 * 60, note: "Signature restaurant" },
  { id: "doh-sky", propertyId: "doh", name: "Skyline", kind: "lounge", outletId: "doh-sky", capacity: 26, opens: 17 * 60, closes: 24 * 60 + 60, note: "Rooftop bar" },
];
export const venueById: Record<string, Venue> = Object.fromEntries(VENUES.map((v) => [v.id, v]));

/** Seats already booked in a slot, from a deterministic demo pattern. Simulated, not a reservation system. */
export function bookedSeats(venueId: string, date: string, slot: number): number {
  const v = venueById[venueId];
  if (!v?.capacity) return 0;
  let h = 0;
  for (const c of `${venueId}|${date}|${slot}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  // Busiest around dinner; quieter early and late.
  const peak = slot >= 19 * 60 && slot <= 20 * 60 + 30 ? 0.75 : slot >= 18 * 60 && slot <= 21 * 60 ? 0.55 : 0.3;
  return Math.min(v.capacity, Math.round(v.capacity * (peak + ((h % 20) - 10) / 100)));
}

export const slotOf = (min: number) => Math.floor(min / 30) * 30;

export type Availability = "likely" | "limited" | "request" | "closed";

/** What the demo records say about a time: likely, limited, or ask the venue. Never a confirmed table. */
export function availabilityAt(v: Venue, date: string, min: number, party: number, held: number): { status: Availability; free: number | null } {
  if (min < v.opens || min + 30 > v.closes) return { status: "closed", free: 0 };
  if (v.capacity === null) return { status: "request", free: null };
  const free = v.capacity - bookedSeats(v.id, date, slotOf(min)) - held;
  return { status: free >= party + 4 ? "likely" : free >= party ? "limited" : "request", free };
}

// ---- Measurements ------------------------------------------------------------------------------------------------

export interface ServiceLogEntry {
  id: string;
  date: string;
  propertyId: string;
  kind: "room" | "bell" | "request" | "gc";
  ref: string;
  createdMin: number;
  assignedMin?: number;
  doneMin: number;
  /** Minutes allowed; for a room, the arrival time it had to be ready by. */
  target: number;
  escalated?: boolean;
  /** For Guest Connect: the outlet confirmed the request. Not proof the guest dined. */
  confirmed?: boolean;
  seeded?: boolean;
}

export interface ServiceMetrics {
  roomsOnTime: { done: number; onTime: number };
  requestsInTarget: { done: number; inTarget: number };
  avgResponse: number | null;
  avgCompletion: number | null;
  bellAvg: number | null;
  escalated: number;
  gcConfirmed: number;
}

/** Figures for one day, from recorded times. A room is "on time" if it was released as ready by the guest's expected arrival. */
export function metricsFor(log: readonly ServiceLogEntry[], date: string, propertyId: string): ServiceMetrics {
  const day = log.filter((e) => e.date === date && e.propertyId === propertyId);
  const rooms = day.filter((e) => e.kind === "room");
  const tasks = day.filter((e) => e.kind === "bell" || e.kind === "request");
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  return {
    roomsOnTime: { done: rooms.length, onTime: rooms.filter((e) => e.doneMin <= e.target).length },
    requestsInTarget: { done: tasks.length, inTarget: tasks.filter((e) => e.doneMin - e.createdMin <= e.target).length },
    avgResponse: avg(tasks.filter((e) => e.assignedMin !== undefined).map((e) => e.assignedMin! - e.createdMin)),
    avgCompletion: avg(tasks.map((e) => e.doneMin - e.createdMin)),
    bellAvg: avg(day.filter((e) => e.kind === "bell").map((e) => e.doneMin - e.createdMin)),
    escalated: day.filter((e) => e.escalated).length,
    gcConfirmed: day.filter((e) => e.kind === "gc" && e.confirmed).length,
  };
}
