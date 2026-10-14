// Events and staff support. One availability engine serves event staffing and everyday requests between departments.
// Every change checks the acting user's role and departments, and availability is checked again at the moment of approval.
import { itemById, outletById, propertyById, userById } from "../data/catalog";
import { DEPTS, EMPLOYEES, SKILL_LABEL, deptById, employeeById, fmtMin, onLeave, shiftsOf, type Skill } from "../data/workforce";
import { allowedOutlets, allowedProperties, can } from "../domain/access";
import { DEFAULT_RATIOS, ROLE_ORDER, SERVICES, coverage, eventCost, eventIngredients, eventPortions, eventStoreNeed, isCommitted, overlaps, roleWindow, serviceFor, type Coverage, type EventCost, type PortionLine } from "../domain/events";
import type { Assignment, EventRecord, EventStatus, EventType, ServiceFormat, ServiceId, StaffRatios, SupportRequest, User } from "../types";
import { DEMO_TODAY, addDays, fmtDate } from "../util";
import { loadStore, mutateStore, nextNumber, type Shape } from "./purchasing-store";
import { buyPlanForEvent } from "./purchasing";
import type { SessionEntries } from "./stock";

type Fail = { ok: false; status: number; error: string };
export type Result<T = object> = ({ ok: true } & T) | Fail;
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const now = () => new Date().toISOString();
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const minutes = (v: unknown, lo = 0, hi = 30 * 60): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const text = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ---- Who manages what ----------------------------------------------------------------------------------------------

/** Departments whose people this user may release or schedule. */
export function managesDept(user: User, deptId: string): boolean {
  const d = deptById[deptId];
  if (!d || !allowedProperties(user).includes(d.propertyId)) return false;
  switch (user.role) {
    case "owner":
    case "gm":
      return true;
    case "fnb_director":
      return d.kind === "outlet" || d.kind === "banqueting";
    case "restaurant_manager":
      return d.kind === "outlet" && allowedOutlets(user).includes(d.outletId!);
    case "event_manager":
      return d.kind === "banqueting";
    // Department managers run their own team.
    case "front_office":
    case "housekeeping_manager":
    case "bell_captain":
    case "concierge":
      return user.deptId === deptId;
    default:
      return false;
  }
}

/** Departments this user may ask help for: those they manage, and a head chef's own kitchen. */
export const canRequestFor = (user: User, deptId: string) =>
  can(user, "staff.request") && (managesDept(user, deptId) || (user.role === "chef" && !!deptById[deptId]?.outletId && allowedOutlets(user).includes(deptById[deptId].outletId!)));

export const managedDepts = (user: User) => DEPTS.filter((d) => managesDept(user, d.id)).map((d) => d.id);
export const requestableDepts = (user: User) => DEPTS.filter((d) => canRequestFor(user, d.id)).map((d) => d.id);
const banquetingOf = (propertyId: string) => DEPTS.find((d) => d.propertyId === propertyId && d.kind === "banqueting")!.id;

/** Who may see an event: planners at its hotel, and the kitchen that prepares its food. */
export function canSeeEvent(user: User, e: EventRecord): boolean {
  if (!allowedProperties(user).includes(e.propertyId)) return false;
  if (can(user, "events.plan")) return e.status !== "draft" || e.createdBy === user.id || user.role === "owner" || user.role === "gm" || user.role === "event_manager";
  return user.role === "chef" && allowedOutlets(user).includes(e.kitchenOutletId) && isCommitted(e);
}

// ---- Availability --------------------------------------------------------------------------------------------------

export interface Availability {
  ok: boolean;
  /** Plain reasons, for the person checking. */
  reasons: string[];
}

/** Is this person free for the whole window? Leave, their own rostered shift and confirmed assignments all count. */
export function availability(s: Shape, employeeId: string, date: string, window: { start: number; end: number }, ignoreAssignmentId?: string): Availability {
  const emp = employeeById[employeeId];
  if (!emp) return { ok: false, reasons: ["Not on the staff list."] };
  const leave = onLeave(employeeId, date);
  if (leave) return { ok: false, reasons: [`${leave.reason} on ${fmtDate(date, true)}.`] };
  const shift = shiftsOf(employeeId, date).find((x) => overlaps(x, window));
  if (shift) return { ok: false, reasons: [`Working their own shift at ${deptById[emp.deptId].name}, ${fmtMin(shift.start)} to ${fmtMin(shift.end)}.`] };
  const clash = s.assignments.find((a) => a.id !== ignoreAssignmentId && a.employeeId === employeeId && a.status === "confirmed" && a.date === date && overlaps(a, window));
  if (clash) {
    const where = clash.eventId ? s.events.find((e) => e.id === clash.eventId)?.name ?? "an event" : deptById[clash.toDeptId].name;
    return { ok: false, reasons: [`Already assigned to ${where}, ${fmtMin(clash.start)} to ${fmtMin(clash.end)}.`] };
  }
  const own = shiftsOf(employeeId, date)[0];
  return {
    ok: true,
    reasons: [
      own ? `Their own shift that day is ${fmtMin(own.start)} to ${fmtMin(own.end)}, so ${fmtMin(window.start)} to ${fmtMin(window.end)} does not overlap it.` : `Not rostered at ${deptById[emp.deptId].name} that day.`,
      "No leave and no other assignment at that time.",
    ],
  };
}

