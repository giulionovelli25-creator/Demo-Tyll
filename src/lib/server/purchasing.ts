// What to buy, what to prep, and the approval workflow. Forecasts run on complete data so a shared storeroom counts every
// outlet's use; each user receives only their own outlets' dish detail and the requests they are entitled to see.
import { INGREDIENTS, STAFF, USERS, ingredientById, itemById, outletById, outletsOfProperty, storeOwner, userById } from "../data/catalog";
import { getDataset } from "../data/generate";
import { APPROVAL_POLICY, approvalSteps, quotesFor } from "../data/purchasing-rules";
import { budgetForRequest, deptOfRequest } from "./finance";
import { allowedOutlets, allowedProperties, can, hasWholeProperty } from "../domain/access";
import {
  baselineFor, buyLines, demandFor, ingredientsFor, mealShares, needByDay, periodOf,
  type Assumptions, type Baseline, type BuyLine, type Meal, type Period, type PeriodKind, type Source,
} from "../domain/planning";
import { eventPortions, eventStoreNeed, isCommitted } from "../domain/events";
import type { EventRecord, PrepPlan, PrepTask, PurchaseRequest, RequestLine, RequestStatus, User } from "../types";
import { DEMO_TODAY, addDays, eachDay, sum } from "../util";
import { loadStore, mutateStore } from "./purchasing-store";
import { stockFor, type SessionEntries } from "./stock";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const now = () => new Date().toISOString();

// ---- Scope ---------------------------------------------------------------------------------------------------------

/** The outlets a plan covers: those asked for that the user may see, or all of the user's outlets at the hotel. */
function scopeOutlets(user: User, propertyId: string, asked?: unknown): string[] | null {
  if (!allowedProperties(user).includes(propertyId)) return null;
  const mine = allowedOutlets(user).filter((o) => outletById[o].propertyId === propertyId);
  const want = Array.isArray(asked) ? asked.filter((x): x is string => typeof x === "string") : [];
  const picked = want.length ? want.filter((o) => mine.includes(o)) : mine;
  if (want.length && picked.length !== want.length) return null;
  return picked.length ? picked : null;
}

export function readPeriod(body: { period?: unknown; from?: unknown; to?: unknown }): Period {
  const kind = (["tomorrow", "3", "7", "custom"] as const).find((k) => k === body.period) ?? "tomorrow";
  const custom = typeof body.from === "string" && typeof body.to === "string" && ISO.test(body.from) && ISO.test(body.to) ? { from: body.from, to: body.to } : undefined;
  return periodOf(kind as PeriodKind, custom);
}

/** Manager's figures replace Tyll's where given and valid; each is marked with where it came from. */
function readAssumptions(raw: unknown, base: Baseline): { values: Assumptions; sources: Record<keyof Assumptions, Source> } {
  const r = (raw ?? {}) as Partial<Record<keyof Assumptions, unknown>>;
  const values = { ...base.values };
  const sources = { ...base.sources };
  const take = (k: keyof Assumptions, lo: number, hi: number) => {
    if (num(r[k], lo, hi) && Math.abs((r[k] as number) - base.values[k]) > 1e-9) {
      values[k] = k === "occupancy" || k === "safetyDays" ? (r[k] as number) : Math.round(r[k] as number);
      sources[k] = "manual";
    }
  };
  take("reservations", 0, 20000);
  take("walkIns", 0, 50000);
  take("occupancy", 0, 1);
  take("eventGuests", 0, 20000);
  take("safetyDays", 0, 3);
  return { values, sources };
}

// ---- What to buy ---------------------------------------------------------------------------------------------------

export interface BuyPlanOut {
  propertyId: string;
  outletIds: string[];
  period: Period;
  baseline: Baseline;
  assumptions: Assumptions;
  sources: Record<keyof Assumptions, Source>;
  guests: { reservations: number; walkIns: number; eventGuests: number };
  lines: BuyLine[];
  /** Set when the plan carries a kitchen prep plan's portions. */
  prepPlanId?: string;
  /** Set when the plan buys for one event. */
  eventId?: string;
  sharedNote?: string;
}

/** Stock still to arrive: supplier deliveries already booked, and approved requests not yet received. */
function arrivalsFor(propertyId: string, period: Period) {
  const out = new Map<string, Map<string, number>>();
  const add = (g: string, date: string, q: number) => {
    let m = out.get(g);
    if (!m) out.set(g, (m = new Map()));
    m.set(date, (m.get(date) ?? 0) + q);
  };
  for (const d of getDataset().deliveries) {
    if (d.propertyId !== propertyId || d.status !== "expected" || d.date > period.to) continue;
    for (const l of d.lines) add(l.ingredientId, d.date < period.from ? period.from : d.date, l.ordered);
  }
  for (const r of loadStore().requests) {
    if (r.propertyId !== propertyId || r.status !== "approved") continue;
    // An event's order is counted for that event as already on order, not as storeroom stock.
    if (r.eventId) continue;
    for (const l of r.lines) {
      const arrive = addDays(DEMO_TODAY, ingredientById[l.ingredientId].leadDays);
      if (arrive <= period.to) add(l.ingredientId, arrive < period.from ? period.from : arrive, l.qty);
    }
  }
  return out;
}

