// Rooms and guest service, shared on the server so the front desk, housekeeping, the bell team and the outlets all see
// the same record. Each action checks the role, the department or outlet, and the record's current state.
import { userById } from "../data/catalog";
import { EMPLOYEES, deptById, employeeById, shiftsOf } from "../data/workforce";
import { allowedProperties, can } from "../domain/access";
import { SERVICE_TARGETS, assessArrival, estimateReady, needsInspection, type ArrivalAssessment, type ReadyEstimate } from "../domain/guest";
import type { ArrivalOps, BellKind, BellStatus, BellTask, RoomOps, User } from "../types";
import { DEMO_NOW_MIN, DEMO_TODAY } from "../util";
import type { GuestShape } from "./guest-seed";
import { loadStore, mutateStore, nextNumber, type Shape } from "./purchasing-store";

type Fail = { ok: false; status: number; error: string };
export type Result<T = object> = ({ ok: true } & T) | Fail;
export const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const text = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The demo clock: 20:55 when the demo data was created, then one minute per real minute, up to the end of the day. */
export function demoNow(g: Pick<GuestShape, "clockBase"> = loadStore().guest): number {
  const elapsed = Math.floor((Date.now() - new Date(g.clockBase).getTime()) / 60000);
  return Math.min(23 * 60 + 59, DEMO_NOW_MIN + Math.max(0, elapsed));
}

/** Rooms and guest service run for whole hotels the user may see, on Grand Resort Dubai in this demo. */
const guestProperty = (user: User) => (allowedProperties(user).includes("dxb") ? "dxb" : null);
const mayView = (user: User) => can(user, "rooms.view") || can(user, "hk.clean") || can(user, "bell.task") || can(user, "gc.respond");

/** Housekeepers on shift now, and anyone confirmed through Staff Support to help Housekeeping now. Requests do not count. */
export function housekeepersOnShift(s: Shape, now: number): string[] {
  const own = EMPLOYEES.filter((e) => e.deptId === "dxb-hk" && e.skills.includes("housekeeping") && e.title === "Room attendant")
    .filter((e) => shiftsOf(e.id, DEMO_TODAY).some((sh) => sh.start <= now && sh.end > now)).map((e) => e.id);
  const borrowed = s.assignments.filter((a) => a.toDeptId === "dxb-hk" && a.status === "confirmed" && a.date === DEMO_TODAY && a.start <= now + 60 && a.end > now).map((a) => a.employeeId);
  return [...new Set([...own, ...borrowed])];
}
const supervisorsOf = () => EMPLOYEES.filter((e) => e.deptId === "dxb-hk" && e.skills.includes("inspection")).map((e) => e.id);

export interface RoomView extends RoomOps {
  estimate: ReadyEstimate;
  arrival?: ArrivalOps & ArrivalAssessment;
  housekeeperName?: string;
  helperName?: string;
}

export interface RoomsBoard {
  now: number;
  rooms: RoomView[];
  housekeepers: { id: string; name: string; borrowed: boolean; rooms: number }[];
  /** Rooms with an arrival that may be late, worst first. */
  atRisk: RoomView[];
  /** More rooms to turn around before arrivals than the people on shift can clean in time. */
  shortage: { rooms: number; people: number; neededPeople: number } | null;
  inspectionRequired: boolean;
  /** Minimal view for a housekeeper: only their own rooms. */
  mine?: boolean;
}