export interface Candidate {
  employeeId: string;
  name: string;
  title: string;
  deptId: string;
  deptName: string;
  skill: string;
  why: string[];
  /** Already asked for by another open request at an overlapping time. Still free until someone approves. */
  requestedElsewhere: boolean;
}

/** People at the hotel with the verified skill who are free for the whole window. Their home roster stays private. */
export function findCandidates(user: User, body: Record<string, unknown>): Result<{ candidates: Candidate[]; note: string }> {
  if (!can(user, "staff.request")) return fail(403, "Your role cannot look for staff.");
  const propertyId = String(body.propertyId ?? "");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const skill = String(body.skill ?? "") as Skill;
  if (!SKILL_LABEL[skill]) return fail(400, "Choose the skill you need.");
  const date = String(body.date ?? "");
  if (!ISO.test(date) || date < DEMO_TODAY || date > addDays(DEMO_TODAY, 7)) return fail(400, "Choose a date in the next seven days.");
  if (!minutes(body.start) || !minutes(body.end) || body.end <= body.start) return fail(400, "Choose a start and an end time.");
  const window = { start: body.start as number, end: body.end as number };
  const toDeptId = String(body.toDeptId ?? "");
  const s = loadStore();
  const exclude = new Set(Array.isArray(body.exclude) ? (body.exclude as unknown[]).map(String) : []);
  const candidates = EMPLOYEES
    .filter((e) => e.propertyId === propertyId && e.deptId !== toDeptId && e.skills.includes(skill) && e.title !== "Outlet manager" && !exclude.has(e.id))
    .flatMap((e): Candidate[] => {
      const a = availability(s, e.id, date, window);
      if (!a.ok) return [];
      const requestedElsewhere = s.support.some((r) => r.status === "open" && r.date === date && overlaps(r, window) && r.items.some((i) => (i.employeeId === e.id || i.proposed?.employeeId === e.id) && (i.status === "pending" || i.status === "alternative")));
      return [{ employeeId: e.id, name: e.name, title: e.title, deptId: e.deptId, deptName: deptById[e.deptId].name, skill: SKILL_LABEL[skill], why: [`Verified skill: ${SKILL_LABEL[skill].toLowerCase()}${e.skills[0] === skill ? "" : `, alongside their main role as ${e.title.toLowerCase()}`}.`, ...a.reasons], requestedElsewhere }];
    })
    .sort((a, b) => Number(a.requestedElsewhere) - Number(b.requestedElsewhere) || a.deptName.localeCompare(b.deptName));
  const note = candidates.length
    ? `${candidates.length} ${candidates.length === 1 ? "person has" : "people have"} the skill and ${candidates.length === 1 ? "is" : "are"} free for the whole time.`
    : "Nobody with this skill is free for the whole time. Consider shorter hours, a later start, changing the service style, or asking the general manager to review.";
  return { ok: true, candidates, note };
}

// ---- Support requests ----------------------------------------------------------------------------------------------

export function canSeeRequest(user: User, r: SupportRequest): boolean {
  if (!allowedProperties(user).includes(r.propertyId)) return false;
  return r.requestedBy === user.id || managesDept(user, r.toDeptId) || r.items.some((i) => managesDept(user, i.deptId));
}

export function createSupport(user: User, body: Record<string, unknown>): Result<{ request: SupportRequest }> {
  if (!can(user, "staff.request")) return fail(403, "Your role cannot request staff.");
  const s = loadStore();
  const eventId = typeof body.eventId === "string" ? body.eventId : undefined;
  const event = eventId ? s.events.find((e) => e.id === eventId) : undefined;
  if (eventId && (!event || !canSeeEvent(user, event) || !can(user, "events.plan"))) return fail(404, "This event is not available.");
  if (event && event.status === "cancelled") return fail(409, "This event is cancelled.");
  const propertyId = event?.propertyId ?? String(body.propertyId ?? "");
  const toDeptId = event ? banquetingOf(propertyId) : String(body.toDeptId ?? "");
  if (!deptById[toDeptId] || deptById[toDeptId].propertyId !== propertyId || (!event && !canRequestFor(user, toDeptId))) return fail(403, "You cannot request help for this department.");
  const skill = String(body.skill ?? "") as Skill;
  if (!SKILL_LABEL[skill]) return fail(400, "Choose the skill you need.");
  const date = event?.date ?? String(body.date ?? "");
  const role = ROLE_ORDER.find((r) => r === body.role) as keyof StaffRatios | undefined;
  const window = event && role ? roleWindow(event, role) : { start: body.start as number, end: body.end as number };
  if (!ISO.test(date) || date < DEMO_TODAY) return fail(400, "Choose a date from today.");
  if (!minutes(window.start) || !minutes(window.end) || window.end <= window.start) return fail(400, "Choose a start and an end time.");
  const reason = text(body.reason);
  if (reason.length < 3) return fail(400, "Give a short reason.");
  const picked = Array.isArray(body.employeeIds) ? (body.employeeIds as unknown[]).map(String) : [];
  const askDept = typeof body.askDeptId === "string" ? body.askDeptId : undefined;
  const count = Number(body.count ?? picked.length);
  if (!Number.isInteger(count) || count < 1 || count > 20) return fail(400, "Ask for between 1 and 20 people.");
  if (picked.length > count) return fail(400, "You picked more people than you asked for.");
  for (const id of picked) {
    const e = employeeById[id];
    if (!e || e.propertyId !== propertyId || !e.skills.includes(skill) || e.deptId === toDeptId) return fail(400, "Someone you picked does not have the skill needed.");
    const a = availability(s, id, date, window);
    if (!a.ok) return fail(409, `${e.name} is no longer free: ${a.reasons[0]} Choose someone else.`);
  }
  if (picked.length < count && (!askDept || !deptById[askDept] || deptById[askDept].propertyId !== propertyId || askDept === toDeptId)) return fail(400, "Pick people, or choose a department to ask.");
  const request = mutateStore((x) => {
    const n = nextNumber(x, `SR-${propertyId.toUpperCase()}`);
    const id = `SR-${propertyId.toUpperCase()}-${String(n).padStart(4, "0")}`;
    const items = [
      ...picked.map((employeeId, i) => ({ id: `${id}-${i + 1}`, employeeId, deptId: employeeById[employeeId].deptId, status: "pending" as const })),
      ...Array.from({ length: count - picked.length }, (_, i) => ({ id: `${id}-${picked.length + i + 1}`, deptId: askDept!, status: "pending" as const })),
    ];
    const r: SupportRequest = {
      id, propertyId, requestedBy: user.id, toDeptId, eventId, kind: text(body.kind, 60) || SKILL_LABEL[skill], skill, date, start: window.start, end: window.end, count, reason,
      priority: body.priority === "urgent" ? "urgent" : "normal", status: "open", items, createdAt: now(), updatedAt: now(),
      history: [{ at: now(), by: user.id, action: `Requested ${count} ${SKILL_LABEL[skill].toLowerCase()}${count === 1 ? "" : "s"}`, comment: reason }],
    };
    x.support.push(r);
    return r;
  });
  return { ok: true, request };
}

