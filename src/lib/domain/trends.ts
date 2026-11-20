// Daily series and week comparisons for the number strip at the top of each page. Read only from records the screens already use.
import { outletById, propertyById } from "../data/catalog";
import type { Currency, Investigation, WasteLog } from "../types";
import { DEMO_TODAY, addDays, eachDay, fxRate, sum } from "../util";
import { isBreakage, wasteCost } from "./inventory";
import type { Ctx } from "./metrics";

/** The last n days, ending on the business date. */
export const lastDays = (n: number, end = DEMO_TODAY) => eachDay({ from: addDays(end, -(n - 1)), to: end });

export const THIS_WEEK = { from: addDays(DEMO_TODAY, -6), to: DEMO_TODAY };
export const LAST_WEEK = { from: addDays(DEMO_TODAY, -13), to: addDays(DEMO_TODAY, -7) };
export const inRange = (date: string, r: { from: string; to: string }) => date >= r.from && date <= r.to;

/** Sum a dated list into one value per day. */
export function byDay<T>(rows: readonly T[], dateOf: (r: T) => string, valueOf: (r: T) => number, days = lastDays(30)) {
  const map = new Map<string, number>(days.map((d) => [d, 0]));
  for (const r of rows) {
    const d = dateOf(r);
    if (map.has(d)) map.set(d, map.get(d)! + valueOf(r));
  }
  return days.map((date) => ({ date, value: Math.round(map.get(date)! * 100) / 100 }));
}

export const weekSums = <T,>(rows: readonly T[], dateOf: (r: T) => string, valueOf: (r: T) => number) => ({
  now: sum(rows.filter((r) => inRange(dateOf(r), THIS_WEEK)), valueOf),
  before: sum(rows.filter((r) => inRange(dateOf(r), LAST_WEEK)), valueOf),
});

/**
 * "12% less than last week". goodWhen says which way is better, so the colour and icon follow; the words always say the direction.
 * versus names the period compared with.
 */
export function versus(now: number, before: number, goodWhen: "up" | "down", versusLabel = "last week", fmt?: (n: number) => string): { text: string; good: boolean | null } {
  if (before === 0 && now === 0) return { text: `None ${versusLabel} either`, good: null };
  if (before === 0) return { text: `None ${versusLabel}`, good: goodWhen === "up" };
  const change = (now - before) / Math.abs(before);
  if (Math.abs(change) < 0.005) return { text: `Same as ${versusLabel}`, good: null };
  const pct = Math.round(Math.abs(change) * 100);
  const word = change > 0 ? "more" : "less";
  const amount = fmt ? `${fmt(Math.abs(now - before))} ${word}` : `${pct}% ${word}`;
  return { text: `${amount} than ${versusLabel}`, good: (change > 0) === (goodWhen === "up") };
}

/** Waste and breakage in the display currency, one entry per log. */
export function wasteInCurrency(ctx: Ctx, outletIds: readonly string[], currency: Currency) {
  const ids = new Set(outletIds);
  return ctx.waste
    .filter((w) => w.synced && ids.has(w.outletId))
    .map((w) => ({ w, cost: wasteCost(w, ctx.overrides) * fxRate(propertyById[outletById[w.outletId].propertyId].currency, currency), broken: isBreakage(w) }));
}

export type WasteEntry = ReturnType<typeof wasteInCurrency>[number];

/** The reason or item that cost the most, with its share. */
export function topBy(entries: readonly WasteEntry[], keyOf: (w: WasteLog) => string | undefined) {
  const map = new Map<string, number>();
  for (const e of entries) { const k = keyOf(e.w); if (k) map.set(k, (map.get(k) ?? 0) + e.cost); }
  const total = sum([...map.values()], (v) => v);
  const [key, value] = [...map].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { key, value, share: total ? value / total : 0 };
}

/** Flagged transactions opened per day, by money at stake. */
export const flagsByDay = (cases: readonly Investigation[], valueOf: (i: Investigation) => number) => byDay(cases, (i) => i.date, valueOf);

/**
 * Saved against last month's pace, an estimate: what the days so far would have cost at last month's daily rate,
 * less what they did cost. Positive is money saved; negative means the loss runs above last month's pace.
 */
export function paceSaving(before: number, beforeDays: number, now: number, nowDays: number): number {
  if (beforeDays <= 0 || nowDays <= 0) return 0;
  return Math.round((before / beforeDays) * nowDays - now);
}

export interface LeakRow { id: string; label: string; lost: number; saved: number; how: "pace" | "recovered" | "credit"; href: string; /** The part of lost that is an estimate on cases still open. */ estimate?: number }

/** Every kind of loss Tyll measures, added up once. A row's saving counts only when it is above zero. */
export function lostAndSaved(rows: readonly LeakRow[]) {
  const lost = rows.reduce((s, r) => s + r.lost, 0);
  const saved = rows.reduce((s, r) => s + Math.max(0, r.saved), 0);
  return { lost, saved, share: lost > 0 ? saved / lost : 0, rows: [...rows].sort((a, b) => b.lost - a.lost) };
}

/** A 30 day figure at the same rate for a year, rounded to the nearest hundred. An estimate. */
export const yearly = (last30: number) => Math.round((last30 * 365) / 30 / 100) * 100;

/** Hours a week each role no longer spends on manual checks. Estimates from typical hotel routines, stated on screen. */
export const ROLE_HOURS: { role: string; hours: number; what: string }[] = [
  { role: "Outlet and bar managers", hours: 10, what: "End of shift checks, voids and comps, bar counts" },
  { role: "Cost controller", hours: 8, what: "Matching invoices, stock reconciliation, variance reports" },
  { role: "Purchasing manager", hours: 6, what: "Working out order quantities, chasing deliveries" },
  { role: "Head chef", hours: 5, what: "Prep planning, waste sheets, ordering" },
  { role: "Night audit", hours: 3, what: "Room charge and bill checks" },
  { role: "F&B director", hours: 3, what: "Pulling figures together for the weekly review" },
];
export const HOURLY_RATE = 30;
/** Ordering to the forecast instead of to par: a small share of purchases not bought. An estimate. */
export const OVER_ORDERING_SHARE = 0.006;

/** What Tyll is worth in a year at the last 30 days' rate: losses stopped, less over-ordering and hours saved. */
export function tyllValue(saved30: number, purchases30: number) {
  const stopped = yearly(saved30);
  const ordering = yearly(purchases30 * OVER_ORDERING_SHARE);
  const hoursWeek = ROLE_HOURS.reduce((s, r) => s + r.hours, 0);
  const hours = hoursWeek * 52 * HOURLY_RATE;
  return { stopped, ordering, hoursWeek, hours, total: stopped + ordering + hours };
}