/** Quantities on requests still going through approval, so the same need is not requested twice. */
function openRequested(propertyId: string, outletIds: string[], exceptId?: string, eventId?: string) {
  const out = new Map<string, number>();
  for (const r of loadStore().requests) {
    // For an event, approved orders not yet received are also on order for it.
    const open = eventId ? ["purchasing", "accounting", "manager", "approved"] : ["purchasing", "accounting", "manager"];
    if (r.id === exceptId || r.propertyId !== propertyId || !open.includes(r.status)) continue;
    // An event's requests count only for that event; an outlet's only for its outlets.
    if (eventId ? r.eventId !== eventId : r.eventId || !r.outletIds.some((o) => outletIds.includes(o))) continue;
    for (const l of r.lines) out.set(l.ingredientId, (out.get(l.ingredientId) ?? 0) + l.qty);
  }
  return out;
}

export function buyPlan(user: User, body: Record<string, unknown>, entries: SessionEntries): Result<{ plan: BuyPlanOut }> {
  if (!can(user, "purchase.create")) return fail(403, "Your role cannot plan purchases.");
  return computeBuyPlan(user, body, entries);
}

/** The calculation behind What to buy, also used by What to prep for stock availability. Access is checked by outlet. */
function computeBuyPlan(user: User, body: Record<string, unknown>, entries: SessionEntries): Result<{ plan: BuyPlanOut }> {
  const propertyId = String(body.propertyId ?? "");
  // Event mode: buying for one event, after the outlets' own forecast use.
  const eventId = typeof body.eventId === "string" ? body.eventId : undefined;
  const event = eventId ? loadStore().events.find((e) => e.id === eventId) : undefined;
  if (eventId && (!event || event.propertyId !== propertyId || !allowedProperties(user).includes(propertyId) || !(can(user, "events.plan") || can(user, "purchase.create")))) return fail(404, "This event is not available.");
  const outletIds = event ? [] : scopeOutlets(user, propertyId, body.outletIds);
  if (!outletIds) return fail(403, "This outlet is outside your access.");
  const period = event ? { from: event.date, to: event.date } : readPeriod(body);
  const data = planningData();
  const allOutlets = outletsOfProperty(propertyId).map((o) => o.id);
  const baseline = baselineFor(data, outletIds.length ? outletIds : allOutlets, period);
  const { values, sources } = readAssumptions(body.assumptions, baseline);
  const demand = demandFor(data, outletIds.length ? outletIds : allOutlets, period, values, baseline);
  const mine = event ? eventNeedByDay([event], period, entries) : needByDay(demand, outletIds, entries.recipes);

  // A saved prep plan replaces the forecast for its dishes, outlet and days.
  let prepPlanId: string | undefined;
  if (!event && typeof body.prepPlanId === "string") {
    const plan = loadStore().plans.find((p) => p.id === body.prepPlanId);
    if (plan && outletIds.includes(plan.outletId)) {
      prepPlanId = plan.id;
      const delta = prepDelta(plan, entries);
      for (const [g, byDate] of delta) {
        const row = mine.get(g) ?? demand.days.map(() => 0);
        for (const [date, q] of byDate) {
          const i = demand.days.indexOf(date);
          if (i >= 0) row[i] = Math.max(0, row[i] + q);
        }
        mine.set(g, row);
      }
    }
  }

  // Other outlets drawing on the same storeroom, at Tyll's own figures, and every other committed event. Only totals are used.
  const others = allOutlets.filter((o) => !outletIds.includes(o));
  const othersNeed = others.length ? needByDay(demandFor(data, others, period, baselineFor(data, others, period).values, baselineFor(data, others, period)), others, entries.recipes) : new Map<string, number[]>();
  const otherEvents = loadStore().events.filter((e) => isCommitted(e) && e.propertyId === propertyId && e.id !== event?.id);
  for (const [g, row] of eventNeedByDay(otherEvents, period, entries)) {
    const cur = othersNeed.get(g) ?? row.map(() => 0);
    othersNeed.set(g, cur.map((v, i) => v + row[i]));
  }

  const lines = buyLines({
    propertyId, period, mine, others: othersNeed,
    stock: stockFor(user, propertyId, entries),
    arrivals: arrivalsFor(propertyId, period),
    requested: openRequested(propertyId, outletIds, undefined, event?.id),
    safetyDays: event ? 0 : values.safetyDays,
    mineOutlets: outletIds,
  });
  const reservedFor = [others.length && `${others.length} outlet${others.length === 1 ? "" : "s"}`, otherEvents.some((e) => e.date >= period.from && e.date <= period.to) && "confirmed events"].filter(Boolean).join(" and ");
  return {
    ok: true,
    plan: {
      propertyId, outletIds, period, baseline, assumptions: values, sources, guests: demand.guests, lines, prepPlanId, eventId: event?.id,
      sharedNote: reservedFor ? `Shared stock is first reserved for the forecast use of ${reservedFor} at this hotel. Their sales are not shown.` : undefined,
    },
  };
}

/** Lines to buy for one event. Empty when the user cannot see the event's purchasing. */
export function buyPlanForEvent(user: User, e: EventRecord, entries: SessionEntries): BuyLine[] {
  const r = computeBuyPlan(user, { propertyId: e.propertyId, eventId: e.id }, entries);
  return r.ok ? r.plan.lines : [];
}

