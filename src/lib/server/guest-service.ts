// Guest requests, Guest Connect, housekeeping supplies, service measurements and alerts. Same store and rules as the
// rooms board; Guest Connect requests keep their own record, and only an outlet's answer can make one "accepted".
import { ingredientById, outletById } from "../data/catalog";
import { deptById } from "../data/workforce";
import { allowedOutlets, can } from "../domain/access";
import { SERVICE_TARGETS, VENUES, availabilityAt, metricsFor, slotOf, venueById, type Availability, type ServiceMetrics, type Venue, type VenueKind } from "../domain/guest";
import type { GcRequest, GcStatus, GuestRequestKind, ServiceRequest, User } from "../types";
import { DEMO_TODAY, addDays } from "../util";
import { bellBoard, demoNow, fail, roomsBoard, type Result } from "./guest";
import { loadStore, mutateStore, nextNumber, type Shape } from "./purchasing-store";
import { stockFor, type SessionEntries } from "./stock";

const text = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const inHotel = (user: User) => (["owner", "gm"].includes(user.role) || !!user.deptId || can(user, "gc.respond")) && (user.propertyIds === "all" || user.propertyIds.includes("dxb"));

// ---- Guest requests ------------------------------------------------------------------------------------------------

const KINDS: GuestRequestKind[] = ["taxi", "restaurant", "spa", "activity", "assistance", "bell", "general"];
/** Who looks after each kind of request next. Restaurant, spa and activity go through Guest Connect. */
const ROUTE: Record<GuestRequestKind, string> = { taxi: "dxb-conc", restaurant: "dxb-conc", spa: "dxb-conc", activity: "dxb-conc", assistance: "dxb-hk", bell: "dxb-bell", general: "dxb-fo" };

export function requestsFor(user: User): Result<{ requests: ServiceRequest[]; now: number }> {
  if (!inHotel(user) || !(can(user, "concierge") || can(user, "fo.desk") || can(user, "hk.manage") || can(user, "rooms.view"))) return fail(403, "Your role cannot open guest requests.");
  const g = loadStore().guest;
  // Housekeeping sees requests routed to it; the front desk, concierge and managers see all.
  const all = can(user, "concierge") || can(user, "fo.desk") || user.role === "owner" || user.role === "gm";
  return { ok: true, now: demoNow(g), requests: g.requests.filter((r) => all || r.deptId === user.deptId).sort((a, b) => b.createdMin - a.createdMin) };
}

export function createRequest(user: User, body: Record<string, unknown>): Result<{ request: ServiceRequest }> {
  if (!can(user, "concierge") && !can(user, "fo.desk")) return fail(403, "Your role cannot raise guest requests.");
  const kind = KINDS.find((k) => k === body.kind);
  if (!kind) return fail(400, "Choose what the guest needs.");
  const s = loadStore();
  const room = text(body.room, 8);
  if (!s.guest.rooms.some((r) => r.number === room)) return fail(400, "Enter a room number at this hotel.");
  const details = text(body.details, 300);
  if (details.length < 3) return fail(400, "Say what the guest needs.");
  const now = demoNow(s.guest);
  const forMin = typeof body.forMin === "number" && body.forMin >= 0 && body.forMin < 30 * 60 ? Math.round(body.forMin) : now;
  if (s.guest.requests.some((r) => r.room === room && r.kind === kind && r.details.toLowerCase() === details.toLowerCase() && !["completed", "cancelled", "unable"].includes(r.status))) return fail(409, "This request is already open.");
  const request = mutateStore((x) => {
    const id = `GR-DXB-${String(nextNumber(x, "GR-DXB") + 6).padStart(4, "0")}`;
    const r: ServiceRequest = { id, propertyId: "dxb", kind, room, details, forMin, priority: body.priority === "urgent" ? "urgent" : "normal", deptId: ROUTE[kind], status: "new", createdBy: user.id, createdMin: now, history: [{ min: now, by: user.id, action: `Request raised for ${deptById[ROUTE[kind]].name}` }] };
    x.guest.requests.push(r);
    return r;
  });
  return { ok: true, request };
}

const STEP: Partial<Record<string, ServiceRequest["status"]>> = { assign: "assigned", start: "in_progress", awaiting: "awaiting_confirmation", confirm: "confirmed", complete: "completed", cancel: "cancelled", unable: "unable" };

