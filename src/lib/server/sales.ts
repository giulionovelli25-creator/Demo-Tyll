// Sales: opportunities, proposals and the hand-over of confirmed business to Events. Proposal costs come from the
// Stage 4 event calculation; confirming creates (or updates) one event record through the same builder Events uses.
// Nothing is sent to customers: sending, acceptance and declines are recorded by staff and labelled as such.
import { propertyById, userById } from "../data/catalog";
import { allowedProperties, can } from "../domain/access";
import { DEFAULT_RATIOS, SERVICES, coverage, eventCost, serviceFor } from "../domain/events";
import type { Currency, EventRecord, EventType, Opportunity, OppStatus, OppType, Proposal, ProposalStatus, ServiceFormat, ServiceId, User } from "../types";
import { DEMO_TODAY, addDays } from "../util";
import { buildEvent, readEvent } from "./ops";
import { loadStore, mutateStore, type Shape } from "./purchasing-store";

type Fail = { ok: false; status: number; error: string };
export type Result<T = object> = ({ ok: true } & T) | Fail;
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const now = () => new Date().toISOString();
const text = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Discounts above this need a director of sales or the general manager. Demo settings, per hotel. */
export const SALES_POLICY: Record<string, { discountApprovalAbove: number; approverLabel: string }> = {
  dxb: { discountApprovalAbove: 10, approverLabel: "Director of sales or general manager" },
  doh: { discountApprovalAbove: 8, approverLabel: "General manager" },
};

const OPP_TYPES: OppType[] = ["Conference", "Group booking", "Wedding", "Private dining", "Banquet", "Corporate hospitality"];
const EVENT_TYPE: Record<OppType, EventType> = { Conference: "Conference", "Group booking": "Hotel function", Wedding: "Wedding", "Private dining": "Private dining", Banquet: "Banquet", "Corporate hospitality": "Corporate dinner" };
const FORMATS: ServiceFormat[] = ["seated", "buffet", "reception", "theatre"];
const OPEN_OPP: OppStatus[] = ["new", "contacted", "proposal_needed", "proposal_sent"];
/** The banqueting kitchen that prepares event food at each hotel, as on the seeded events. Events can change it. */
const EVENT_KITCHEN: Record<string, string> = { dxb: "dxb-terrace", doh: "doh-souq" };

const canSeeOpp = (user: User, o: Pick<Opportunity, "propertyId">) => can(user, "sales.view") && allowedProperties(user).includes(o.propertyId);
const salesPeople = (propertyId: string) => Object.values(userById).filter((u) => (u.role === "sales" || u.role === "sales_director") && allowedProperties(u).includes(propertyId));

// ---- Costing -------------------------------------------------------------------------------------------------------

export interface ProposalCosting {
  /** Selling price after discount, including priced extras. */
  price: number;
  priceBeforeDiscount: number;
  food: number;
  drink: number;
  labour: number;
  /** Estimated direct cost of food, drink and event labour. */
  directCost: number;
  contribution: number;
  excluded: string[];
}

/** The proposal as an event plan, so the Stage 4 calculation prices it. Never saved. */
function asEvent(p: Proposal, o: Opportunity): EventRecord {
  return {
    id: `PREVIEW-${p.id}`, propertyId: p.propertyId, name: o.customer, type: EVENT_TYPE[o.type], venue: p.venue, date: p.date, start: p.start, end: p.end, setupStart: p.start - 120, cleanupEnd: p.end + 60,
    guests: p.guests, format: p.format, dietary: "", notes: "", status: "draft", kitchenOutletId: EVENT_KITCHEN[p.propertyId], services: p.services.map((id) => serviceFor(id, p.guests)),
    ratios: { ...DEFAULT_RATIOS[p.format] }, pricePerGuest: netPerGuest(p), issued: [], createdBy: p.createdBy, updatedAt: p.updatedAt, history: [],
  };
}