/** What events still need from the storeroom, by ingredient and day. Stock already issued to an event is not counted again. */
function eventNeedByDay(events: readonly EventRecord[], period: Period, entries: SessionEntries): Map<string, number[]> {
  const days = eachDay(period);
  const out = new Map<string, number[]>();
  for (const e of events) {
    const i = days.indexOf(e.date);
    if (i < 0) continue;
    for (const [g, q] of eventStoreNeed(e, entries.recipes)) {
      const row = out.get(g) ?? days.map(() => 0);
      row[i] += q;
      out.set(g, row);
    }
  }
  return out;
}

/** The dataset with events as they stand now: committed events only, at their current guest numbers. Drafts count for nothing. */
let planningCache: { key: string; data: ReturnType<typeof getDataset> } | null = null;
function planningData() {
  const d = getDataset();
  const events = loadStore().events.filter(isCommitted).map((e) => ({ id: e.id, propertyId: e.propertyId, date: e.date, name: e.name, attendance: e.guests }));
  const key = JSON.stringify(events);
  if (!planningCache || planningCache.key !== key) planningCache = { key, data: { ...d, events } };
  return planningCache.data;
}

/** How much a prep plan changes ingredient use against the forecast for the same dishes and days. */
function prepDelta(plan: PrepPlan, entries: SessionEntries): Map<string, Map<string, number>> {
  const forecast = prepForecast(plan.outletId, plan.period, plan.meal);
  const out = new Map<string, Map<string, number>>();
  for (const itemId of new Set([...Object.keys(plan.portions), ...Object.keys(forecast.totals)])) {
    const planned = plan.portions[itemId] ?? 0;
    const expected = forecast.totals[itemId] ?? 0;
    const diff = planned - expected;
    if (Math.abs(diff) < 1e-9) continue;
    const days = eachDay(plan.period);
    const weights = days.map((d) => forecast.byDay[itemId]?.[d] ?? 0);
    const total = sum(weights, (w) => w);
    days.forEach((date, i) => {
      const share = total > 0 ? weights[i] / total : 1 / days.length;
      for (const [g, q] of ingredientsFor([{ itemId, date, units: diff * share }], entries.recipes)) {
        let m = out.get(g);
        if (!m) out.set(g, (m = new Map()));
        m.set(date, (m.get(date) ?? 0) + q);
      }
    });
  }
  return out;
}

// ---- What to prep --------------------------------------------------------------------------------------------------

/** Expected portions by dish for one outlet, period and meal, at Tyll's own figures. */
function prepForecast(outletId: string, period: Period, meal: Meal, assumptions?: Assumptions) {
  const data = planningData();
  const base = baselineFor(data, [outletId], period);
  const demand = demandFor(data, [outletId], period, assumptions ?? base.values, base);
  const shares = meal === "all" ? null : mealShares(data.orders, outletId);
  const totals: Record<string, number> = {};
  const byDay: Record<string, Record<string, number>> = {};
  for (const [k, units] of demand.units) {
    const [, date, itemId] = k.split("|");
    if (itemById[itemId].dept !== "food") continue;
    const u = shares ? units * (shares.get(itemId)?.[meal as Exclude<Meal, "all">] ?? 0) : units;
    if (u <= 0) continue;
    totals[itemId] = (totals[itemId] ?? 0) + u;
    (byDay[itemId] ??= {})[date] = u;
  }
  return { totals, byDay, base, demand };
}

export interface PrepOut {
  outletId: string;
  period: Period;
  meal: Meal;
  baseline: Baseline;
  assumptions: Assumptions;
  sources: Record<keyof Assumptions, Source>;
  /** Suggested portions, rounded up, by dish. */
  suggested: Record<string, number>;
  /** Stock this outlet can use for the period, after other outlets' reservations, plus confirmed arrivals. */
  available: Record<string, number>;
  /** Portions of other meals and drinks over the same period also draw on stock. */
  otherUse: Record<string, number>;
  plan: PrepPlan | null;
  meals: Meal[];
  /** Committed events this kitchen prepares in the period. Their ingredients are reserved separately, not in "available". */
  events: { id: string; name: string; date: string; guests: number; dishes: { itemId: string; portions: number; calculated: number }[] }[];
}