/** Move a request on. External confirmations, such as a taxi company's, are typed in by staff and shown as simulated. */
export function requestAction(user: User, id: string, body: Record<string, unknown>): Result<{ request: ServiceRequest }> {
  const s = loadStore();
  const r = s.guest.requests.find((x) => x.id === id);
  if (!r || !inHotel(user)) return fail(404, "This request is not available.");
  const owner = can(user, "concierge") || can(user, "fo.desk") || (can(user, "hk.manage") && r.deptId === user.deptId);
  if (!owner) return fail(403, "Only the department handling this request can update it.");
  if (["completed", "cancelled", "unable"].includes(r.status)) return fail(409, "This request is already closed.");
  if (body.expect !== undefined && body.expect !== r.status) return fail(409, "Someone else updated this request. Refresh and try again.");
  const action = String(body.action ?? "");
  const note = text(body.note);
  if (action === "escalate") {
    if (note.length < 3) return fail(400, "Say why it needs escalating.");
    const now0 = demoNow(s.guest);
    const request = mutateStore((x) => {
      const y = x.guest.requests.find((z) => z.id === id)!;
      y.priority = "urgent";
      y.history.push({ min: now0, by: user.id, action: "Escalated to the front office manager", note });
      return y;
    });
    return { ok: true, request };
  }
  const to = STEP[action];
  if (!to) return fail(400, "Unknown action.");
  if (action === "confirm") {
    if (r.kind === "restaurant" || r.kind === "spa" || r.kind === "activity") return fail(409, "Hotel venues confirm through Guest Connect.");
    if (note.length < 3) return fail(400, "Enter the confirmation you received, such as the taxi company's reference.");
  }
  if ((action === "cancel" || action === "unable") && note.length < 3) return fail(400, "Say why.");
  const now = demoNow(s.guest);
  const request = mutateStore((x) => {
    const y = x.guest.requests.find((z) => z.id === id)!;
    y.status = to;
    if (action === "assign") y.assigneeId = user.id;
    if (action === "confirm") y.confirmation = `${note} (recorded by staff; simulated in this demo)`;
    y.history.push({ min: now, by: user.id, action: { assign: "Taken on", start: "Started", awaiting: "Waiting for an outside confirmation", confirm: "Confirmation recorded", complete: "Completed", cancel: "Cancelled", unable: "Unable to fulfil" }[action]!, note: note || undefined });
    if (to === "completed") {
      const assigned = y.history.find((h) => h.action === "Taken on" || h.action === "Started")?.min;
      x.guest.log.push({ id: `L-${y.id}`, date: DEMO_TODAY, propertyId: "dxb", kind: "request", ref: y.id, createdMin: y.createdMin, assignedMin: assigned, doneMin: now, target: SERVICE_TARGETS.request[y.kind] ?? 30, escalated: y.priority === "urgent" });
    }
    return y;
  });
  return { ok: true, request };
}

// ---- Guest Connect -------------------------------------------------------------------------------------------------

/** Seats already held by Guest Connect at a venue and slot: accepted and confirmed requests only. */
const heldSeats = (s: Shape, venueId: string, date: string, slot: number, exceptId?: string) =>
  s.guest.gc.filter((r) => r.id !== exceptId && r.venueId === venueId && r.date === date && slotOf(r.timeMin) === slot && (r.status === "accepted" || r.status === "confirmed")).reduce((t, r) => t + r.party, 0);

export interface VenueOption extends Venue { availability: Availability; free: number | null }

/** Venues of a kind at the user's hotel, with what the demo records say about the time asked for. */
export function venuesFor(user: User, body: Record<string, unknown>): Result<{ venues: VenueOption[]; note: string }> {
  if (!can(user, "fo.desk") && !can(user, "concierge")) return fail(403, "Your role cannot use Guest Connect.");
  const kind = String(body.kind ?? "") as VenueKind;
  const party = Math.max(1, Math.min(20, Number(body.party ?? 2)));
  const date = body.date === addDays(DEMO_TODAY, 1) ? addDays(DEMO_TODAY, 1) : DEMO_TODAY;
  const time = Number(body.timeMin ?? 19 * 60 + 30);
  const s = loadStore();
  const venues = VENUES.filter((v) => v.propertyId === "dxb" && (v.kind === kind || (kind === "lounge" && v.kind === "lounge")))
    .map((v) => { const a = availabilityAt(v, date, time, party, heldSeats(s, v.id, date, slotOf(time))); return { ...v, availability: a.status, free: a.free }; })
    .sort((a, b) => ["likely", "limited", "request", "closed"].indexOf(a.availability) - ["likely", "limited", "request", "closed"].indexOf(b.availability));
  return { ok: true, venues, note: "Availability is simulated from demo booking patterns. Nothing is confirmed until the venue accepts." };
}