const netPerGuest = (p: Pick<Proposal, "pricePerGuest" | "discountPct">) => r2(p.pricePerGuest * (1 - p.discountPct / 100));

export function costProposal(p: Proposal, o: Opportunity): ProposalCosting {
  const e = asEvent(p, o);
  const c = eventCost(e, coverage(e, [], []));
  const extras = p.extras.reduce((t, x) => t + x.amount, 0);
  const price = r2(netPerGuest(p) * p.guests + extras);
  const directCost = r2(c.food + c.drink + c.labour);
  return {
    price, priceBeforeDiscount: r2(p.pricePerGuest * p.guests + extras), food: c.food, drink: c.drink, labour: c.labour, directCost, contribution: r2(price - directCost),
    excluded: ["Room hire, audio-visual and decor costs", ...(p.extras.length ? ["Costs of the priced extras (only their selling price is included)"] : []), "Overheads and energy"],
  };
}

// ---- Reading -------------------------------------------------------------------------------------------------------

export interface OppView extends Opportunity {
  ownerName: string;
  currency: Currency;
  proposals: (Proposal & { costing: ProposalCosting; needsApproval: boolean })[];
  event?: { id: string; name: string; status: string; date: string; guests: number; staffStillNeeded: number };
}

function viewOpp(s: Shape, o: Opportunity): OppView {
  const e = o.eventId ? s.events.find((x) => x.id === o.eventId) : undefined;
  return {
    ...o, ownerName: userById[o.ownerId]?.name ?? o.ownerId, currency: propertyById[o.propertyId].currency,
    proposals: s.sales.proposals.filter((p) => p.oppId === o.id).sort((a, b) => b.version - a.version).map((p) => ({ ...p, costing: costProposal(p, o), needsApproval: p.discountPct > SALES_POLICY[p.propertyId].discountApprovalAbove })),
    event: e ? { id: e.id, name: e.name, status: e.status, date: e.date, guests: e.guests, staffStillNeeded: coverage(e, s.assignments, s.support).reduce((t, c) => t + c.stillNeeded, 0) } : undefined,
  };
}