export function prepPlanFor(user: User, body: Record<string, unknown>, entries: SessionEntries): Result<{ prep: PrepOut }> {
  if (!can(user, "prep.plan") && !can(user, "prep.complete")) return fail(403, "Your role cannot open preparation plans.");
  const outletId = String(body.outletId ?? "");
  if (!outletById[outletId] || !allowedOutlets(user).includes(outletId)) return fail(403, "This outlet is outside your access.");
  const period = readPeriod(body);
  const meal = (["all", "breakfast", "lunch", "dinner"] as const).find((m) => m === body.meal) ?? "all";
  const data = planningData();
  const base = baselineFor(data, [outletId], period);
  const { values, sources } = readAssumptions(body.assumptions, base);
  const f = prepForecast(outletId, period, meal, values);
  const suggested = Object.fromEntries(Object.entries(f.totals).map(([k, v]) => [k, Math.ceil(v - 1e-6)]));

  // Availability comes from the same purchasing calculation, so prep and buy agree on what is in stock.
  const propertyId = outletById[outletId].propertyId;
  const buy = computeBuyPlan(user, { propertyId, outletIds: [outletId], period: "custom", from: period.from, to: period.to }, entries);
  const available: Record<string, number> = {};
  if (buy.ok) for (const l of buy.plan.lines) available[l.ingredientId] = Math.max(0, l.available + l.incoming + l.requested);
  // Stock rows for items this outlet uses but has no forecast line for still count as available.
  for (const s of stockFor(user, propertyId, entries)) if (!(s.ingredientId in available)) available[s.ingredientId] = Math.max(0, s.estimated);
  // Everything else this outlet will serve in the period (other meals, drinks) also uses stock.
  const all = needByDay(demandFor(data, [outletId], period, values, base), [outletId], entries.recipes);
  const planned = ingredientsFor(Object.entries(f.totals).flatMap(([itemId, u]) => [{ itemId, date: period.from, units: u }]), entries.recipes);
  const otherUse: Record<string, number> = {};
  for (const [g, row] of all) otherUse[g] = Math.max(0, sum(row, (x) => x) - (planned.get(g) ?? 0));

  const plan = loadStore().plans.find((p) => p.outletId === outletId && p.period.from === period.from && p.period.to === period.to && p.meal === meal) ?? null;
  const shares = mealShares(data.orders, outletId);
  const meals = (["breakfast", "lunch", "dinner"] as const).filter((m) => [...shares.values()].some((s) => s[m] > 0.05));
  const events = kitchenEvents(outletId, period).map((e) => ({
    id: e.id, name: e.name, date: e.date, guests: e.guests,
    dishes: eventPortions(e).filter((p) => itemById[p.itemId].dept === "food").map((p) => ({ itemId: p.itemId, portions: p.portions, calculated: p.calculated })),
  }));
  return { ok: true, prep: { outletId, period, meal, baseline: base, assumptions: values, sources, suggested, available, otherUse, plan, meals: ["all", ...meals], events } };
}

/** Committed events a kitchen prepares within a period. */
const kitchenEvents = (outletId: string, period: Period) => loadStore().events.filter((e) => isCommitted(e) && e.kitchenOutletId === outletId && e.date >= period.from && e.date <= period.to);

const planId = (outletId: string, period: Period, meal: Meal) => `PP-${outletById[outletId].code}-${period.from.slice(5).replace("-", "")}-${eachDay(period).length}D-${meal.toUpperCase()}`;

export function savePrepPlan(user: User, body: Record<string, unknown>): Result<{ plan: PrepPlan }> {
  if (!can(user, "prep.plan")) return fail(403, "Your role cannot change preparation plans.");
  const outletId = String(body.outletId ?? "");
  if (!outletById[outletId] || !allowedOutlets(user).includes(outletId)) return fail(403, "This outlet is outside your access.");
  const period = readPeriod(body);
  const meal = (["all", "breakfast", "lunch", "dinner"] as const).find((m) => m === body.meal) ?? "all";
  const raw = (body.portions ?? {}) as Record<string, unknown>;
  const menu = new Set(outletById[outletId].menu.map((m) => m.itemId));
  const portions: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!menu.has(k) || itemById[k].dept !== "food") continue;
    if (!num(v, 0, 5000)) return fail(400, `Enter a number of portions for ${itemById[k].name}.`);
    portions[k] = Math.round(v);
  }
  const sug = (body.suggested ?? {}) as Record<string, unknown>;
  const suggested = Object.fromEntries(Object.entries(sug).filter(([k, v]) => menu.has(k) && num(v, 0, 5000))) as Record<string, number>;
  const id = planId(outletId, period, meal);
  const plan = mutateStore((s) => {
    const old = s.plans.find((p) => p.id === id);
    // A task keeps its assignee and completion if its portions did not change.
    const tasks: PrepTask[] = Object.entries(portions).filter(([, n]) => n > 0).map(([itemId, n]) => {
      const was = old?.tasks.find((t) => t.itemId === itemId);
      return was && was.portions === n ? was : { id: `${id}-${itemId}`, itemId, portions: n, assigneeId: was?.assigneeId, done: false };
    });
    // Each event this kitchen prepares adds its own tasks, at the event's current portions.
    for (const e of kitchenEvents(outletId, period)) {
      for (const p of eventPortions(e).filter((x) => itemById[x.itemId].dept === "food" && x.portions > 0)) {
        const tid = `${id}-ev-${e.id}-${p.itemId}`;
        const was = old?.tasks.find((t) => t.id === tid);
        tasks.push(was && was.portions === p.portions ? was : { id: tid, itemId: p.itemId, portions: p.portions, eventId: e.id, assigneeId: was?.assigneeId, done: false });
      }
    }
    const next: PrepPlan = { id, propertyId: outletById[outletId].propertyId, outletId, period, meal, portions, suggested, tasks, createdBy: old?.createdBy ?? user.id, updatedAt: now(), updatedBy: user.id };
    s.plans = [...s.plans.filter((p) => p.id !== id), next];
    return next;
  });
  return { ok: true, plan };
}

/** People a prep task can be given to: kitchen staff of the outlet and accounts with access to it. */
export const prepAssignees = (outletId: string) => [
  ...USERS.filter((u) => (u.role === "employee" || u.role === "chef") && allowedOutlets(u).includes(outletId)).map((u) => ({ id: u.id, name: u.name })),
  ...STAFF.filter((s) => s.outletId === outletId && s.role === "chef").map((s) => ({ id: s.id, name: s.name })),
];