/** The rooms board. A housekeeper sees only the rooms assigned to them; nobody sees more guest detail than a surname. */
export function roomsBoard(user: User): Result<{ board: RoomsBoard }> {
  if (!mayView(user)) return fail(403, "Your role cannot open rooms.");
  const pid = guestProperty(user);
  if (!pid) return fail(403, "Rooms and guest services are set up for Grand Resort Dubai in this demo.");
  const s = loadStore();
  const g = s.guest;
  const now = demoNow(g);
  const hks = housekeepersOnShift(s, now);
  const rooms: RoomView[] = g.rooms.filter((r) => r.propertyId === pid).map((r) => {
    const estimate = estimateReady(r, g.rooms, hks, now);
    const a = g.arrivals.find((x) => x.roomId === r.roomId && x.status !== "checked_in");
    return {
      ...r, estimate, housekeeperName: r.housekeeperId ? employeeById[r.housekeeperId]?.name : undefined, helperName: r.helperId ? employeeById[r.helperId]?.name : undefined,
      arrival: a ? { ...a, ...assessArrival(a, estimate, r, now) } : undefined,
    };
  });
  const frontline = can(user, "hk.clean") && !can(user, "hk.manage") && !can(user, "fo.desk");
  const visible = frontline ? rooms.filter((r) => r.housekeeperId === user.staffId || r.helperId === user.staffId) : rooms;
  const atRisk = rooms.filter((r) => r.arrival && ["late", "waiting"].includes(r.arrival.risk)).sort((a, b) => (b.arrival!.delay ?? 0) - (a.arrival!.delay ?? 0));
  // Capacity: rooms still to clean before their guests arrive, against the people on shift.
  const due = rooms.filter((r) => r.arrival && (r.status === "vacant_dirty" || r.status === "cleaning"));
  const minutesNeeded = due.reduce((t, r) => t + (r.type.toLowerCase().includes("suite") ? 50 : 30), 0);
  const window = Math.max(30, Math.max(0, ...due.map((r) => r.arrival!.etaMin - now)));
  const neededPeople = Math.ceil(minutesNeeded / window);
  return {
    ok: true,
    board: {
      now, rooms: visible, atRisk: frontline ? [] : atRisk, inspectionRequired: needsInspection(pid), mine: frontline || undefined,
      housekeepers: hks.map((id) => ({ id, name: employeeById[id].name, borrowed: employeeById[id].deptId !== "dxb-hk", rooms: rooms.filter((r) => r.housekeeperId === id && (r.status === "vacant_dirty" || r.status === "cleaning")).length })),
      shortage: !frontline && neededPeople > hks.length ? { rooms: due.length, people: hks.length, neededPeople } : null,
    },
  };
}

const roomEvent = (r: RoomOps, by: string, action: string, now: number, note?: string) => r.history.push({ min: now, by, action, note });

/** One step on a room. `expect` is the status the user saw; if it changed meanwhile, nothing happens and they are told. */
export function roomAction(user: User, roomId: string, body: Record<string, unknown>): Result<{ room: RoomOps }> {
  const pid = guestProperty(user);
  const s = loadStore();
  const room = s.guest.rooms.find((r) => r.roomId === roomId);
  if (!pid || !room || room.propertyId !== pid) return fail(404, "This room is not available.");
  const action = String(body.action ?? "");
  if (body.expect !== undefined && body.expect !== room.status) return fail(409, `Room ${room.number} was updated by someone else: it is now ${room.status.replace("_", " ")}. Refresh and try again.`);
  const now = demoNow(s.guest);
  const mine = !!user.staffId && (room.housekeeperId === user.staffId || room.helperId === user.staffId);
  const manager = can(user, "hk.manage");
  const hks = housekeepersOnShift(s, now);
  const save = (change: (r: RoomOps, x: Shape) => void) => ({ ok: true as const, room: mutateStore((x) => { const r = x.guest.rooms.find((y) => y.roomId === roomId)!; change(r, x); return r; }) });

  switch (action) {
    case "priority": {
      if (!can(user, "fo.desk") && !manager) return fail(403, "Only the front desk or housekeeping can prioritise a room.");
      if (room.priority) return fail(409, "This room is already a priority.");
      if (!["vacant_dirty", "cleaning", "inspection"].includes(room.status)) return fail(409, "Only a room waiting to be cleaned or inspected can be prioritised.");
      return save((r) => { r.priority = true; r.priorityRequestedMin = now; roomEvent(r, user.id, "Priority cleaning requested", now, text(body.note) || undefined); });
    }
    case "assign": {
      if (!manager) return fail(403, "Only a housekeeping manager can assign rooms.");
      const hk = String(body.housekeeperId ?? "");
      if (!hks.includes(hk)) return fail(400, "Choose a housekeeper who is on shift now.");
      if (!["vacant_dirty", "cleaning"].includes(room.status)) return fail(409, "This room is not waiting to be cleaned.");
      return save((r) => { const was = r.housekeeperId; r.housekeeperId = hk; roomEvent(r, user.id, was ? `Reassigned to ${employeeById[hk].name}` : `Assigned to ${employeeById[hk].name}`, now); });
    }
    case "helper": {
      if (!manager) return fail(403, "Only a housekeeping manager can add help.");
      const hk = String(body.housekeeperId ?? "");
      if (!hks.includes(hk) || hk === room.housekeeperId) return fail(400, "Choose another housekeeper who is on shift now.");
      if (!["vacant_dirty", "cleaning"].includes(room.status)) return fail(409, "This room is not being cleaned.");
      return save((r) => { r.helperId = hk; roomEvent(r, user.id, `${employeeById[hk].name} added to help`, now); });
    }
    case "start": {
      if (!(mine && can(user, "hk.clean")) && !manager) return fail(403, "Only the assigned housekeeper or a manager can start this room.");
      if (room.status !== "vacant_dirty") return fail(409, "This room is not waiting to be cleaned.");
      if (!room.housekeeperId) return fail(409, "Assign a housekeeper first.");
      return save((r) => { r.status = "cleaning"; r.startedMin = now; roomEvent(r, user.id, "Cleaning started", now); });
    }
    case "cleaned": {
      if (!(mine && can(user, "hk.clean")) && !manager) return fail(403, "Only the assigned housekeeper or a manager can finish this room.");
      if (room.status !== "cleaning") return fail(409, "This room is not being cleaned.");
      // Where the hotel inspects every room, a cleaned room waits for a supervisor; it is not ready yet.
      const inspect = needsInspection(room.propertyId);
      return save((r, x) => {
        r.cleanedMin = now;
        r.status = inspect ? "inspection" : "ready";
        roomEvent(r, user.id, inspect ? "Cleaned; waiting for inspection" : "Cleaned and ready", now);
        if (!inspect) release(r, x, now);
      });
    }
    case "inspect": {
      const supervisor = !!user.staffId && supervisorsOf().includes(user.staffId);
      if (!manager && !supervisor) return fail(403, "Only a housekeeping supervisor or manager can inspect.");
      if (room.status !== "inspection") return fail(409, "This room is not waiting for inspection.");
      if (body.pass === false) {
        const note = text(body.note);
        if (note.length < 3) return fail(400, "Say what needs doing again.");
        return save((r) => { r.status = "cleaning"; r.startedMin = now; roomEvent(r, user.id, "Inspection failed; back to cleaning", now, note); });
      }
      return save((r, x) => { r.status = "ready"; roomEvent(r, user.id, "Inspected and released as ready", now); release(r, x, now); });
    }
    case "issue": {
      if (!(mine && can(user, "hk.clean")) && !manager) return fail(403, "Only the assigned housekeeper or a manager can report a problem here.");
      const note = text(body.note);
      if (note.length < 3) return fail(400, "Describe the problem.");
      return save((r) => { r.issues.push({ min: now, by: user.id, text: note, supply: body.supply === true }); roomEvent(r, user.id, body.supply === true ? "Missing supply reported" : "Problem reported", now, note); });
    }
    case "resolve": {
      if (!manager) return fail(403, "Only a housekeeping manager can close a problem.");
      return save((r) => { r.issues.forEach((i) => (i.resolved = true)); roomEvent(r, user.id, "Problems resolved", now); });
    }
    default:
      return fail(400, "Unknown action.");
  }
}