export function salesFor(user: User, propertyId?: string): Result<{ opps: OppView[]; people: { id: string; name: string }[]; policy: typeof SALES_POLICY }> {
  if (!can(user, "sales.view")) return fail(403, "Your role cannot open sales records.");
  const s = loadStore();
  const props = allowedProperties(user).filter((p) => !propertyId || p === propertyId);
  const opps = s.sales.opps.filter((o) => props.includes(o.propertyId) && canSeeOpp(user, o)).map((o) => viewOpp(s, o)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const people = [...new Map(props.flatMap(salesPeople).map((u) => [u.id, { id: u.id, name: u.name }])).values()];
  return { ok: true, opps, people, policy: SALES_POLICY };
}

const nextId = (list: { id: string }[], prefix: string) => `${prefix}-${String(list.filter((x) => x.id.startsWith(`${prefix}-`)).reduce((m, x) => Math.max(m, Number(x.id.split("-").pop()) || 0), 0) + 1).padStart(4, "0")}`;

// ---- Opportunities -------------------------------------------------------------------------------------------------

export function saveOpp(user: User, body: Record<string, unknown>): Result<{ opp: Opportunity }> {
  if (!can(user, "sales.work")) return fail(403, "Only sales can create or change opportunities.");
  const s = loadStore();
  const existing = typeof body.id === "string" ? s.sales.opps.find((o) => o.id === body.id) : undefined;
  if (body.id && (!existing || !canSeeOpp(user, existing))) return fail(404, "This opportunity is not available.");
  const propertyId = existing?.propertyId ?? String(body.propertyId ?? "");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const f: Partial<Opportunity> = {};
  if (body.type !== undefined) { if (!OPP_TYPES.includes(body.type as OppType)) return fail(400, "Choose the type of business."); f.type = body.type as OppType; }
  if (body.customer !== undefined) { const c = text(body.customer, 80); if (c.length < 2) return fail(400, "Enter the organisation or a display name."); f.customer = c; }
  if (body.expectedDate !== undefined) { const d = String(body.expectedDate); if (!ISO.test(d) || d < DEMO_TODAY) return fail(400, "Choose an expected date from today."); f.expectedDate = d; }
  if (body.guests !== undefined) { const g = Number(body.guests); if (!Number.isInteger(g) || g < 1 || g > 2000) return fail(400, "Enter between 1 and 2,000 guests."); f.guests = g; }
  if (body.value !== undefined) { const v = Number(body.value); if (!Number.isFinite(v) || v < 0 || v > 1e8) return fail(400, "Enter the expected value."); f.value = Math.round(v); }
  if (body.nextAction !== undefined) f.nextAction = text(body.nextAction, 160);
  if (body.nextActionDue !== undefined) { const d = String(body.nextActionDue ?? ""); f.nextActionDue = ISO.test(d) ? d : undefined; }
  if (body.notes !== undefined) f.notes = text(body.notes, 1000);
  if (body.ownerId !== undefined) { if (!salesPeople(propertyId).some((u) => u.id === body.ownerId)) return fail(400, "Assign it to a salesperson at this hotel."); f.ownerId = String(body.ownerId); }
  if (body.status !== undefined) {
    const st = body.status as OppStatus;
    if (st === "confirmed") return fail(409, "Business is confirmed from an accepted proposal.");
    if (!["new", "contacted", "proposal_needed", "proposal_sent", "lost"].includes(st)) return fail(400, "Unknown status.");
    if (existing?.status === "confirmed") return fail(409, "Confirmed business is changed through its event.");
    if (st === "lost") { const why = text(body.lostReason, 160); if (why.length < 3) return fail(400, "Say why it was lost."); f.lostReason = why; }
    f.status = st;
  }
  if (!existing) for (const k of ["type", "customer", "expectedDate", "guests"] as const) if (f[k] === undefined) return fail(400, "Enter the type, organisation, expected date and guests.");
  const opp = mutateStore((x) => {
    if (existing) {
      const o = x.sales.opps.find((y) => y.id === existing.id)!;
      const changed = Object.keys(f).filter((k) => JSON.stringify((o as unknown as Record<string, unknown>)[k]) !== JSON.stringify((f as Record<string, unknown>)[k]));
      Object.assign(o, f);
      o.updatedAt = now();
      o.history.push({ at: o.updatedAt, by: user.id, action: f.status ? `Status: ${f.status.replace("_", " ")}` : f.ownerId ? `Assigned to ${userById[f.ownerId].name}` : "Updated", note: changed.filter((k) => k !== "status" && k !== "ownerId").join(", ") || undefined });
      return o;
    }
    const o: Opportunity = {
      id: nextId(x.sales.opps, `OPP-${propertyId.toUpperCase()}`), propertyId, type: f.type!, customer: f.customer!, expectedDate: f.expectedDate!, guests: f.guests!, value: f.value ?? 0, ownerId: f.ownerId ?? user.id,
      status: f.status ?? "new", nextAction: f.nextAction ?? "", nextActionDue: f.nextActionDue, notes: f.notes ?? "", createdAt: now(), updatedAt: now(), history: [{ at: now(), by: user.id, action: "Opportunity created" }],
    };
    x.sales.opps.push(o);
    return o;
  });
  return { ok: true, opp };
}

// ---- Proposals -----------------------------------------------------------------------------------------------------

export function saveProposal(user: User, body: Record<string, unknown>): Result<{ proposal: Proposal }> {
  if (!can(user, "sales.work")) return fail(403, "Only sales can prepare proposals.");
  const s = loadStore();
  const existing = typeof body.id === "string" ? s.sales.proposals.find((p) => p.id === body.id) : undefined;
  const o = s.sales.opps.find((x) => x.id === (existing?.oppId ?? body.oppId));
  if (!o || !canSeeOpp(user, o)) return fail(404, "This opportunity is not available.");
  if (o.status === "lost") return fail(409, "This opportunity is closed as lost.");
  if (existing && !["draft", "changes_requested", "ready", "discount_pending"].includes(existing.status)) return fail(409, "A sent proposal is not changed. Create a new version instead.");
  const date = String(body.date ?? existing?.date ?? o.expectedDate);
  if (!ISO.test(date) || date < DEMO_TODAY || date > addDays(DEMO_TODAY, 60)) return fail(400, "Choose an event date within the next 60 days.");
  const guests = Number(body.guests ?? existing?.guests ?? o.guests);
  if (!Number.isInteger(guests) || guests < 1 || guests > 2000) return fail(400, "Enter between 1 and 2,000 guests.");
  const start = Number(body.start ?? existing?.start ?? 9 * 60), end = Number(body.end ?? existing?.end ?? 17 * 60);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 26 * 60 || end <= start) return fail(400, "Check the start and end times.");
  const format = (body.format ?? existing?.format ?? "seated") as ServiceFormat;
  if (!FORMATS.includes(format)) return fail(400, "Choose a service style.");
  const services = (Array.isArray(body.services) ? body.services : existing?.services ?? []) as ServiceId[];
  if (!services.length || services.some((x) => !SERVICES[x])) return fail(400, "Choose at least one food or drink package.");
  const price = Number(body.pricePerGuest ?? existing?.pricePerGuest);
  if (!Number.isFinite(price) || price <= 0 || price > 100000) return fail(400, "Enter the price per guest.");
  const discountPct = Number(body.discountPct ?? existing?.discountPct ?? 0);
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 50) return fail(400, "Discounts are between 0 and 50%.");
  const extras = (Array.isArray(body.extras) ? (body.extras as Record<string, unknown>[]) : existing?.extras ?? []).map((x) => ({ label: text(x.label, 60), amount: Math.round(Number(x.amount) * 100) / 100 })).filter((x) => x.label && Number.isFinite(x.amount) && x.amount >= 0);
  const validUntil = String(body.validUntil ?? existing?.validUntil ?? addDays(DEMO_TODAY, 14));
  if (!ISO.test(validUntil) || validUntil < DEMO_TODAY) return fail(400, "Choose how long the proposal is valid.");
  const needsApproval = Math.round(discountPct * 100) / 100 > SALES_POLICY[o.propertyId].discountApprovalAbove;
  const fields = { date, guests, start, end, format, services, pricePerGuest: Math.round(price * 100) / 100, discountPct: Math.round(discountPct * 100) / 100, extras, validUntil, venue: text(body.venue, 60) || existing?.venue || "Grand Ballroom", notes: body.notes !== undefined ? text(body.notes, 800) : existing?.notes ?? "" };
  const status: ProposalStatus = needsApproval ? "discount_pending" : "ready";
  const proposal = mutateStore((x) => {
    if (existing) {
      const p = x.sales.proposals.find((y) => y.id === existing.id)!;
      Object.assign(p, fields, { status, updatedAt: now(), approval: undefined });
      p.history.push({ at: p.updatedAt, by: user.id, action: needsApproval ? `Updated; ${fields.discountPct}% discount needs approval` : "Updated" });
      return p;
    }
    // A new version replaces earlier proposals that were never accepted.
    for (const old of x.sales.proposals.filter((p) => p.oppId === o.id && ["draft", "changes_requested", "ready", "discount_pending", "sent"].includes(p.status))) {
      old.status = "superseded";
      old.history.push({ at: now(), by: user.id, action: "Replaced by a new version" });
    }
    const version = x.sales.proposals.filter((p) => p.oppId === o.id).length + 1;
    const p: Proposal = { id: nextId(x.sales.proposals, `PRP-${o.propertyId.toUpperCase()}`), oppId: o.id, propertyId: o.propertyId, version, ...fields, status, createdBy: user.id, createdAt: now(), updatedAt: now(),
      history: [{ at: now(), by: user.id, action: needsApproval ? `Proposal created; ${fields.discountPct}% discount needs approval` : "Proposal created" }] };
    x.sales.proposals.push(p);
    const opp = x.sales.opps.find((y) => y.id === o.id)!;
    if (["new", "contacted"].includes(opp.status)) { opp.status = "proposal_needed"; opp.updatedAt = now(); }
    opp.history.push({ at: now(), by: user.id, action: `Proposal ${p.id} prepared (version ${version})` });
    return p;
  });
  return { ok: true, proposal };
}