const settle = (r: SupportRequest) => {
  const active = r.items.filter((i) => i.status !== "declined" && i.status !== "cancelled");
  r.status = r.items.every((i) => i.status === "approved" || i.status === "declined" || i.status === "cancelled") ? (active.length ? "filled" : "cancelled") : "open";
};

/** The lending manager's decision on one person: approve, decline or suggest someone or something else. */
export function decideItem(user: User, requestId: string, itemId: string, body: Record<string, unknown>): Result<{ request: SupportRequest }> {
  const s = loadStore();
  const r = s.support.find((x) => x.id === requestId);
  if (!r || !canSeeRequest(user, r)) return fail(404, "This request is not available.");
  const item = r.items.find((i) => i.id === itemId);
  if (!item) return fail(404, "This person is not on the request.");
  // Only the manager of the person's own department can release them.
  if (!can(user, "staff.lend") || !managesDept(user, item.deptId)) return fail(403, `Only a manager of ${deptById[item.deptId].name} can decide this.`);
  if (item.status !== "pending") return fail(409, "This has already been decided.");
  const decision = String(body.decision ?? "");
  const comment = text(body.comment);
  const window = { start: r.start, end: r.end };
  if (decision === "decline") {
    if (comment.length < 3) return fail(400, "Say why you are declining.");
    return save(user, r.id, (x) => { const i = x.items.find((y) => y.id === itemId)!; i.status = "declined"; i.decidedBy = user.id; i.comment = comment; }, `${deptById[item.deptId].name} declined`, comment);
  }
  const empId = item.employeeId ?? String(body.employeeId ?? "");
  const pickedSomeoneElse = typeof body.employeeId === "string" && body.employeeId !== item.employeeId;
  if (decision === "alternative" || (decision === "approve" && item.employeeId && pickedSomeoneElse)) {
    const alt = String(body.employeeId ?? item.employeeId ?? "");
    const e = employeeById[alt];
    if (!e || e.deptId !== item.deptId || !e.skills.includes(r.skill as Skill)) return fail(400, "Suggest someone from your department with the skill needed.");
    const w = { start: minutes(body.start) ? (body.start as number) : r.start, end: minutes(body.end) ? (body.end as number) : r.end };
    if (w.end <= w.start) return fail(400, "The suggested hours do not make sense.");
    const a = availability(s, alt, r.date, w);
    if (!a.ok) return fail(409, `${e.name} is not free then: ${a.reasons[0]}`);
    return save(user, r.id, (x) => { const i = x.items.find((y) => y.id === itemId)!; i.status = "alternative"; i.proposed = { employeeId: alt, ...w }; i.decidedBy = user.id; i.comment = comment || undefined; },
      `${deptById[item.deptId].name} suggested ${e.name}${w.start !== r.start || w.end !== r.end ? `, ${fmtMin(w.start)} to ${fmtMin(w.end)}` : ""}`, comment);
  }
  if (decision !== "approve") return fail(400, "Choose approve, decline or suggest an alternative.");
  const e = employeeById[empId];
  if (!e || e.deptId !== item.deptId || !e.skills.includes(r.skill as Skill)) return fail(400, "Choose someone from your department with the skill needed.");
  // Checked again now: someone else may have booked this person since the request was sent.
  const a = availability(s, empId, r.date, window);
  if (!a.ok) return fail(409, `Cannot approve: ${e.name} is no longer free. ${a.reasons[0]} Suggest someone else instead.`);
  return assign(user, r.id, itemId, empId, window, `${deptById[item.deptId].name} approved ${e.name}`, comment);
}