/** A room released as ready: its arrival is measured against the expected time, and the priority request closes. */
function release(r: RoomOps, x: Shape, now: number) {
  r.readyMin = now;
  const a = x.guest.arrivals.find((y) => y.roomId === r.roomId && y.status !== "checked_in");
  if (a) x.guest.log.push({ id: `L-${r.roomId}-${now}`, date: DEMO_TODAY, propertyId: r.propertyId, kind: "room", ref: r.number, createdMin: r.priorityRequestedMin ?? r.startedMin ?? now, doneMin: now, target: a.etaMin, escalated: r.priority });
  r.priority = false;
}

/** Move an arrival to another ready room of the same type. Only a front desk user can do this, and only on purpose. */
export function moveArrival(user: User, arrivalId: string, body: Record<string, unknown>): Result<{ arrival: ArrivalOps }> {
  if (!can(user, "fo.desk")) return fail(403, "Only the front desk can change a guest's room.");
  const s = loadStore();
  const a = s.guest.arrivals.find((x) => x.id === arrivalId);
  if (!a || !guestProperty(user)) return fail(404, "This arrival is not available.");
  const target = s.guest.rooms.find((r) => r.roomId === body.roomId);
  const current = s.guest.rooms.find((r) => r.roomId === a.roomId);
  if (!target || target.status !== "ready" || s.guest.arrivals.some((x) => x.roomId === target.roomId && x.status !== "checked_in")) return fail(409, "That room is no longer free and ready.");
  if (current && target.type !== current.type) return fail(400, "Choose a room of the same type.");
  const now = demoNow(s.guest);
  const arrival = mutateStore((x) => {
    const y = x.guest.arrivals.find((z) => z.id === arrivalId)!;
    const from = y.roomId;
    y.roomId = target.roomId;
    x.guest.rooms.find((z) => z.roomId === target.roomId)!.history.push({ min: now, by: user.id, action: `Arrival moved here from room ${from.split("-")[1]}` });
    const old = x.guest.rooms.find((z) => z.roomId === from);
    old?.history.push({ min: now, by: user.id, action: `Arrival moved to room ${target.number}` });
    return y;
  });
  return { ok: true, arrival };
}