/** Who answers for a venue: the outlet's manager, or for the spa and activities, the general manager. */
const mayRespond = (user: User, v: Venue) => can(user, "gc.respond") && (v.outletId ? allowedOutlets(user).includes(v.outletId) : user.role === "gm" || user.role === "owner");

export function gcFor(user: User): Result<{ requests: (GcRequest & { venueName: string })[]; now: number }> {
  if (!can(user, "fo.desk") && !can(user, "concierge") && !can(user, "gc.respond")) return fail(403, "Your role cannot open Guest Connect.");
  const g = loadStore().guest;
  const list = g.gc.filter((r) => r.createdBy === user.id || can(user, "fo.desk") || can(user, "concierge") || mayRespond(user, venueById[r.venueId]));
  return { ok: true, now: demoNow(g), requests: list.map((r) => ({ ...r, venueName: venueById[r.venueId].name })).sort((a, b) => b.createdMin - a.createdMin) };
}

export function createGc(user: User, body: Record<string, unknown>): Result<{ request: GcRequest }> {
  if (!can(user, "fo.desk") && !can(user, "concierge")) return fail(403, "Your role cannot use Guest Connect.");
  const v = venueById[String(body.venueId ?? "")];
  if (!v || v.propertyId !== "dxb") return fail(400, "Choose a venue at this hotel.");
  const party = Number(body.party);
  if (!Number.isInteger(party) || party < 1 || party > 20) return fail(400, "Enter between 1 and 20 guests.");
  const date = body.date === addDays(DEMO_TODAY, 1) ? addDays(DEMO_TODAY, 1) : DEMO_TODAY;
  const timeMin = Number(body.timeMin);
  if (!Number.isInteger(timeMin) || timeMin < v.opens || timeMin + 30 > v.closes) return fail(400, `${v.name} is open ${hm(v.opens)} to ${hm(v.closes)}.`);
  const s = loadStore();
  const now = demoNow(s.guest);
  if (date === DEMO_TODAY && timeMin < now) return fail(400, "That time has passed.");
  const room = text(body.room, 8);
  if (!s.guest.rooms.some((r) => r.number === room)) return fail(400, "Enter the guest's room number.");
  // A double tap or the same request twice: the open request is kept.
  const dup = s.guest.gc.find((r) => r.room === room && r.venueId === v.id && r.date === date && r.timeMin === timeMin && ["pending", "accepted", "alternative", "confirmed"].includes(r.status));
  if (dup) return fail(409, `${dup.id} already asks ${v.name} for this time.`);
  const request = mutateStore((x) => {
    const id = `GC-DXB-${String(nextNumber(x, "GC-DXB")).padStart(4, "0")}`;
    const r: GcRequest = { id, propertyId: "dxb", venueId: v.id, room, party, date, timeMin, notes: text(body.notes, 200), status: "pending", createdBy: user.id, fromDeptId: user.deptId ?? "dxb-fo", createdMin: now, sourceRequestId: typeof body.sourceRequestId === "string" ? body.sourceRequestId : undefined,
      history: [{ min: now, by: user.id, action: `Asked ${v.name} for ${party} at ${hm(timeMin)}${date !== DEMO_TODAY ? " tomorrow" : ""}` }] };
    x.guest.gc.push(r);
    if (r.sourceRequestId) { const sr = x.guest.requests.find((y) => y.id === r.sourceRequestId); if (sr) { sr.status = "awaiting_confirmation"; sr.linkedId = id; sr.history.push({ min: now, by: user.id, action: `Sent to ${v.name} through Guest Connect (${id})` }); } }
    return r;
  });
  return { ok: true, request };
}