/** Approvals, recording what the customer said, and confirming the business into Events. */
export function proposalAction(user: User, id: string, body: Record<string, unknown>): Result<{ proposal: Proposal; eventId?: string }> {
  const s = loadStore();
  const p = s.sales.proposals.find((x) => x.id === id);
  const o = p && s.sales.opps.find((x) => x.id === p.oppId);
  if (!p || !o || !canSeeOpp(user, o)) return fail(404, "This proposal is not available.");
  if (body.expect !== undefined && body.expect !== p.status) return fail(409, "Someone else updated this proposal. Refresh and try again.");
  const action = String(body.action ?? "");
  const note = text(body.note);
  const save = (status: ProposalStatus, label: string, change?: (y: Proposal, x: Shape) => void, extra?: { eventId?: string }) => ({
    ok: true as const,
    ...extra,
    proposal: mutateStore((x) => {
      const y = x.sales.proposals.find((z) => z.id === id)!;
      y.status = status;
      y.updatedAt = now();
      change?.(y, x);
      y.history.push({ at: y.updatedAt, by: user.id, action: label, note: note || undefined });
      return y;
    }),
  });
  switch (action) {
    case "approve":
    case "reject":
    case "changes": {
      if (!can(user, "sales.approve")) return fail(403, `Only the ${SALES_POLICY[p.propertyId].approverLabel.toLowerCase()} can decide on discounts.`);
      if (p.createdBy === user.id) return fail(403, "You cannot approve your own discount.");
      if (p.status !== "discount_pending") return fail(409, "This proposal is not waiting for a discount decision.");
      if (action !== "approve" && note.length < 3) return fail(400, "Say why, so sales can revise the proposal.");
      const decision = action === "approve" ? "approved" : action === "reject" ? "rejected" : "changes";
      return save(action === "approve" ? "ready" : "changes_requested", action === "approve" ? `${p.discountPct}% discount approved` : action === "reject" ? `${p.discountPct}% discount rejected` : "Changes requested", (y) => { y.approval = { by: user.id, at: now(), decision, note }; });
    }
    case "mark_sent": {
      if (!can(user, "sales.work")) return fail(403, "Only sales can record this.");
      if (p.status !== "ready") return fail(409, p.status === "discount_pending" ? "The discount needs approval before the proposal goes out." : "Only a ready proposal can be marked as sent.");
      return save("sent", "Marked as sent to the customer. Recorded by staff; Tyll does not send email.", (_, x) => {
        const opp = x.sales.opps.find((z) => z.id === o.id)!;
        opp.status = "proposal_sent"; opp.updatedAt = now();
        opp.history.push({ at: now(), by: user.id, action: `Proposal ${p.id} marked as sent` });
      });
    }
    case "record_acceptance": {
      if (!can(user, "sales.work")) return fail(403, "Only sales can record this.");
      if (p.status !== "sent") return fail(409, "Only a sent proposal can be accepted.");
      if (note.length < 5) return fail(400, "Say how the customer accepted, for example: signed proposal received on 14 October.");
      if (p.validUntil < DEMO_TODAY) return fail(409, "This proposal has expired. Prepare a new version.");
      return save("accepted", "Customer acceptance recorded by staff (simulated in this demo)", (y) => { y.acceptance = { by: user.id, at: now(), note }; });
    }
    case "record_decline": {
      if (!can(user, "sales.work")) return fail(403, "Only sales can record this.");
      if (!["sent", "accepted"].includes(p.status)) return fail(409, "Only a sent proposal can be declined.");
      if (note.length < 3) return fail(400, "Say why the customer declined.");
      return save("declined", "Customer declined (recorded by staff)");
    }
    case "confirm": {
      if (!can(user, "sales.work")) return fail(403, "Only sales can confirm business.");
      if (p.status === "confirmed") return fail(409, `Already confirmed${p.eventId ? ` as ${p.eventId}` : ""}.`);
      if (p.status !== "accepted") return fail(409, "Record the customer's acceptance before confirming.");
      const linked = o.eventId ? s.events.find((e) => e.id === o.eventId) : undefined;
      if (linked && ["cancelled", "completed"].includes(linked.status)) return fail(409, `${linked.id} is ${linked.status}; it cannot take a new confirmation.`);
      const fields = readEvent({ name: `${o.customer} ${EVENT_TYPE[o.type].toLowerCase()}`, type: EVENT_TYPE[o.type], venue: p.venue, date: p.date, start: p.start, end: p.end, guests: p.guests, format: p.format, notes: `Confirmed by Sales from ${p.id} (${o.id}).${p.notes ? ` ${p.notes}` : ""}`, pricePerGuest: netPerGuest(p) }, linked);
      if (!fields.ok) return fail(fields.status, fields.error);
      let eventId = linked?.id ?? "";
      const out = save("confirmed", linked ? `Business confirmed; ${linked.id} updated` : "Business confirmed; event created", (y, x) => {
        if (linked) {
          // The event already exists: update it, keeping its history and staff.
          const e = x.events.find((z) => z.id === linked.id)!;
          const before = `${e.guests} guests, ${e.date}`;
          Object.assign(e, { guests: p.guests, date: p.date, start: p.start, end: p.end, venue: p.venue, format: p.format, services: p.services.map((sv) => serviceFor(sv, p.guests)), pricePerGuest: netPerGuest(p), proposalId: p.id, opportunityId: o.id, updatedAt: now() });
          e.history.push({ at: now(), by: user.id, action: "Updated from a confirmed sales proposal", detail: `${p.id}: was ${before}; now ${p.guests} guests, ${p.date}` });
        } else {
          const e = buildEvent(x, p.propertyId, { ...fields.fields, kitchenOutletId: EVENT_KITCHEN[p.propertyId], services: p.services.map((sv) => serviceFor(sv, p.guests)), ratios: { ...DEFAULT_RATIOS[p.format] }, opportunityId: o.id, proposalId: p.id }, user.id, { status: "planning", action: "Confirmed by Sales", detail: `${p.id} for ${o.customer}` });
          eventId = e.id;
        }
        y.eventId = eventId;
        const opp = x.sales.opps.find((z) => z.id === o.id)!;
        opp.status = "confirmed"; opp.eventId = eventId; opp.value = costProposal(p, o).price; opp.updatedAt = now();
        opp.history.push({ at: now(), by: user.id, action: `Confirmed from ${p.id}; event ${eventId}` });
      });
      return { ...out, eventId };
    }
    default:
      return fail(400, "Unknown action.");
  }
}