/** Ready rooms of the same type with no arrival, for a front desk deciding whether to move a guest. */
export function alternativeRooms(user: User, roomId: string): Result<{ rooms: { roomId: string; number: string; floor: number }[] }> {
  if (!can(user, "fo.desk")) return fail(403, "Only the front desk can see this.");
  const g = loadStore().guest;
  const r = g.rooms.find((x) => x.roomId === roomId);
  if (!r) return fail(404, "Not found.");
  return { ok: true, rooms: g.rooms.filter((x) => x.type === r.type && x.status === "ready" && !g.arrivals.some((a) => a.roomId === x.roomId && a.status !== "checked_in")).map((x) => ({ roomId: x.roomId, number: x.number, floor: x.floor })) };
}

// ---- Bell team ---------------------------------------------------------------------------------------------------

const ORDER: BellStatus[] = ["requested", "assigned", "on_the_way", "collected", "delivered", "completed"];
const bellPeople = () => EMPLOYEES.filter((e) => e.deptId === "dxb-bell" && e.skills.includes("bell"));

export function bellBoard(user: User): Result<{ tasks: (BellTask & { assigneeName?: string; overdue: boolean; age: number })[]; team: { id: string; name: string; onShift: boolean }[]; now: number; mine?: boolean }> {
  if (!mayView(user) && !can(user, "bell.task")) return fail(403, "Your role cannot open bell tasks.");
  if (!guestProperty(user)) return fail(403, "Rooms and guest services are set up for Grand Resort Dubai in this demo.");
  const g = loadStore().guest;
  const now = demoNow(g);
  const frontline = can(user, "bell.task") && !can(user, "bell.dispatch") && !can(user, "fo.desk");
  const tasks = g.bell.filter((t) => !frontline || t.assigneeId === user.staffId).map((t) => ({
    ...t, assigneeName: t.assigneeId ? employeeById[t.assigneeId]?.name : undefined, age: now - t.requestedMin,
    overdue: !["delivered", "completed", "cancelled"].includes(t.status) && now - t.requestedMin > SERVICE_TARGETS.bell,
  })).sort((a, b) => Number(["completed", "cancelled"].includes(a.status)) - Number(["completed", "cancelled"].includes(b.status)) || Number(b.overdue) - Number(a.overdue) || a.requestedMin - b.requestedMin);
  const team = bellPeople().map((e) => ({ id: e.id, name: e.name, onShift: shiftsOf(e.id, DEMO_TODAY).some((s) => s.start <= now && s.end > now) }));
  return { ok: true, tasks, team, now, mine: frontline || undefined };
}

export function createBell(user: User, body: Record<string, unknown>): Result<{ task: BellTask }> {
  if (!can(user, "fo.desk") && !can(user, "bell.dispatch") && !can(user, "concierge")) return fail(403, "Your role cannot request luggage help.");
  if (!guestProperty(user)) return fail(403, "Rooms and guest services are set up for Grand Resort Dubai in this demo.");
  const kind = (["delivery", "pickup", "arrival", "departure"] as BellKind[]).find((k) => k === body.kind);
  if (!kind) return fail(400, "Choose what the guest needs.");
  const room = text(body.room, 8);
  const g = loadStore().guest;
  if (!g.rooms.some((r) => r.number === room)) return fail(400, "Enter a room number at this hotel.");
  const bags = Number(body.bags ?? 1);
  if (!Number.isInteger(bags) || bags < 1 || bags > 20) return fail(400, "Enter between 1 and 20 bags.");
  // The same request twice in a row is almost always a double tap.
  if (g.bell.some((t) => t.room === room && t.kind === kind && !["completed", "cancelled"].includes(t.status))) return fail(409, `There is already an open ${kind} request for room ${room}.`);
  const now = demoNow(g);
  const from = text(body.from, 60) || (kind === "delivery" || kind === "arrival" ? "Lobby" : `Room ${room}`);
  const to = text(body.to, 60) || (kind === "delivery" || kind === "arrival" ? `Room ${room}` : "Lobby");
  const task = mutateStore((x) => {
    const id = `BT-DXB-${String(nextNumber(x, "BT-DXB") + 2).padStart(4, "0")}`;
    const t: BellTask = { id, propertyId: "dxb", kind, room, from, to, bags, requestedBy: user.id, requestedMin: now, priority: body.priority === "urgent" ? "urgent" : "normal", status: "requested", sourceRequestId: typeof body.sourceRequestId === "string" ? body.sourceRequestId : undefined, history: [{ min: now, by: user.id, action: "Requested", note: text(body.note) || undefined }] };
    x.guest.bell.push(t);
    return t;
  });
  return { ok: true, task };
}