/** The requester's answer to a suggested alternative. */
export function respondItem(user: User, requestId: string, itemId: string, body: Record<string, unknown>): Result<{ request: SupportRequest }> {
  const s = loadStore();
  const r = s.support.find((x) => x.id === requestId);
  if (!r || !canSeeRequest(user, r)) return fail(404, "This request is not available.");
  if (r.requestedBy !== user.id && !managesDept(user, r.toDeptId)) return fail(403, "Only the person who asked can answer this.");
  const item = r.items.find((i) => i.id === itemId);
  if (!item || item.status !== "alternative" || !item.proposed) return fail(409, "There is no suggestion to answer.");
  if (body.accept === false) {
    return save(user, r.id, (x) => { const i = x.items.find((y) => y.id === itemId)!; i.status = "declined"; i.comment = "Alternative not accepted."; }, "Alternative not accepted", text(body.comment));
  }
  const a = availability(s, item.proposed.employeeId, r.date, item.proposed);
  if (!a.ok) return fail(409, `${employeeById[item.proposed.employeeId].name} is no longer free: ${a.reasons[0]} Ask the department again.`);
  return assign(user, r.id, itemId, item.proposed.employeeId, item.proposed, `Alternative accepted: ${employeeById[item.proposed.employeeId].name}`, text(body.comment), item.decidedBy);
}

function assign(user: User, requestId: string, itemId: string, employeeId: string, window: { start: number; end: number }, label: string, comment: string, approvedBy?: string): Result<{ request: SupportRequest }> {
  return save(user, requestId, (x, store) => {
    const i = x.items.find((y) => y.id === itemId)!;
    const id = `AS-${x.id.slice(3)}-${i.id.split("-").pop()}`;
    store.assignments.push({ id, employeeId, propertyId: x.propertyId, fromDeptId: employeeById[employeeId].deptId, toDeptId: x.toDeptId, eventId: x.eventId, requestId: x.id, date: x.date, start: window.start, end: window.end, skill: x.skill, status: "confirmed", approvedBy: approvedBy ?? user.id, createdAt: now() });
    i.status = "approved";
    i.employeeId = employeeId;
    i.assignmentId = id;
    i.decidedBy = i.decidedBy ?? user.id;
  }, label, comment);
}

function save(user: User, requestId: string, change: (r: SupportRequest, s: Shape) => void, action: string, comment?: string): Result<{ request: SupportRequest }> {
  const request = mutateStore((s) => {
    const r = s.support.find((x) => x.id === requestId)!;
    change(r, s);
    settle(r);
    r.updatedAt = now();
    r.history.push({ at: r.updatedAt, by: user.id, action, comment: comment || undefined });
    return r;
  });
  return { ok: true, request };
}

/** Withdraw a request. Confirmed people from it are released, with the original decisions kept on record. */
export function cancelSupport(user: User, requestId: string, body: Record<string, unknown>): Result<{ request: SupportRequest }> {
  const s = loadStore();
  const r = s.support.find((x) => x.id === requestId);
  if (!r || !canSeeRequest(user, r)) return fail(404, "This request is not available.");
  if (r.requestedBy !== user.id && !managesDept(user, r.toDeptId)) return fail(403, "Only the requesting department can withdraw this.");
  if (r.status === "cancelled") return fail(409, "Already withdrawn.");
  const reason = text(body.reason) || "No longer needed.";
  return save(user, requestId, (x, store) => {
    for (const i of x.items) if (i.status === "pending" || i.status === "alternative" || i.status === "approved") i.status = "cancelled";
    for (const a of store.assignments) if (a.requestId === x.id && a.status === "confirmed") { a.status = "cancelled"; a.cancelledReason = reason; }
  }, "Request withdrawn", reason);
}