// ---- Performance ---------------------------------------------------------------------------------------------------

export interface SalesPerformance {
  currency: Currency;
  openCount: number;
  /** Expected value of open opportunities. Potential business, not revenue. */
  pipeline: number;
  awaitingDecision: number;
  awaitingValue: number;
  /** Price of business confirmed this month. Contract value, not recognised revenue or cash. */
  confirmedValue: number;
  confirmedCount: number;
  won: number;
  lost: number;
}

export function salesPerformance(user: User, propertyId: string): Result<{ performance: SalesPerformance }> {
  if (!can(user, "sales.view")) return fail(403, "Your role cannot open sales records.");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const s = loadStore();
  const opps = s.sales.opps.filter((o) => o.propertyId === propertyId);
  const open = opps.filter((o) => OPEN_OPP.includes(o.status));
  const sent = s.sales.proposals.filter((p) => p.propertyId === propertyId && p.status === "sent");
  const month = (d: string) => d >= "2026-10-01" && d <= "2026-10-31";
  const confirmedNow = s.sales.proposals.filter((p) => p.propertyId === propertyId && p.status === "confirmed" && month(p.updatedAt.slice(0, 10) > DEMO_TODAY ? DEMO_TODAY : p.updatedAt.slice(0, 10)));
  const confirmedSeed = opps.filter((o) => o.status === "confirmed" && !s.sales.proposals.some((p) => p.oppId === o.id && p.status === "confirmed"));
  const priceOf = (p: Proposal) => costProposal(p, opps.find((o) => o.id === p.oppId)!).price;
  return {
    ok: true,
    performance: {
      currency: propertyById[propertyId].currency, openCount: open.length, pipeline: open.reduce((t, o) => t + o.value, 0),
      awaitingDecision: sent.length, awaitingValue: r2(sent.reduce((t, p) => t + priceOf(p), 0)),
      confirmedValue: r2(confirmedNow.reduce((t, p) => t + priceOf(p), 0) + confirmedSeed.reduce((t, o) => t + o.value, 0)), confirmedCount: confirmedNow.length + confirmedSeed.length,
      won: opps.filter((o) => o.status === "confirmed").length, lost: opps.filter((o) => o.status === "lost").length,
    },
  };
}

