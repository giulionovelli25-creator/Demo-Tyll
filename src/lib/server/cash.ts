// Cash on hand against cash sales, per outlet and shift. Card payments are reconciled by the payment provider, so the
// check that matters is the cash drawer: what was counted at the end of the shift against the bills the till says were
// paid in cash. A difference above €10, or 1% of the shift's cash when that is more, is flagged, and every flag says
// what it was compared against. Cash-ups entered in Tyll are kept; earlier ones are simulated for the demo.
import { outletById, outletsOfProperty, propertyById, userById } from "../data/catalog";
import { getDataset } from "../data/generate";
import { allowedOutlets, allowedProperties, can } from "../domain/access";
import { orderTotals } from "../domain/orders";
import { CASH_TOLERANCE, cashCheck } from "../domain/procurement";
import type { CashUp, User } from "../types";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, fmtMoney, hashString, round2 } from "../util";
import { loadStore, mutateStore, nextNumber } from "./purchasing-store";
import { notify, peopleWith } from "./notify";

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The day shift closes bills before 16:00; the night shift from 16:00 to close. */
export const SHIFT_SPLIT = 16 * 60;
export const SHIFTS = { day: "Day shift, open to 16:00", night: "Night shift, 16:00 to close" } as const;
export type Shift = keyof typeof SHIFTS;
const shiftOf = (closeMin: number): Shift => (closeMin % 1440 < SHIFT_SPLIT && closeMin < 1440 ? "day" : "night");

export interface CashRow {
  outletId: string; outlet: string; date: string; shift: Shift;
  expected: number; bills: number; counted: number; diff: number; limit: number; flagged: boolean; kind: "short" | "over" | "exact";
  source: "entered" | "simulated"; by: string; note?: string; comparedWith: string;
}

/** Cash taken on the till per outlet, day and shift: bills paid in cash, net of refunds; voided bills take no cash. */
export function cashSales(propertyId: string, from: string, to: string) {
  const out = new Map<string, { expected: number; bills: number }>();
  for (const o of getDataset().orders) {
    if (o.payment !== "cash" || o.voided || o.date < from || o.date > to || outletById[o.outletId]?.propertyId !== propertyId) continue;
    const key = `${o.outletId}|${o.date}|${shiftOf(o.closeMin)}`;
    const cur = out.get(key) ?? { expected: 0, bills: 0 };
    cur.expected = round2(cur.expected + orderTotals(o).net);
    cur.bills += 1;
    out.set(key, cur);
  }
  return out;
}

/** The simulated count for a past shift: almost always within a few euros, with two planted differences. */
function simulatedCount(outletId: string, date: string, shift: Shift, expected: number): { counted: number; note?: string } {
  const lastFriday = (() => { for (let i = 1; i <= 7; i++) { const d = addDays(DEMO_TODAY, -i); if (new Date(`${d}T00:00:00Z`).getUTCDay() === 5) return d; } return addDays(DEMO_TODAY, -1); })();
  if (outletId === "lis-lobby" && date === lastFriday && shift === "night") return { counted: round2(expected - 85) };
  if (outletId === "lis-terrace" && date === addDays(DEMO_TODAY, -2) && shift === "day") return { counted: round2(expected + 20), note: "Tip left in the drawer, moved to the tip box next day" };
  const wobble = ((hashString(`${outletId}|${date}|${shift}`) % 9) - 4) / 2;
  return { counted: round2(Math.max(0, expected + wobble)) };
}