export function supportFor(user: User): SupportRequest[] {
  return loadStore().support.filter((r) => canSeeRequest(user, r)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** The event role a skill fills; everything that is not a named role works the service hours. */
const roleOf = (skill: string): keyof StaffRatios => (ROLE_ORDER as string[]).includes(skill) ? (skill as keyof StaffRatios) : "waiter";

// ---- Events --------------------------------------------------------------------------------------------------------

const TYPES: EventType[] = ["Conference", "Wedding", "Corporate dinner", "Banquet", "Private dining", "Cocktail reception", "Hotel function"];
const FORMATS: ServiceFormat[] = ["seated", "buffet", "reception", "theatre"];

/** Reads event fields from a form, keeping only valid values. */
function readEvent(body: Record<string, unknown>, base?: EventRecord): Result<{ fields: Partial<EventRecord> }> {
  const f: Partial<EventRecord> = {};
  if (body.name !== undefined) { const n = text(body.name, 80); if (n.length < 3) return fail(400, "Give the event a name."); f.name = n; }
  if (body.type !== undefined) { if (!TYPES.includes(body.type as EventType)) return fail(400, "Choose an event type."); f.type = body.type as EventType; }
  if (body.venue !== undefined) f.venue = text(body.venue, 60) || "Ballroom";
  if (body.date !== undefined) { if (!ISO.test(String(body.date)) || String(body.date) < DEMO_TODAY || String(body.date) > addDays(DEMO_TODAY, 60)) return fail(400, "Choose a date from today."); f.date = String(body.date); }
  for (const k of ["start", "end", "setupStart", "cleanupEnd"] as const) if (body[k] !== undefined) { if (!minutes(body[k])) return fail(400, "Check the times."); f[k] = body[k] as number; }
  if (body.guests !== undefined) { const g = Number(body.guests); if (!Number.isInteger(g) || g < 1 || g > 2000) return fail(400, "Enter between 1 and 2,000 guests."); f.guests = g; }
  if (body.format !== undefined) { if (!FORMATS.includes(body.format as ServiceFormat)) return fail(400, "Choose a service style."); f.format = body.format as ServiceFormat; }
  if (body.dietary !== undefined) f.dietary = text(body.dietary, 200);
  if (body.notes !== undefined) f.notes = text(body.notes, 600);
  if (body.pricePerGuest !== undefined) f.pricePerGuest = Number(body.pricePerGuest) > 0 ? Math.min(100000, Number(body.pricePerGuest)) : undefined;
  if (body.kitchenOutletId !== undefined) { if (!outletById[String(body.kitchenOutletId)]) return fail(400, "Choose the kitchen."); f.kitchenOutletId = String(body.kitchenOutletId); }
  if (body.services !== undefined) {
    if (!Array.isArray(body.services)) return fail(400, "Choose the food and drinks.");
    const services = [];
    for (const raw of body.services as Record<string, unknown>[]) {
      const id = raw.id as ServiceId;
      if (!SERVICES[id]) return fail(400, "Unknown service.");
      const guests = Number(raw.guests);
      if (!Number.isInteger(guests) || guests < 0 || guests > 2000) return fail(400, `Check the guests for ${SERVICES[id].label.toLowerCase()}.`);
      const items = Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]).filter((i) => itemById[String(i.itemId)] && Number(i.perGuest) >= 0 && Number(i.perGuest) <= 10).map((i) => ({ itemId: String(i.itemId), perGuest: Math.round(Number(i.perGuest) * 100) / 100 })) : serviceFor(id, guests).items;
      services.push({ id, guests, items });
    }
    f.services = services;
  }
  if (body.ratios !== undefined) {
    const r = body.ratios as Record<string, unknown>;
    const ratios = { ...(base?.ratios ?? DEFAULT_RATIOS.seated) };
    for (const k of ROLE_ORDER) if (r[k] !== undefined) { const v = Number(r[k]); if (!Number.isFinite(v) || v < 0 || v > 500) return fail(400, "Check the staffing assumptions."); ratios[k] = Math.round(v); }
    f.ratios = ratios;
  }
  const t = { ...base, ...f } as EventRecord;
  if (t.start !== undefined && t.end !== undefined && t.end <= t.start) return fail(400, "The event must end after it starts.");
  if (t.setupStart !== undefined && t.start !== undefined && t.setupStart > t.start) return fail(400, "Setup must start before the event.");
  if (t.cleanupEnd !== undefined && t.end !== undefined && t.cleanupEnd < t.end) return fail(400, "Cleanup must end after the event.");
  return { ok: true, fields: f };
}

export function saveEvent(user: User, body: Record<string, unknown>): Result<{ event: EventRecord; notes: string[] }> {
  if (!can(user, "events.plan")) return fail(403, "Your role cannot plan events.");
  const s = loadStore();
  const existing = typeof body.id === "string" ? s.events.find((e) => e.id === body.id) : undefined;
  if (body.id && (!existing || !canSeeEvent(user, existing))) return fail(404, "This event is not available.");
  if (existing && (existing.status === "cancelled" || existing.status === "completed")) return fail(409, "This event can no longer be changed.");
  const propertyId = existing?.propertyId ?? String(body.propertyId ?? "");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const read = readEvent(body, existing);
  if (!read.ok) return read;
  if (!existing) {
    for (const k of ["name", "type", "date", "start", "end", "guests"] as const) if (read.fields[k] === undefined) return fail(400, "Enter the name, type, date, times and guests.");
  }
  const notes: string[] = [];
  const event = mutateStore((x) => {
    if (existing) {
      const e = x.events.find((y) => y.id === existing.id)!;
      const before = { ...e };
      Object.assign(e, read.fields);
      // A guest change rescales services that were at the full guest count, so the edit replaces the old demand.
      if (read.fields.guests !== undefined && read.fields.guests !== before.guests && body.services === undefined) {
        e.services = e.services.map((sv) => ({ ...sv, guests: sv.guests === before.guests ? e.guests : Math.min(sv.guests, e.guests) }));
      }
      if (read.fields.format && read.fields.format !== before.format && body.ratios === undefined) e.ratios = { ...DEFAULT_RATIOS[read.fields.format] };
      e.updatedAt = now();
      const changes = [
        before.guests !== e.guests && `guests ${before.guests} to ${e.guests}`,
        (before.date !== e.date || before.start !== e.start || before.end !== e.end || before.setupStart !== e.setupStart || before.cleanupEnd !== e.cleanupEnd) && `time ${fmtDate(e.date)} ${fmtMin(e.start)} to ${fmtMin(e.end)}`,
        body.services !== undefined && "food and drinks",
        body.ratios !== undefined && "staffing assumptions",
      ].filter(Boolean) as string[];
      e.history.push({ at: e.updatedAt, by: user.id, action: "Event updated", detail: changes.join("; ") || undefined });
      // A new time means every confirmed person is checked again. Anyone no longer free is released, with a note.
      if (before.date !== e.date || before.start !== e.start || before.end !== e.end || before.setupStart !== e.setupStart || before.cleanupEnd !== e.cleanupEnd) {
        for (const a of x.assignments.filter((y) => y.eventId === e.id && y.status === "confirmed")) {
          const w = roleWindow(e, roleOf(a.skill));
          const free = availability(x, a.employeeId, e.date, w, a.id);
          if (free.ok) { a.date = e.date; a.start = w.start; a.end = w.end; }
          else {
            a.status = "cancelled";
            a.cancelledReason = `Event moved; ${free.reasons[0]}`;
            notes.push(`${employeeById[a.employeeId].name} is no longer free for the new time and was released.`);
          }
        }
        for (const r of x.support.filter((y) => y.eventId === e.id && y.status === "open")) {
          const w = roleWindow(e, roleOf(r.skill));
          r.date = e.date; r.start = w.start; r.end = w.end;
          r.history.push({ at: e.updatedAt, by: user.id, action: "Event time changed; request updated to the new hours" });
        }
      }
      return e;
    }
    const n = nextNumber(x, `EVT-${propertyId.toUpperCase()}`);
    const f = read.fields;
    const e: EventRecord = {
      id: `EVT-${propertyId.toUpperCase()}-${String(n).padStart(4, "0")}`, propertyId, name: f.name!, type: f.type!, venue: f.venue ?? "Ballroom", date: f.date!, start: f.start!, end: f.end!,
      setupStart: f.setupStart ?? f.start! - 120, cleanupEnd: f.cleanupEnd ?? f.end! + 60, guests: f.guests!, format: f.format ?? "seated", dietary: f.dietary ?? "", notes: f.notes ?? "",
      status: "draft", kitchenOutletId: f.kitchenOutletId ?? Object.values(outletById).find((o) => o.propertyId === propertyId)!.id,
      services: f.services ?? [], ratios: f.ratios ?? { ...DEFAULT_RATIOS[f.format ?? "seated"] }, pricePerGuest: f.pricePerGuest, issued: [], createdBy: user.id, updatedAt: now(),
      history: [{ at: now(), by: user.id, action: "Draft created" }],
    };
    x.events.push(e);
    return e;
  });
  return { ok: true, event, notes };
}