export function salesAlerts(user: User): { id: string; text: string; href: string; action: string }[] {
  if (!can(user, "sales.view")) return [];
  const s = loadStore();
  const props = allowedProperties(user);
  const out: { id: string; text: string; href: string; action: string }[] = [];
  if (can(user, "sales.approve")) {
    for (const p of s.sales.proposals.filter((x) => x.status === "discount_pending" && props.includes(x.propertyId) && x.createdBy !== user.id)) {
      const o = s.sales.opps.find((x) => x.id === p.oppId)!;
      out.push({ id: `disc-${p.id}-${p.updatedAt}`, text: `${o.customer}: a ${p.discountPct}% discount needs your approval.`, href: `/events?tab=proposals&opp=${o.id}`, action: "Review discount" });
    }
  }
  if (can(user, "sales.work")) {
    for (const p of s.sales.proposals.filter((x) => x.createdBy === user.id && x.status === "changes_requested").slice(0, 1)) out.push({ id: `chg-${p.id}-${p.updatedAt}`, text: `Changes requested on ${p.id}.`, href: `/events?tab=proposals&opp=${p.oppId}`, action: "Open" });
    const due = s.sales.opps.filter((o) => o.ownerId === user.id && OPEN_OPP.includes(o.status) && o.nextActionDue && o.nextActionDue <= DEMO_TODAY);
    if (due.length) out.push({ id: `due-${due.map((o) => o.id).join(",")}`, text: `${due.length} opportunit${due.length === 1 ? "y has" : "ies have"} a next action due today.`, href: "/events?tab=opportunities", action: "View" });
  }
  return out;
}

/** The owner's one line: business confirmed this month, by hotel, as contract value. */
export function confirmedSummary(user: User): { propertyId: string; currency: Currency; value: number; count: number }[] {
  if (!can(user, "sales.view")) return [];
  return allowedProperties(user).map((p) => {
    const r = salesPerformance(user, p);
    return r.ok ? { propertyId: p, currency: r.performance.currency, value: r.performance.confirmedValue, count: r.performance.confirmedCount } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
}