export function updatePrepTask(user: User, body: Record<string, unknown>): Result<{ plan: PrepPlan }> {
  const plan = loadStore().plans.find((p) => p.id === body.planId);
  if (!plan || !allowedOutlets(user).includes(plan.outletId)) return fail(404, "This plan is not available.");
  const task = plan.tasks.find((t) => t.id === body.taskId);
  if (!task) return fail(404, "This task is not on the plan.");
  if (body.op === "assign") {
    if (!can(user, "prep.plan")) return fail(403, "Your role cannot assign preparation tasks.");
    const who = String(body.assigneeId ?? "");
    if (who && !prepAssignees(plan.outletId).some((p) => p.id === who)) return fail(400, "Choose someone from this kitchen.");
  } else if (body.op === "complete") {
    if (!can(user, "prep.complete")) return fail(403, "Your role cannot tick off preparation tasks.");
    if (user.role === "employee" && task.assigneeId && task.assigneeId !== user.id) return fail(403, "This task is assigned to someone else.");
  } else return fail(400, "Unknown action.");
  const saved = mutateStore((s) => {
    const p = s.plans.find((x) => x.id === plan.id)!;
    const t = p.tasks.find((x) => x.id === task.id)!;
    if (body.op === "assign") t.assigneeId = String(body.assigneeId ?? "") || undefined;
    else {
      t.done = body.done !== false;
      t.doneBy = t.done ? user.id : undefined;
      t.doneAt = t.done ? now() : undefined;
    }
    p.updatedAt = now();
    p.updatedBy = user.id;
    return p;
  });
  return { ok: true, plan: saved };
}

export function plansFor(user: User): PrepPlan[] {
  const mine = new Set(allowedOutlets(user));
  if (!can(user, "prep.plan") && !can(user, "prep.complete")) return [];
  return loadStore().plans.filter((p) => mine.has(p.outletId));
}

// ---- Requests and approvals ----------------------------------------------------------------------------------------

export const requestTotal = (r: Pick<PurchaseRequest, "lines">) => Math.round(sum(r.lines, (l) => l.qty * l.unitPrice) * 100) / 100;

/** Who may see a request. Drafts are private to their author. */
export function canSee(user: User, r: PurchaseRequest): boolean {
  if (!allowedProperties(user).includes(r.propertyId)) return false;
  if (r.status === "draft") return r.createdBy === user.id;
  if (r.createdBy === user.id) return true;
  if (can(user, "purchase.review") || can(user, "purchase.approveFinance") || can(user, "purchase.approveManager")) return true;
  // Receiving staff see orders once approved, to record what arrives.
  if (can(user, "purchase.receive") && ["approved", "received"].includes(r.status)) return true;
  if (hasWholeProperty(user, r.propertyId) && can(user, "purchase.create")) return true;
  if (r.eventId && can(user, "events.plan")) return true;
  if (r.deptId && user.deptId === r.deptId) return true;
  if (!can(user, "purchase.create")) return false;
  const mine = allowedOutlets(user);
  return r.outletIds.some((o) => mine.includes(o));
}