/** Confirm the plan, mark it ready, or cancel it. Ready needs every role covered. */
export function setEventStatus(user: User, id: string, body: Record<string, unknown>, entries: SessionEntries): Result<{ event: EventRecord }> {
  if (!can(user, "events.plan")) return fail(403, "Your role cannot change events.");
  const s = loadStore();
  const e = s.events.find((x) => x.id === id);
  if (!e || !canSeeEvent(user, e)) return fail(404, "This event is not available.");
  const to = String(body.status ?? "") as EventStatus;
  const reason = text(body.reason);
  if (to === "planning") {
    if (e.status !== "draft") return fail(409, "Only a draft can be confirmed.");
    if (!e.services.length) return fail(400, "Choose the food and drinks first.");
  } else if (to === "ready") {
    if (e.status !== "planning") return fail(409, "Confirm the plan first.");
    const short = coverage(e, s.assignments, s.support).filter((c) => c.stillNeeded > 0);
    if (short.length) return fail(409, `Not ready: still need ${short.map((c) => `${c.stillNeeded} ${SKILL_LABEL[c.skill].toLowerCase()}${c.stillNeeded === 1 ? "" : "s"}`).join(", ")}.`);
    const buy = buyPlanForEvent(user, e, entries);
    if (buy.some((l) => l.suggested > 0)) return fail(409, `Not ready: ${buy.filter((l) => l.suggested > 0).length} ingredients still need buying.`);
  } else if (to === "cancelled") {
    if (e.status === "cancelled") return fail(409, "Already cancelled.");
    if (reason.length < 3) return fail(400, "Say why the event is cancelled.");
  } else return fail(400, "Unknown status.");
  const event = mutateStore((x) => {
    const ev = x.events.find((y) => y.id === id)!;
    ev.status = to;
    ev.updatedAt = now();
    ev.history.push({ at: ev.updatedAt, by: user.id, action: { planning: "Plan confirmed", ready: "Marked ready", cancelled: "Event cancelled" }[to as "planning" | "ready" | "cancelled"], detail: reason || undefined });
    if (to === "cancelled") {
      // Release everyone and withdraw open requests, keeping the original decisions.
      for (const a of x.assignments) if (a.eventId === id && a.status === "confirmed") { a.status = "cancelled"; a.cancelledReason = "Event cancelled."; }
      for (const r of x.support) if (r.eventId === id && r.status !== "cancelled") {
        for (const i of r.items) if (i.status !== "declined") i.status = "cancelled";
        r.status = "cancelled";
        r.history.push({ at: ev.updatedAt, by: user.id, action: "Withdrawn: event cancelled" });
      }
      // Purchase requests for the event are not withdrawn silently: purchasing is told, and decides.
      for (const pr of x.requests) if (pr.eventId === id && ["draft", "purchasing", "accounting", "manager", "approved"].includes(pr.status)) {
        pr.history.push({ at: ev.updatedAt, by: user.id, action: "Event cancelled", status: pr.status, comment: `${ev.name} was cancelled. Reject this request${pr.status === "approved" ? " or cancel the order with the supplier" : ""} if it is no longer needed.` });
        pr.updatedAt = ev.updatedAt;
      }
    }
    return ev;
  });
  return { ok: true, event };
}