/** Each step in order. Only the assigned attendant moves the bags; the captain assigns and can close. */
export function bellAction(user: User, id: string, body: Record<string, unknown>): Result<{ task: BellTask }> {
  const s = loadStore();
  const t = s.guest.bell.find((x) => x.id === id);
  if (!t || !guestProperty(user)) return fail(404, "This task is not available.");
  const action = String(body.action ?? "");
  if (body.expect !== undefined && body.expect !== t.status) return fail(409, `This task was updated by someone else: it is now ${t.status.replace("_", " ")}.`);
  const now = demoNow(s.guest);
  const dispatcher = can(user, "bell.dispatch");
  const assignee = !!user.staffId && user.staffId === t.assigneeId && can(user, "bell.task");
  const save = (status: BellStatus | null, label: string, change?: (x: BellTask, store: Shape) => void) => ({
    ok: true as const,
    task: mutateStore((x) => { const y = x.guest.bell.find((z) => z.id === id)!; if (status) y.status = status; change?.(y, x); y.history.push({ min: now, by: user.id, action: label, note: text(body.note) || undefined }); return y; }),
  });
  if (["completed", "cancelled"].includes(t.status)) return fail(409, "This task is already closed.");
  switch (action) {
    case "assign": {
      if (!dispatcher) return fail(403, "Only the bell captain can assign tasks.");
      const who = String(body.assigneeId ?? "");
      if (!bellPeople().some((e) => e.id === who)) return fail(400, "Choose someone from the bell team.");
      if (!["requested", "assigned", "on_the_way"].includes(t.status)) return fail(409, "The bags have already been collected; reassigning now would break the handover record.");
      return save("assigned", t.assigneeId ? `Reassigned to ${employeeById[who].name}` : `Assigned to ${employeeById[who].name}`, (x) => { x.assigneeId = who; });
    }
    case "on_the_way":
    case "collected":
    case "delivered": {
      if (!assignee) return fail(403, "Only the bell attendant assigned to this task can update it.");
      const at = ORDER.indexOf(t.status), to = ORDER.indexOf(action as BellStatus);
      if (to !== at + 1) return fail(409, `Next step is ${ORDER[at + 1]?.replace("_", " ")}.`);
      if (action === "delivered") {
        const how = text(body.handover, 120);
        if (how.length < 3) return fail(400, "Record how the bags were handed over.");
        return save("delivered", "Delivered", (x) => { x.handover = how; });
      }
      return save(action as BellStatus, action === "on_the_way" ? "On the way" : "Collected");
    }
    case "complete": {
      if (!assignee && !dispatcher) return fail(403, "Only the assigned attendant or the bell captain can complete this.");
      if (t.status !== "delivered") return fail(409, "The bags must be recorded as delivered first.");
      return save("completed", "Completed", (x, store) => {
        const assigned = x.history.find((h) => h.action.startsWith("Assigned"))?.min;
        const delivered = x.history.find((h) => h.action === "Delivered")?.min ?? now;
        store.guest.log.push({ id: `L-${x.id}`, date: DEMO_TODAY, propertyId: x.propertyId, kind: "bell", ref: x.id, createdMin: x.requestedMin, assignedMin: assigned, doneMin: delivered, target: SERVICE_TARGETS.bell });
      });
    }
    case "cancel": {
      if (!dispatcher && t.requestedBy !== user.id) return fail(403, "Only whoever asked, or the bell captain, can cancel.");
      if (["collected", "delivered"].includes(t.status)) return fail(409, "The bags are already with the bell team; finish the task instead.");
      const why = text(body.note);
      if (why.length < 3) return fail(400, "Say why it is cancelled.");
      return save("cancelled", "Cancelled");
    }
    default:
      return fail(400, "Unknown action.");
  }
}

export const nameOf = (id: string) => userById[id]?.name ?? employeeById[id]?.name ?? (id === "system" ? "Property system" : id);
export { deptById };
