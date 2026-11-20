// Drinks per guest by waiter, server side. The comparison (src/lib/domain/waiters.ts) runs here on the POS bills of the
// outlets the person holds. Names follow the Over pouring rule, tightened: only the roles that coach the team
// ("waiters.coach") see who is who. Everyone else gets "Server 1", "Server 2" and no POS login, stripped on the server.
// Coaching notes are shared records in the demo store, recorded with the person and role that made them.
import { STAFF, outletById, staffById } from "../data/catalog";
import { getDataset } from "../data/generate";
import { allowedOutlets, can, canOpen } from "../domain/access";
import { SHIFTS, type Shift } from "../domain/pour";
import { WAITER_RULES, compareWaiters, noDrinkTables, teamByDay, waiterOutlet, type NoDrinkTable, type OutletShift, type WaiterRow } from "../domain/waiters";
import type { CoachingOutcome, Staff, User, WaiterCoaching } from "../types";
import { DEMO_TODAY, addDays, eachDay } from "../util";
import { audit } from "./auth";
import { loadStore, mutateStore, nextNumber, type Shape } from "./purchasing-store";

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

/** What a manager did, in the words shown on screen. */
export const COACHING_LABEL: Record<CoachingOutcome, string> = {
  coached: "Coached on suggesting drinks",
  bar_check: "Asked the bar to check drinks against bills",
  no_change: "Talked it through, nothing to change",
};
const OUTCOMES = Object.keys(COACHING_LABEL) as CoachingOutcome[];

export type WaiterDays = 7 | 30;

export interface CoachingOut {
  id: string;
  date: string;
  outcome: CoachingOutcome;
  note?: string;
  by: string;
  shift: Shift;
  rate: number | null;
  peerRate: number | null;
  days: number;
}

export interface WaiterOut extends Omit<WaiterRow, "staffId"> {
  /** The POS login for roles that may see names; an anonymous key otherwise. */
  key: string;
  /** The person's name, or "Server 1", "Bartender" and so on. */
  name: string;
  role: Staff["role"];
  coaching?: CoachingOut;
  /** Tables with food billed and no drink in the period, largest estimate first. */
  tables: NoDrinkTable[];
}

export interface OutletOut {
  outletId: string;
  bills: number;
  guests: number;
  drinks: number;
  rate: number;
  foodTables: number;
  noDrink: number;
  drinkPrice: number;
  shifts: OutletShift[];
  waiters: WaiterOut[];
  /** The same figures for the period before, for the comparison. */
  before: { guests: number; drinks: number; rate: number | null; foodTables: number; noDrink: number };
}

export interface WaitersView {
  from: string;
  to: string;
  days: WaiterDays;
  mayName: boolean;
  mayCoach: boolean;
  rules: typeof WAITER_RULES;
  outlets: OutletOut[];
  /** The outlets in view together, the last 30 days whatever the period, for the trend. */
  trend: { date: string; guests: number; drinks: number; rate: number | null; noDrinkShare: number | null }[];
  outcomes: { value: CoachingOutcome; label: string }[];
  /** Outlets asked for and left out, such as Banquets and Events. */
  left: string[];
}

/** A comma list from the query. Absent means "everything you hold"; present but empty means none. */
const list = (v: string | null | undefined) => (v === null || v === undefined ? null : v.split(",").map((x) => x.trim()).filter(Boolean));

/** Names only for the roles that coach the team, and never for staff. Over pouring names managers who see cases. */
export const mayNameWaiters = (user: User) => can(user, "waiters.coach") && canOpen(user, "investigations") && user.role !== "employee";

const ROLE_WORD: Record<Staff["role"], string> = { server: "Server", bartender: "Bartender", supervisor: "Supervisor", manager: "Manager", chef: "Chef", steward: "Steward" };

/** The latest coaching note per waiter at one outlet. */
function latestCoaching(outletId: string, s: Shape): Map<string, WaiterCoaching> {
  const out = new Map<string, WaiterCoaching>();
  for (const c of s.waiterCoaching ?? []) if (c.outletId === outletId) out.set(c.staffId, c);
  return out;
}

const coachingOut = (c: WaiterCoaching): CoachingOut => ({ id: c.id, date: c.date, outcome: c.outcome, ...(c.note ? { note: c.note } : {}), by: c.by, shift: c.shift, rate: c.rate, peerRate: c.peerRate, days: c.days });