/** The kitchen's own portion figures for an event, replacing the calculation for those dishes. */
export function setKitchenPortions(user: User, id: string, body: Record<string, unknown>): Result<{ event: EventRecord }> {
  const e = loadStore().events.find((x) => x.id === id);
  if (!e || !canSeeEvent(user, e)) return fail(404, "This event is not available.");
  if (!can(user, "prep.plan") || !(allowedOutlets(user).includes(e.kitchenOutletId) || can(user, "events.plan"))) return fail(403, "Only the event's kitchen or its planners can change portions.");
  const raw = (body.portions ?? {}) as Record<string, unknown>;
  const kp: Record<string, number> = { ...(e.kitchenPortions ?? {}) };
  for (const [k, v] of Object.entries(raw)) {
    if (!itemById[k] || itemById[k].dept !== "food") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 5000) return fail(400, "Enter whole portions.");
    kp[k] = n;
  }
  const event = mutateStore((x) => {
    const ev = x.events.find((y) => y.id === id)!;
    ev.kitchenPortions = kp;
    ev.updatedAt = now();
    ev.history.push({ at: ev.updatedAt, by: user.id, action: "Kitchen changed portions", detail: Object.entries(raw).map(([k, v]) => `${itemById[k]?.name}: ${v}`).join(", ") });
    return ev;
  });
  return { ok: true, event };
}

export function eventsFor(user: User): EventRecord[] {
  return loadStore().events.filter((e) => canSeeEvent(user, e)).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface EventDetail {
  event: EventRecord;
  portions: PortionLine[];
  ingredients: { ingredientId: string; need: number; issued: number; fromStore: number; suggested: number; available: number; unit: string }[];
  coverage: Coverage[];
  cost: EventCost;
  requests: SupportRequest[];
  staff: { id: string; employeeId: string; name: string; deptName: string; skill: string; start: number; end: number; status: Assignment["status"]; cancelledReason?: string }[];
  prep: { planned: boolean; portionsChanged: boolean };
  purchaseIds: string[];
  canPlan: boolean;
}

export function eventDetail(user: User, id: string, entries: SessionEntries): Result<{ detail: EventDetail }> {
  const s = loadStore();
  const e = s.events.find((x) => x.id === id);
  if (!e || !canSeeEvent(user, e)) return fail(404, "This event is not available.");
  const cov = coverage(e, s.assignments, s.support);
  const need = eventIngredients(e, entries.recipes);
  const fromStore = eventStoreNeed(e, entries.recipes);
  const buy = can(user, "purchase.create") ? buyPlanForEvent(user, e, entries) : [];
  const buyBy = new Map(buy.map((l) => [l.ingredientId, l]));
  const ingredients = [...need].map(([g, q]) => ({
    ingredientId: g, need: q, issued: e.issued.filter((i) => i.ingredientId === g).reduce((t, i) => t + i.qty, 0), fromStore: fromStore.get(g) ?? 0,
    suggested: buyBy.get(g)?.suggested ?? 0, available: buyBy.get(g) ? buyBy.get(g)!.available + buyBy.get(g)!.incoming : 0, unit: buyBy.get(g)?.unit ?? "",
  })).sort((a, b) => b.suggested - a.suggested || b.need - a.need);
  const plan = s.plans.find((p) => p.outletId === e.kitchenOutletId && p.period.from <= e.date && p.period.to >= e.date && p.tasks.some((t) => t.eventId === e.id));
  return {
    ok: true,
    detail: {
      event: e, portions: eventPortions(e), ingredients, coverage: cov, cost: eventCost(e, cov),
      requests: s.support.filter((r) => r.eventId === e.id),
      staff: s.assignments.filter((a) => a.eventId === e.id).map((a) => ({ id: a.id, employeeId: a.employeeId, name: employeeById[a.employeeId].name, deptName: deptById[a.fromDeptId].name, skill: a.skill, start: a.start, end: a.end, status: a.status, cancelledReason: a.cancelledReason })),
      prep: { planned: !!plan, portionsChanged: !!e.kitchenPortions && Object.keys(e.kitchenPortions).length > 0 },
      purchaseIds: s.requests.filter((r) => r.eventId === e.id && r.status !== "draft").map((r) => r.id),
      canPlan: can(user, "events.plan"),
    },
  };
}

// ---- Schedules and assignments -------------------------------------------------------------------------------------

/** A department's day: its own people's shifts, and who is lent out or borrowed. Only for departments the user manages. */
export function deptSchedule(user: User, deptId: string, date: string): Result<{ rows: { employeeId: string; name: string; title: string; shift?: string; away: string[]; leave?: string }[]; borrowed: { name: string; from: string; time: string; for: string }[] }> {
  if (!managesDept(user, deptId)) return fail(403, "You can see only the schedules of departments you manage.");
  const s = loadStore();
  const label = (a: Assignment) => (a.eventId ? s.events.find((e) => e.id === a.eventId)?.name ?? "an event" : deptById[a.toDeptId].name);
  const rows = EMPLOYEES.filter((e) => e.deptId === deptId && e.title !== "Outlet manager").map((e) => {
    const sh = shiftsOf(e.id, date)[0];
    return {
      employeeId: e.id, name: e.name, title: e.title, shift: sh ? `${fmtMin(sh.start)} to ${fmtMin(sh.end)}` : undefined, leave: onLeave(e.id, date)?.reason,
      // Lent to another department or an event that day.
      away: s.assignments.filter((a) => a.employeeId === e.id && a.date === date && a.status === "confirmed" && a.toDeptId !== deptId).map((a) => `${label(a)}, ${fmtMin(a.start)} to ${fmtMin(a.end)}`),
    };
  });
  const borrowed = s.assignments.filter((a) => a.toDeptId === deptId && a.fromDeptId !== deptId && a.date === date && a.status === "confirmed").map((a) => ({ name: employeeById[a.employeeId].name, from: deptById[a.fromDeptId].name, time: `${fmtMin(a.start)} to ${fmtMin(a.end)}`, for: label(a) }));
  return { ok: true, rows, borrowed };
}

/** A staff member's own confirmed assignments, from today. */
export function myAssignments(user: User) {
  if (!user.staffId) return [];
  const s = loadStore();
  return s.assignments.filter((a) => a.employeeId === user.staffId && a.date >= DEMO_TODAY).map((a) => ({
    ...a, where: a.eventId ? s.events.find((e) => e.id === a.eventId)?.venue ?? "" : deptById[a.toDeptId].name,
    for: a.eventId ? s.events.find((e) => e.id === a.eventId)?.name ?? "" : deptById[a.toDeptId].name, skillLabel: SKILL_LABEL[a.skill as Skill],
  }));
}

export function markAssignmentDone(user: User, id: string): Result<{ id: string }> {
  const s = loadStore();
  const a = s.assignments.find((x) => x.id === id);
  if (!a || a.employeeId !== user.staffId || a.status !== "confirmed") return fail(404, "This assignment is not yours.");
  mutateStore((x) => { x.assignments.find((y) => y.id === id)!.done = true; });
  return { ok: true, id };
}

// ---- Alerts --------------------------------------------------------------------------------------------------------

export interface OpsAlert { id: string; text: string; href: string; action: string }

const dayWord = (date: string) => (date === addDays(DEMO_TODAY, 1) ? "Tomorrow's" : date === DEMO_TODAY ? "Today's" : `${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}'s`);
const shortName = (e: EventRecord) => (e.type === "Conference" ? "conference" : e.type === "Wedding" ? "wedding" : e.name.toLowerCase());
const words = (n: number) => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);