/** The venue's answer, or the requester's next step. Capacity is checked again at every acceptance. */
export function gcAction(user: User, id: string, body: Record<string, unknown>): Result<{ request: GcRequest }> {
  const s = loadStore();
  const r = s.guest.gc.find((x) => x.id === id);
  if (!r) return fail(404, "This request is not available.");
  const v = venueById[r.venueId];
  const action = String(body.action ?? "");
  const now = demoNow(s.guest);
  const requester = r.createdBy === user.id || can(user, "fo.desk") || can(user, "concierge");
  if (body.expect !== undefined && body.expect !== r.status) return fail(409, `This request was updated meanwhile: it is now ${r.status}.`);
  const note = text(body.note);
  const fits = (timeMin: number, party: number) => {
    const a = availabilityAt(v, r.date, timeMin, party, heldSeats(s, v.id, r.date, slotOf(timeMin), r.id));
    return a.status === "closed" ? `${v.name} is closed then.` : a.free !== null && a.free < party ? `Only ${Math.max(0, a.free)} seats are free at ${hm(timeMin)} in the demo records.` : null;
  };
  const save = (status: GcStatus, label: string, change?: (y: GcRequest, x: Shape) => void) => ({
    ok: true as const,
    request: mutateStore((x) => {
      const y = x.guest.gc.find((z) => z.id === id)!;
      const was = y.status;
      y.status = status;
      change?.(y, x);
      y.history.push({ min: now, by: user.id, action: label, note: note || undefined });
      // The venue's first answer is measured against the response target.
      if (was === "pending" && ["accepted", "declined", "alternative"].includes(status)) {
        y.respondedMin = now; y.respondedBy = user.id;
        x.guest.log.push({ id: `L-${y.id}-${now}`, date: DEMO_TODAY, propertyId: "dxb", kind: "gc", ref: y.id, createdMin: y.createdMin, assignedMin: now, doneMin: now, target: SERVICE_TARGETS.gcResponse, confirmed: status === "accepted" });
      }
      const sr = y.sourceRequestId ? x.guest.requests.find((z) => z.id === y.sourceRequestId) : undefined;
      if (sr && status === "confirmed") { sr.status = "confirmed"; sr.history.push({ min: now, by: user.id, action: `${v.name} confirmed for ${y.party} at ${hm(y.timeMin)}` }); }
      if (sr && (status === "declined" || status === "cancelled")) sr.history.push({ min: now, by: user.id, action: `${v.name}: ${status}` });
      return y;
    }),
  });

  switch (action) {
    case "accept":
    case "decline":
    case "alternative": {
      if (!mayRespond(user, v)) return fail(403, `Only ${v.outletId ? `${v.name}'s managers` : "the general manager"} can answer for ${v.name}.`);
      if (r.status !== "pending") return fail(409, "This request has already been answered.");
      if (action === "accept") {
        const problem = fits(r.timeMin, r.party);
        if (problem) return fail(409, `${problem} Suggest another time instead.`);
        return save("accepted", `${v.name} accepted: ${r.party} at ${hm(r.timeMin)}`);
      }
      if (action === "decline") {
        if (note.length < 3) return fail(400, "Say why, so the front desk can tell the guest.");
        return save("declined", `${v.name} declined`);
      }
      const t = Number(body.timeMin);
      if (!Number.isInteger(t) || t === r.timeMin) return fail(400, "Choose a different time.");
      const problem = fits(t, r.party);
      if (problem) return fail(409, problem);
      return save("alternative", `${v.name} suggested ${hm(t)}`, (y) => { y.proposedMin = t; });
    }
    case "accept_alternative": {
      if (!requester) return fail(403, "Only the front desk or concierge can answer this.");
      if (r.status !== "alternative" || r.proposedMin === undefined) return fail(409, "There is no suggested time to accept.");
      const problem = fits(r.proposedMin, r.party);
      if (problem) return fail(409, `${problem} Ask ${v.name} again.`);
      return save("accepted", `Suggested time accepted: ${hm(r.proposedMin)}`, (y) => { y.timeMin = y.proposedMin!; y.proposedMin = undefined; });
    }
    case "confirm": {
      if (!requester) return fail(403, "Only the front desk or concierge can confirm with the guest.");
      if (r.status !== "accepted") return fail(409, "Only a request the venue has accepted can be confirmed with the guest.");
      return save("confirmed", "Confirmed with the guest by the front desk. No message was sent by Tyll.");
    }
    case "change": {
      if (!requester) return fail(403, "Only the front desk or concierge can change this.");
      if (!["pending", "accepted", "alternative", "confirmed"].includes(r.status)) return fail(409, "This request is closed.");
      const t = body.timeMin === undefined ? r.timeMin : Number(body.timeMin);
      const p = body.party === undefined ? r.party : Number(body.party);
      if (!Number.isInteger(t) || !Number.isInteger(p) || p < 1 || p > 20 || t < v.opens || t + 30 > v.closes) return fail(400, "Check the time and party size.");
      if (t === r.timeMin && p === r.party) return fail(400, "Nothing changed.");
      // A change goes back to the venue; any seats held are released until it answers again.
      return save("pending", `Changed to ${p} at ${hm(t)}; waiting for ${v.name} again`, (y) => { y.timeMin = t; y.party = p; y.proposedMin = undefined; });
    }
    case "cancel": {
      if (!requester && !mayRespond(user, v)) return fail(403, "You cannot cancel this request.");
      if (["declined", "cancelled"].includes(r.status)) return fail(409, "This request is already closed.");
      if (note.length < 3) return fail(400, "Say why.");
      return save("cancelled", "Cancelled; seats released");
    }
    default:
      return fail(400, "Unknown action.");
  }
}

// ---- Housekeeping supplies -----------------------------------------------------------------------------------------

/** Par levels for the demo: about three nights of use at this hotel. Planning assumptions, not stock rules. */
const SUPPLY_PAR: Record<string, number> = { amenity: 180, towel: 400, chem: 30 };

export function suppliesFor(user: User, entries: SessionEntries): Result<{ supplies: { ingredientId: string; name: string; unit: string; onHand: number; par: number; needed: number; openRequest?: { id: string; status: string } }[] }> {
  if (!can(user, "hk.manage") || user.deptId !== "dxb-hk") return fail(403, "Only housekeeping managers can see supplies.");
  const rows = stockFor(user, "dxb", entries);
  const s = loadStore();
  return {
    ok: true,
    supplies: Object.keys(SUPPLY_PAR).map((id) => {
      const g = ingredientById[id];
      const onHand = Math.max(0, rows.find((r) => r.ingredientId === id)?.estimated ?? 0);
      const pack = g.packSize;
      const open = s.requests.find((r) => r.deptId === "dxb-hk" && !["received", "rejected"].includes(r.status) && r.lines.some((l) => l.ingredientId === id));
      return { ingredientId: id, name: g.name, unit: g.unit === "each" ? "units" : g.unit, onHand, par: SUPPLY_PAR[id], needed: onHand >= SUPPLY_PAR[id] ? 0 : Math.ceil((SUPPLY_PAR[id] - onHand) / pack) * pack, openRequest: open ? { id: open.id, status: open.status } : undefined };
    }),
  };
}

// ---- Measurements and alerts ---------------------------------------------------------------------------------------

export interface ServiceSummary {
  today: ServiceMetrics;
  yesterday: ServiceMetrics;
  open: { roomsAtRisk: number; overdueBell: number; overdueRequests: number; pendingGc: number; staffShort: boolean };
  now: number;
}

export function serviceSummary(user: User): Result<{ summary: ServiceSummary }> {
  if (!can(user, "rooms.view")) return fail(403, "Your role cannot see service performance.");
  if (!inHotel(user)) return fail(403, "Not available for your hotels.");
  const s = loadStore();
  const now = demoNow(s.guest);
  const rb = roomsBoard({ ...user, role: "gm" } as User);
  const board = rb.ok ? rb.board : null;
  return {
    ok: true,
    summary: {
      today: metricsFor(s.guest.log, DEMO_TODAY, "dxb"), yesterday: metricsFor(s.guest.log, addDays(DEMO_TODAY, -1), "dxb"), now,
      open: {
        roomsAtRisk: board?.atRisk.length ?? 0,
        overdueBell: s.guest.bell.filter((t) => !["delivered", "completed", "cancelled"].includes(t.status) && now - t.requestedMin > SERVICE_TARGETS.bell).length,
        overdueRequests: s.guest.requests.filter((r) => !["completed", "cancelled", "unable", "confirmed"].includes(r.status) && now - r.createdMin > (SERVICE_TARGETS.request[r.kind] ?? 30)).length,
        pendingGc: s.guest.gc.filter((r) => r.status === "pending").length,
        staffShort: !!board?.shortage,
      },
    },
  };
}

export interface GuestAlert { id: string; text: string; href: string; action: string }

/** One or two notices for this person's job. The owner gets only the serious ones. */
export function guestAlerts(user: User): GuestAlert[] {
  if (!inHotel(user)) return [];
  const s = loadStore();
  const now = demoNow(s.guest);
  const out: GuestAlert[] = [];
  const strategic = user.role === "owner";
  if (can(user, "fo.desk") || can(user, "hk.manage") || user.role === "gm" || strategic) {
    const rb = roomsBoard(user);
    const risk = rb.ok ? rb.board.atRisk : [];
    const worst = risk[0];
    if (worst && (!strategic || (worst.arrival?.delay ?? 0) >= 15)) out.push({ id: `room-${worst.roomId}-${worst.status}-${worst.priority}`, text: worst.arrival!.risk === "waiting" ? `The guest for room ${worst.number} is waiting; the room is not ready yet.` : `Room ${worst.number} may be ${worst.arrival!.delay} minutes late for the expected arrival.`, href: `/rooms?tab=readiness&room=${worst.roomId}`, action: "Review room" });
    if (can(user, "hk.manage") && rb.ok && rb.board.rooms.some((r) => r.priority && r.status !== "ready")) {
      const p = rb.board.rooms.find((r) => r.priority && r.status !== "ready")!;
      out.unshift({ id: `prio-${p.roomId}-${p.priorityRequestedMin}`, text: `Front office asked for room ${p.number} to be cleaned first.`, href: `/rooms?tab=housekeeping&room=${p.roomId}`, action: "Open room" });
    }
  }
  if (can(user, "gc.respond")) {
    const mine = s.guest.gc.filter((r) => r.status === "pending" && mayRespond(user, venueById[r.venueId]));
    if (mine.length) out.unshift({ id: `gc-${mine.map((r) => r.id).join(",")}`, text: `${venueById[mine[0].venueId].name} has received ${mine.length === 1 ? "a new table request" : `${mine.length} new table requests`}.`, href: "/rooms?tab=tables", action: "Respond" });
  }
  if (can(user, "fo.desk") || can(user, "concierge")) {
    const answered = s.guest.gc.filter((r) => r.createdBy === user.id && (r.status === "accepted" || r.status === "alternative" || r.status === "declined"));
    for (const r of answered.slice(0, 1)) out.unshift({ id: `gcans-${r.id}-${r.status}`, text: r.status === "accepted" ? `${venueById[r.venueId].name} accepted ${r.party} at ${hm(r.timeMin)}. Confirm with the guest.` : r.status === "alternative" ? `${venueById[r.venueId].name} suggested ${hm(r.proposedMin!)} instead of ${hm(r.timeMin)}.` : `${venueById[r.venueId].name} declined the request for room ${r.room}.`, href: `/rooms?tab=connect&request=${r.id}`, action: "Open" });
    const late = s.guest.requests.find((r) => !["completed", "cancelled", "unable", "confirmed"].includes(r.status) && now - r.createdMin > (SERVICE_TARGETS.request[r.kind] ?? 30));
    if (late) out.push({ id: `req-${late.id}-${late.status}`, text: `A ${late.kind === "general" || late.kind === "assistance" ? "guest" : late.kind} request for room ${late.room} has been waiting ${now - late.createdMin} minutes.`, href: `/rooms?tab=requests&request=${late.id}`, action: "View request" });
  }
  if (can(user, "bell.dispatch") || can(user, "fo.desk")) {
    const b = bellBoard(user);
    const late = b.ok ? b.tasks.find((t) => t.overdue) : undefined;
    if (late) out.push({ id: `bell-${late.id}-${late.status}`, text: `${late.kind === "delivery" ? "Luggage delivery" : "Luggage task"} for room ${late.room} is overdue.`, href: `/rooms?tab=bell&task=${late.id}`, action: "Track task" });
    const fresh = b.ok && can(user, "bell.dispatch") ? b.tasks.find((t) => t.status === "requested") : undefined;
    if (fresh) out.unshift({ id: `bellnew-${fresh.id}`, text: `New ${fresh.kind} request for room ${fresh.room}.`, href: `/rooms?tab=bell&task=${fresh.id}`, action: "Assign" });
  }
  if (strategic) return out.filter((a) => a.id.startsWith("room-")).slice(0, 1);
  return out;
}

export { outletById };