export function waitersFor(user: User, q: { days?: string | null; outlets?: string | null }): Result<WaitersView> {
  if (!can(user, "waiters.view") || !canOpen(user, "money")) return fail(403, "Your role cannot see drinks per guest by waiter.");
  const days: WaiterDays = q.days === "7" ? 7 : 30;
  const to = DEMO_TODAY;
  const from = addDays(to, -(days - 1));
  const mine = allowedOutlets(user);
  const asked = (list(q.outlets) ?? mine).filter((id) => mine.includes(id));
  const outletIds = asked.filter(waiterOutlet);
  const orders = getDataset().orders;
  const mayName = mayNameWaiters(user);
  const s = loadStore();
  const now = compareWaiters(orders, { outletIds, from, to });
  const before = compareWaiters(orders, { outletIds, from: addDays(from, -days), to: addDays(from, -1) });
  const outlets: OutletOut[] = now.map((o) => {
    const coaching = latestCoaching(o.outletId, s);
    // Anonymous labels are numbered by login order, so they stay the same whatever the period or the sort.
    const team = STAFF.filter((x) => x.outletId === o.outletId);
    const anon = (staffId: string) => {
      const role = staffById[staffId]?.role ?? "server";
      const same = team.filter((x) => x.role === role);
      return same.length > 1 ? `${ROLE_WORD[role]} ${same.findIndex((x) => x.id === staffId) + 1}` : ROLE_WORD[role];
    };
    const b = before.find((x) => x.outletId === o.outletId);
    return {
      outletId: o.outletId, bills: o.bills, guests: o.guests, drinks: o.drinks, rate: o.rate, foodTables: o.foodTables, noDrink: o.noDrink, drinkPrice: o.drinkPrice, shifts: o.shifts,
      before: b ? { guests: b.guests, drinks: b.drinks, rate: b.guests ? Math.round((b.drinks / b.guests) * 100) / 100 : null, foodTables: b.foodTables, noDrink: b.noDrink } : { guests: 0, drinks: 0, rate: null, foodTables: 0, noDrink: 0 },
      waiters: o.waiters.map(({ staffId, ...w }) => {
        const c = coaching.get(staffId);
        return {
          ...w, key: mayName ? staffId : `w-${o.outletId}-${team.findIndex((x) => x.id === staffId) + 1}`, name: mayName ? staffById[staffId]?.name ?? staffId : anon(staffId),
          role: staffById[staffId]?.role ?? "server", ...(c ? { coaching: coachingOut(c) } : {}),
          tables: noDrinkTables(orders, { outletId: o.outletId, staffId, from, to }, o.drinkPrice),
        };
      }),
    };
  });
  return {
    ok: true, from, to, days, mayName, mayCoach: can(user, "waiters.coach"), rules: WAITER_RULES, outlets,
    trend: teamByDay(orders, outletIds, eachDay({ from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY })),
    outcomes: OUTCOMES.map((value) => ({ value, label: COACHING_LABEL[value] })),
    left: asked.filter((id) => !waiterOutlet(id)),
  };
}

/** Records coaching on one waiter, replacing nothing: the latest per waiter is the one shown, earlier ones stay. */
export function recordCoaching(user: User, body: Record<string, unknown>): Result<{ coaching: WaiterCoaching }> {
  const { outletId, staffId, outcome } = body;
  if (!can(user, "waiters.coach")) return fail(403, "Your role cannot record coaching.");
  if (typeof outletId !== "string" || !outletById[outletId] || !waiterOutlet(outletId)) return fail(400, "Choose an outlet.");
  if (!allowedOutlets(user).includes(outletId)) return fail(403, "This outlet is outside your access.");
  if (typeof staffId !== "string" || staffById[staffId]?.outletId !== outletId) return fail(400, "Choose a waiter at this outlet.");
  if (!OUTCOMES.includes(outcome as CoachingOutcome)) return fail(400, "Choose what you did.");
  const days: WaiterDays = body.days === 7 || body.days === "7" ? 7 : 30;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  const row = compareWaiters(getDataset().orders, { outletIds: [outletId], from: addDays(DEMO_TODAY, -(days - 1)), to: DEMO_TODAY })[0]?.waiters.find((w) => w.staffId === staffId);
  if (!row) return fail(400, "This waiter rang no bills in the period.");
  // The shift it answers: the one marked to coach with the most at stake, else the waiter's busiest.
  const focus = [...row.shifts].sort((a, b) => Number(b.status === "coach") - Number(a.status === "coach") || b.shortfallValue - a.shortfallValue || b.guests - a.guests)[0];
  const coaching = mutateStore((s) => {
    const c: WaiterCoaching = {
      id: `WC-${outletById[outletId].code}-${nextNumber(s, `wc-${outletId}`)}`, propertyId: outletById[outletId].propertyId, outletId, staffId, date: DEMO_TODAY,
      outcome: outcome as CoachingOutcome, ...(note ? { note } : {}), by: user.id, role: user.role, at: new Date().toISOString(),
      shift: focus?.shift ?? SHIFTS[0].id, rate: focus?.rate ?? row.rate, peerRate: focus?.peerRate ?? row.peerRate, days,
    };
    s.waiterCoaching = [...(s.waiterCoaching ?? []), c];
    return c;
  });
  audit(user.id, "Waiter coaching recorded", `${outletId} ${staffId}: ${outcome}`, "");
  return { ok: true, coaching };
}

/** Takes a coaching note back, so the waiter shows the note before it, or none. */
export function clearCoaching(user: User, body: Record<string, unknown>): Result<{ id: string }> {
  if (!can(user, "waiters.coach")) return fail(403, "Your role cannot record coaching.");
  const found = (loadStore().waiterCoaching ?? []).find((c) => c.id === body.id);
  if (!found) return fail(404, "This note was not found.");
  if (!allowedOutlets(user).includes(found.outletId)) return fail(403, "This outlet is outside your access.");
  mutateStore((s) => { s.waiterCoaching = (s.waiterCoaching ?? []).filter((c) => c.id !== found.id); });
  audit(user.id, "Waiter coaching taken back", `${found.outletId} ${found.staffId}`, "");
  return { ok: true, id: found.id };
}