export function opsAlerts(user: User, entries: SessionEntries): OpsAlert[] {
  const s = loadStore();
  const out: OpsAlert[] = [];
  // Requests waiting for this manager's decision.
  for (const r of s.support.filter((x) => x.status === "open" && allowedProperties(user).includes(x.propertyId))) {
    const mine = r.items.filter((i) => i.status === "pending" && managesDept(user, i.deptId) && can(user, "staff.lend"));
    if (mine.length) {
      out.push({ id: `sr-${r.id}-${mine.length}`, text: `The ${deptById[r.toDeptId].name.replace(/^The /, "")} team has requested ${words(mine.length)} ${r.skill === "waiter" ? "waiter" : SKILL_LABEL[r.skill as Skill].toLowerCase()}${mine.length === 1 ? "" : "s"} from your department.`, href: `/events?tab=support&request=${r.id}`, action: "Review request" });
    }
  }
  // Suggestions and confirmations for the requester.
  for (const r of s.support.filter((x) => x.requestedBy === user.id)) {
    if (r.items.some((i) => i.status === "alternative")) out.push({ id: `alt-${r.id}-${r.items.filter((i) => i.status === "alternative").length}`, text: `${deptById[r.items.find((i) => i.status === "alternative")!.deptId].name} suggested an alternative for your request.`, href: `/events?tab=support&request=${r.id}`, action: "Review" });
    if (r.status === "filled") {
      const e = r.eventId ? s.events.find((x) => x.id === r.eventId) : undefined;
      out.push({ id: `ok-${r.id}`, text: e ? `Staff support confirmed for ${dayWord(e.date).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())} ${shortName(e)}.` : `Staff support confirmed for ${deptById[r.toDeptId].name}.`, href: e ? `/events?tab=events&event=${e.id}` : `/events?tab=support&request=${r.id}`, action: e ? "View event" : "View" });
    }
  }
  // Events this planner runs: staff still needed, or ingredients to buy.
  if (can(user, "events.plan")) {
    for (const e of s.events.filter((x) => isCommitted(x) && canSeeEvent(user, x) && x.date >= DEMO_TODAY)) {
      const short = coverage(e, s.assignments, s.support).filter((c) => c.stillNeeded > 0 && c.stillNeeded > c.requested);
      if (short.length) {
        const c = short[0];
        out.push({ id: `staff-${e.id}-${short.map((x) => `${x.skill}${x.stillNeeded}`).join("")}`, text: `${dayWord(e.date)} ${shortName(e)} needs ${words(c.stillNeeded)} additional ${SKILL_LABEL[c.skill].toLowerCase()}${c.stillNeeded === 1 ? "" : "s"}${short.length > 1 ? `, and ${words(short.length - 1)} other role${short.length > 2 ? "s are" : " is"} short` : ""}.`, href: `/events?tab=events&event=${e.id}&step=4`, action: "Find staff" });
      }
      if (can(user, "purchase.create") && buyPlanForEvent(user, e, entries).some((l) => l.suggested > 0)) {
        out.push({ id: `buy-${e.id}-${e.updatedAt}`, text: `${dayWord(e.date)} ${shortName(e)} menu has an ingredient shortage.`, href: `/events?tab=events&event=${e.id}&step=3`, action: "Review ingredients" });
      }
    }
  }
  // A staff member's next assignment.
  for (const a of myAssignments(user).filter((x) => x.status === "confirmed" && !x.done).slice(0, 1)) {
    out.push({ id: `mine-${a.id}`, text: `You are helping ${a.for} on ${fmtDate(a.date, true)}, ${fmtMin(a.start)} to ${fmtMin(a.end)}.`, href: "/tasks", action: "See details" });
  }
  return out;
}

export const propertyName = (id: string) => propertyById[id].name;
export const userName = (id: string) => userById[id]?.name ?? id;