export function cashFor(user: User, propertyId: string, days = 14) {
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  if (!(can(user, "finance.view") || can(user, "stock.review") || can(user, "investigation.assign"))) return fail(403, "Your role cannot see cash-ups.");
  const outlets = new Set(allowedOutlets(user));
  const from = addDays(DEMO_TODAY, -days);
  const sales = cashSales(propertyId, from, DEMO_TODAY);
  const entered = (loadStore().cashUps ?? []).filter((c) => outletById[c.outletId]?.propertyId === propertyId);
  const currency = propertyById[propertyId].currency;
  const money = (n: number) => fmtMoney(n, currency, { decimals: true });
  const rows: CashRow[] = [];
  for (const [key, s] of sales) {
    const [outletId, date, shift] = key.split("|") as [string, string, Shift];
    if (!outlets.has(outletId)) continue;
    // Tonight's shift is still open.
    if (date === DEMO_TODAY && (shift === "night" || DEMO_NOW_MIN < SHIFT_SPLIT)) continue;
    const mine = entered.filter((c) => c.outletId === outletId && c.date === date && c.shift === shift).at(-1);
    const sim = simulatedCount(outletId, date, shift, s.expected);
    const counted = mine?.counted ?? sim.counted;
    const c = cashCheck(s.expected, counted);
    rows.push({
      outletId, outlet: outletById[outletId].name, date, shift, expected: s.expected, bills: s.bills, counted, diff: c.diff, limit: c.limit, flagged: c.flagged, kind: c.kind,
      source: mine ? "entered" : "simulated", by: mine ? userById[mine.by]?.name ?? mine.by : "Shift manager", note: mine?.note ?? sim.note,
      comparedWith: `Counted ${money(counted)} in the drawer at the end of the ${shift} shift, against ${money(s.expected)} cash sales on the till: ${s.bills} ${s.bills === 1 ? "bill" : "bills"} paid in cash, net of cash refunds. Differences up to ${money(c.limit)} (${fmtMoney(CASH_TOLERANCE.minimum, currency)} or ${CASH_TOLERANCE.share * 100}% of the shift's cash) are not flagged.`,
    });
  }
  rows.sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.date.localeCompare(a.date) || a.outlet.localeCompare(b.outlet));
  const flagged = rows.filter((r) => r.flagged);
  return {
    ok: true as const, currency, days, rows,
    totals: { shifts: rows.length, flagged: flagged.length, short: round2(flagged.filter((r) => r.diff < 0).reduce((t, r) => t + r.diff, 0)), over: round2(flagged.filter((r) => r.diff > 0).reduce((t, r) => t + r.diff, 0)), cash: round2(rows.reduce((t, r) => t + r.expected, 0)) },
    mayRecord: can(user, "stock.review") || can(user, "finance.review") || can(user, "investigation.assign"),
    outlets: outletsOfProperty(propertyId).filter((o) => outlets.has(o.id)).map((o) => ({ id: o.id, name: o.name })),
  };
}

/** A manager enters the cash counted at the end of a shift. A difference above the limit notifies the controller. */
export function recordCashUp(user: User, body: Record<string, unknown>) {
  const outletId = String(body.outletId ?? "");
  if (!outletById[outletId] || !allowedOutlets(user).includes(outletId)) return fail(403, "This outlet is outside your access.");
  if (!(can(user, "stock.review") || can(user, "finance.review") || can(user, "investigation.assign"))) return fail(403, "Only a manager can record a cash-up.");
  const date = String(body.date ?? "");
  if (!ISO.test(date) || date > DEMO_TODAY || date < addDays(DEMO_TODAY, -14)) return fail(400, "Choose a day in the last two weeks.");
  const shift = body.shift === "day" || body.shift === "night" ? body.shift : null;
  if (!shift) return fail(400, "Choose the day or night shift.");
  const counted = Number(body.counted);
  if (!Number.isFinite(counted) || counted < 0 || counted > 1e6) return fail(400, "Enter the cash counted.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || undefined : undefined;
  const propertyId = outletById[outletId].propertyId;
  const sales = cashSales(propertyId, date, date).get(`${outletId}|${date}|${shift}`) ?? { expected: 0, bills: 0 };
  const check = cashCheck(sales.expected, counted);
  const cash = mutateStore((x) => {
    x.cashUps ??= [];
    const c: CashUp = { id: `CU-${String(nextNumber(x, "CU")).padStart(5, "0")}`, outletId, date, shift, counted: round2(counted), by: user.id, at: new Date().toISOString(), note };
    x.cashUps.push(c);
    if (check.flagged) notify(x, { to: peopleWith("finance.review", propertyId), type: "cash-diff", ref: c.id, propertyId, from: user.id, title: `Cash ${check.diff < 0 ? "short" : "over"} at ${outletById[outletId].name}`, body: `${date}, ${shift} shift: ${fmtMoney(check.diff, propertyById[propertyId].currency, { decimals: true })} against the till's cash sales.`, href: "/money?tab=cash" });
    return c;
  });
  return { ok: true as const, cashUp: cash, check };
}