export function requestsFor(user: User): PurchaseRequest[] {
  return loadStore().requests.filter((r) => canSee(user, r)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** The request's department budget, from the same records Finance uses. */
export function budgetFor(r: Pick<PurchaseRequest, "id" | "propertyId" | "deptId" | "eventId">) {
  return budgetForRequest(r.propertyId, deptOfRequest(r), r.id);
}

function readLines(user: User, propertyId: string, raw: unknown, forEvent = false): Result<{ lines: RequestLine[] }> {
  if (!Array.isArray(raw) || raw.length === 0) return fail(400, "Add at least one item.");
  if (raw.length > 80) return fail(400, "That is too many lines for one request.");
  const lines: RequestLine[] = [];
  for (const x of raw as Record<string, unknown>[]) {
    const g = ingredientById[String(x.ingredientId)];
    if (!g) return fail(400, "Unknown item on the request.");
    // An outlet's own store is bought for by that outlet. An event buys for itself; its delivery goes to the event.
    if (!forEvent && storeOwner(propertyId, g.id) && !allowedOutlets(user).includes(storeOwner(propertyId, g.id)!)) return fail(403, `${g.name} is held in another outlet's own store.`);
    if (!num(x.qty, 0, 100000)) return fail(400, `Enter a quantity for ${g.name}.`);
    const quotes = quotesFor(g.id, propertyId, DEMO_TODAY);
    const quote = quotes.find((q) => q.supplierId === x.supplierId) ?? quotes[0];
    const n = (v: unknown) => (num(v, -1e6, 1e6) ? Math.round(v * 1000) / 1000 : 0);
    lines.push({ ingredientId: g.id, qty: Math.round((x.qty as number) * 1000) / 1000, suggested: n(x.suggested), requirement: n(x.requirement), available: n(x.available), incoming: n(x.incoming), safety: n(x.safety), supplierId: quote.supplierId, unitPrice: quote.unitPrice });
  }
  if (new Set(lines.map((l) => l.ingredientId)).size !== lines.length) return fail(400, "Each item can appear once.");
  return { ok: true, lines };
}

/** Create a draft, or update one the author is still working on. */
export function saveRequest(user: User, body: Record<string, unknown>): Result<{ request: PurchaseRequest }> {
  if (!can(user, "purchase.create")) return fail(403, "Your role cannot create purchase requests.");
  const existing = typeof body.id === "string" ? loadStore().requests.find((r) => r.id === body.id) : undefined;
  if (body.id && !existing) return fail(404, "This request does not exist.");
  if (existing && (existing.createdBy !== user.id || !["draft", "changes"].includes(existing.status))) return fail(403, "Only the author can change a request, and only before it is submitted or when changes are requested.");
  const propertyId = existing?.propertyId ?? String(body.propertyId ?? "");
  // A request for an event buys for the event, not for an outlet.
  const eventId = existing?.eventId ?? (typeof body.eventId === "string" ? body.eventId : undefined);
  // A department such as Housekeeping buys supplies for itself, through the same workflow.
  const deptId = existing?.deptId ?? (typeof body.deptId === "string" ? body.deptId : undefined);
  if (deptId && (user.deptId !== deptId || !propertyId.length || !deptId.startsWith(`${propertyId}-`))) return fail(403, "You can only request supplies for your own department.");
  const event = eventId ? loadStore().events.find((e) => e.id === eventId && e.propertyId === propertyId) : undefined;
  if (eventId && (!event || !can(user, "events.plan") || !allowedProperties(user).includes(propertyId))) return fail(403, "This event is outside your access.");
  const outletIds = existing?.outletIds ?? (event || deptId ? [] : scopeOutlets(user, propertyId, body.outletIds));
  if (!outletIds) return fail(403, "This outlet is outside your access.");
  const read = readLines(user, propertyId, body.lines, !!eventId);
  if (!read.ok) return read;
  // One open request per shortage: the same department asking again for an item already on its way is sent to that request.
  if (deptId && !existing) {
    const open = loadStore().requests.find((r) => r.deptId === deptId && !["received", "rejected"].includes(r.status) && r.lines.some((l) => read.lines.some((n) => n.ingredientId === l.ingredientId)));
    if (open) return fail(409, `${open.id} already asks for this item (${open.status}). Open it instead of starting another.`);
  }
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 600) : existing?.comment;
  const period = existing?.period ?? (event ? { from: event.date, to: event.date } : readPeriod(body));
  const prepPlanId = typeof body.prepPlanId === "string" ? body.prepPlanId : existing?.prepPlanId;
  const request = mutateStore((s) => {
    if (existing) {
      const r = s.requests.find((x) => x.id === existing.id)!;
      r.lines = read.lines;
      r.comment = comment;
      r.updatedAt = now();
      r.history.push({ at: r.updatedAt, by: user.id, action: "Draft updated", status: r.status });
      return r;
    }
    s.seq += 1;
    const id = `PR-${propertyId.toUpperCase()}-${String(s.seq).padStart(4, "0")}`;
    const r: PurchaseRequest = { id, propertyId, outletIds, period, createdBy: user.id, createdAt: now(), updatedAt: now(), status: "draft", lines: read.lines, comment, prepPlanId, eventId, deptId, history: [{ at: now(), by: user.id, action: "Draft created", status: "draft" }] };
    s.requests.push(r);
    return r;
  });
  return { ok: true, request };
}

const nextAfter = (r: PurchaseRequest, stage: "purchasing" | "accounting" | "manager"): RequestStatus => {
  const steps = approvalSteps(r.propertyId, requestTotal(r));
  return (steps[steps.indexOf(stage) + 1] ?? "approved") as RequestStatus;
};

type Decision = "approve" | "changes" | "reject";

/** Every step of the workflow. Each checks the role, the stage and the user's access to the hotel. */
export function actOnRequest(user: User, id: string, body: Record<string, unknown>): Result<{ request: PurchaseRequest }> {
  const r = loadStore().requests.find((x) => x.id === id);
  if (!r || !canSee(user, r)) return fail(404, "This request is not available.");
  const action = String(body.action ?? "");
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 600) : "";
  const decision = (["approve", "changes", "reject"] as const).find((d) => d === body.decision) as Decision | undefined;

  const apply = (change: (x: PurchaseRequest, store: Parameters<Parameters<typeof mutateStore>[0]>[0]) => void, label: string, extra: Partial<PurchaseRequest["history"][number]> = {}) => {
    const request = mutateStore((s) => {
      const x = s.requests.find((y) => y.id === id)!;
      change(x, s);
      x.updatedAt = now();
      if (x.status === "approved" && !x.poNumber) x.poNumber = `PO-${x.id.slice(3)}`;
      x.history.push({ at: x.updatedAt, by: user.id, action: label, status: x.status, comment: comment || undefined, ...extra });
      return x;
    });
    return { ok: true as const, request };
  };
  const decide = (stage: "purchasing" | "accounting" | "manager", label: string) => {
    if (!decision) return fail(400, "Choose approve, request changes or reject.");
    if (decision !== "approve" && comment.length < 3) return fail(400, "Say what needs to change, or why it is rejected.");
    return apply((x) => { x.status = decision === "approve" ? nextAfter(x, stage) : decision === "changes" ? "changes" : "rejected"; },
      decision === "approve" ? `${label} approved` : decision === "changes" ? `${label}: changes requested` : `${label}: rejected`);
  };

  switch (action) {
    case "submit": {
      if (r.createdBy !== user.id || !can(user, "purchase.create")) return fail(403, "Only the author can submit this request.");
      if (!["draft", "changes"].includes(r.status)) return fail(409, "This request has already been submitted.");
      if (!r.lines.some((l) => l.qty > 0)) return fail(400, "Add a quantity to at least one item.");
      return apply((x) => { x.status = "purchasing"; }, r.status === "changes" ? "Resubmitted to purchasing" : "Submitted to purchasing");
    }
    case "purchasing": {
      if (!can(user, "purchase.review")) return fail(403, "Only purchasing can review this step.");
      if (r.status !== "purchasing") return fail(409, "This request is not waiting for purchasing.");
      // Purchasing may change quantities and suppliers, each with a reason.
      const raw = Array.isArray(body.changes) ? (body.changes as Record<string, unknown>[]) : [];
      const changes: { ingredientId: string; from: number; to: number; reason: string }[] = [];
      const lines = r.lines.map((l) => ({ ...l }));
      for (const c of raw) {
        const line = lines.find((l) => l.ingredientId === c.ingredientId);
        if (!line) return fail(400, "That item is not on the request.");
        const reason = typeof c.reason === "string" ? c.reason.trim() : "";
        if (num(c.qty, 0, 100000) && Math.abs(c.qty - line.qty) > 1e-9) {
          if (reason.length < 3) return fail(400, `Give a reason for changing ${ingredientById[line.ingredientId].name}.`);
          changes.push({ ingredientId: line.ingredientId, from: line.qty, to: c.qty, reason });
          line.qty = Math.round(c.qty * 1000) / 1000;
        }
        if (typeof c.supplierId === "string" && c.supplierId !== line.supplierId) {
          const q = quotesFor(line.ingredientId, r.propertyId, DEMO_TODAY).find((x) => x.supplierId === c.supplierId);
          if (!q) return fail(400, "That supplier does not quote for this item.");
          if (reason.length < 3) return fail(400, `Give a reason for changing the supplier of ${ingredientById[line.ingredientId].name}.`);
          line.supplierId = q.supplierId;
          line.unitPrice = q.unitPrice;
          changes.push({ ingredientId: line.ingredientId, from: line.qty, to: line.qty, reason: `Supplier changed to ${q.name}. ${reason}` });
        }
      }
      if (decision === "approve" && !lines.some((l) => l.qty > 0)) return fail(400, "Nothing left to order.");
      if (!decision) return fail(400, "Choose approve, request changes or reject.");
      if (decision !== "approve" && comment.length < 3) return fail(400, "Say what needs to change, or why it is rejected.");
      return apply((x) => {
        x.lines = lines;
        x.status = decision === "approve" ? nextAfter(x, "purchasing") : decision === "changes" ? "changes" : "rejected";
      }, decision === "approve" ? "Purchasing review approved" : decision === "changes" ? "Purchasing: changes requested" : "Purchasing: rejected", { changes: changes.length ? changes : undefined });
    }
    case "accounting": {
      if (!can(user, "purchase.approveFinance")) return fail(403, "Only accounting can approve the spend.");
      if (r.status !== "accounting") return fail(409, "This request is not waiting for accounting.");
      if (r.createdBy === user.id) return fail(403, "You cannot approve your own request.");
      return decide("accounting", "Accounting review");
    }
    case "manager": {
      if (!can(user, "purchase.approveManager")) return fail(403, `Only a ${APPROVAL_POLICY[r.propertyId].managerLabel.toLowerCase()} can give this approval.`);
      if (r.status !== "manager") return fail(409, "This request is not waiting for a manager's approval.");
      if (r.createdBy === user.id) return fail(403, "You cannot approve your own request.");
      return decide("manager", APPROVAL_POLICY[r.propertyId].managerLabel);
    }
    case "receive": {
      const mayReceive = can(user, "purchase.receive") || (can(user, "stock.count") && r.outletIds.some((o) => allowedOutlets(user).includes(o)));
      if (!mayReceive) return fail(403, "Your role cannot record deliveries.");
      if (r.status !== "approved") return fail(409, "Only an approved order can be received.");
      const raw = Array.isArray(body.received) ? (body.received as Record<string, unknown>[]) : [];
      const received = new Map(raw.filter((x) => num(x.qty, 0, 100000)).map((x) => [String(x.ingredientId), x.qty as number]));
      return apply((x, store) => {
        x.lines = x.lines.map((l) => ({ ...l, received: received.has(l.ingredientId) ? received.get(l.ingredientId)! : l.qty }));
        x.status = "received";
        // Bought for an event: the delivery is issued straight to it, so it is not also counted as storeroom stock.
        const ev = x.eventId ? store.events.find((e) => e.id === x.eventId) : undefined;
        if (ev) for (const l of x.lines) if ((l.received ?? 0) > 0) ev.issued.push({ ingredientId: l.ingredientId, qty: l.received!, ref: `${x.poNumber ?? x.id}, received` });
      }, "Delivery received", { changes: r.lines.filter((l) => received.has(l.ingredientId) && Math.abs(received.get(l.ingredientId)! - l.qty) > 1e-9).map((l) => ({ ingredientId: l.ingredientId, from: l.qty, to: received.get(l.ingredientId)!, reason: "Received quantity" })) });
    }
    case "comment": {
      if (comment.length < 2) return fail(400, "Write a comment first.");
      return apply(() => undefined, "Comment");
    }
    default:
      return fail(400, "Unknown action.");
  }
}

// ---- Alerts --------------------------------------------------------------------------------------------------------

export interface PlanAlert {
  id: string;
  text: string;
  href: string;
  action: string;
}

/** The most useful thing for this user to look at, at most two. */
export function alertsFor(user: User, entries: SessionEntries): PlanAlert[] {
  const out: PlanAlert[] = [];
  const visible = requestsFor(user);
  const waiting = (status: RequestStatus) => visible.filter((r) => r.status === status);
  if (can(user, "purchase.approveFinance") && waiting("accounting").length) {
    const n = waiting("accounting").length;
    out.push({ id: `acc-${waiting("accounting").map((r) => r.id).join(",")}`, text: `${n === 1 ? "One purchasing request is" : `${n} purchasing requests are`} awaiting your approval.`, href: n === 1 ? `/forecast?tab=approvals&request=${waiting("accounting")[0].id}` : "/forecast?tab=approvals&queue=accounting", action: "Review" });
  }
  if (can(user, "purchase.review") && waiting("purchasing").length) {
    const n = waiting("purchasing").length;
    out.push({ id: `buy-${waiting("purchasing").map((r) => r.id).join(",")}`, text: `${n === 1 ? "One request is" : `${n} requests are`} waiting for purchasing review.`, href: n === 1 ? `/forecast?tab=approvals&request=${waiting("purchasing")[0].id}` : "/forecast?tab=approvals&queue=purchasing", action: "Review" });
  }
  if (can(user, "purchase.approveManager") && waiting("manager").length) {
    out.push({ id: `mgr-${waiting("manager").map((r) => r.id).join(",")}`, text: `${waiting("manager").length === 1 ? "One purchase request needs" : `${waiting("manager").length} purchase requests need`} your approval.`, href: "/forecast?tab=approvals&queue=manager", action: "Review" });
  }
  // A request over the remaining demo budget.
  for (const r of visible.filter((x) => ["accounting", "manager"].includes(x.status))) {
    const b = budgetFor(r);
    if (requestTotal(r) > b.available && (can(user, "purchase.approveFinance") || can(user, "purchase.approveManager"))) {
      out.push({ id: `budget-${r.id}`, text: `${r.id} would take ${outletLabelFor(r)} over this month's demo purchasing budget.`, href: `/forecast?tab=approvals&request=${r.id}`, action: "Review" });
      break;
    }
  }
  // The author hears back when a request moves on.
  for (const r of visible.filter((x) => x.createdBy === user.id && ["approved", "rejected", "changes"].includes(x.status))) {
    const word = { approved: "was approved", rejected: "was rejected", changes: "needs changes" }[r.status as "approved" | "rejected" | "changes"];
    out.push({ id: `mine-${r.id}-${r.status}`, text: `Your purchase request ${r.id} ${word}.`, href: `/forecast?tab=approvals&request=${r.id}`, action: "Open" });
  }
  // Tomorrow's biggest shortage for a manager's outlets.
  if (can(user, "purchase.create") && user.role !== "chef") {
    const propertyId = allowedProperties(user)[0];
    const plan = buyPlan(user, { propertyId, period: "tomorrow" }, entries);
    const top = plan.ok ? plan.plan.lines.find((l) => l.risk === "high") : undefined;
    if (plan.ok && top) {
      const where = plan.plan.outletIds.length === 1 ? outletById[plan.plan.outletIds[0]].name : "your outlets";
      const qty = top.unit === "units" ? `${Math.ceil(top.suggested)} more units` : `an additional ${Math.round(top.suggested * 10) / 10} ${top.unit}`;
      out.push({ id: `short-${top.ingredientId}-${DEMO_TODAY}`, text: `Tomorrow's expected demand at ${where} requires ${qty} of ${ingredientById[top.ingredientId].name.toLowerCase()}. Review the suggested purchase.`, href: `/forecast?tab=buy&focus=${top.ingredientId}`, action: "Review purchase" });
    }
  }
  if (can(user, "prep.plan") && (user.role === "chef" || user.role === "restaurant_manager")) {
    const outletId = allowedOutlets(user)[0];
    const from = addDays(DEMO_TODAY, 1);
    const plan = loadStore().plans.find((p) => p.outletId === outletId && p.period.from === from);
    out.push(plan
      ? { id: `prep-${plan.id}-${plan.tasks.filter((t) => !t.done).length}`, text: `${plan.tasks.filter((t) => !t.done).length} preparation tasks for tomorrow are still open.`, href: "/forecast?tab=prep", action: "Open the plan" }
      : { id: `prep-new-${from}`, text: "Tomorrow's preparation plan is ready for review.", href: "/forecast?tab=prep", action: "Review the plan" });
  }
  return out;
}

const outletLabelFor = (r: PurchaseRequest) => (r.outletIds.length === 1 ? outletById[r.outletIds[0]].name : "the hotel");
export const userName = (id: string) => userById[id]?.name ?? id;
export const ingredientIds = () => INGREDIENTS.map((g) => g.id);
