// Pour Control figures for the outlets a person may see. No staff names at any level.
import { outletById, propertyById, staffById } from "../data/catalog";
import { allowedOutlets, allowedProperties, canOpen } from "../domain/access";
import { POUR_RULES, POUR_SKUS, SHIFTS, figures, flagLine, perBottle, pourLog, pourReasons, pourSellsAt, weekdayOf, type PourEntry, type PourFamily, type PourFigures, type PourFlag, type PourTeam, type Shift } from "../domain/pour";
import type { User } from "../types";
import { DEMO_TODAY, addDays, fmtMoney } from "../util";
import { getDataset } from "../data/generate";
import { rostered } from "../domain/rota";

export type PourPeriod = "today" | "week" | "month";

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const LAST_MONTH = monthStart(addDays(monthStart(DEMO_TODAY), -1));
const FROM: Record<PourPeriod, string> = { today: DEMO_TODAY, week: addDays(DEMO_TODAY, -6), month: monthStart(DEMO_TODAY) };

export interface PourFamilyOut {
  family: PourFamily;
  totals: Record<PourPeriod, PourFigures>;
  rows: { skuId: string; name: string; perBottle: number; periods: Record<PourPeriod, PourFigures> }[];
  outlets: { outletId: string; periods: Record<PourPeriod, PourFigures>; shifts: Record<Shift, Record<PourPeriod, PourFigures>> }[];
  flags: PourFlag[];
  /** Value not billed per day for the last 30 days, and the week before this one, for the trend and the comparison. */
  daily: { date: string; gap: number; gapValue: number; shifts: Record<Shift, number> }[];
  lastWeek: PourFigures;
  /** The whole of last calendar month, for the pace the Overview compares this month with. */
  lastMonth: PourFigures;
}

/** One outlet, day by day: what was not billed and who rang up bills that day. Managers only. */
export interface PourStaffView {
  outletId: string;
  days: { date: string; value: number; people: string[] }[];
  /** The costliest days, most first. */
  top: string[];
  /** Shifts on, average not billed on their shifts and on the others, costliest days on, and how far the gap is beyond chance (2 or more stands out). */
  people: { staffId: string; name: string; role: string; days: number; avgOn: number; avgOff: number; inTop: number; z: number }[];
}

export interface PourOut {
  staff?: PourStaffView[];
  propertyId: string;
  currency: string;
  threshold: number;
  wine: PourFamilyOut;
  spirits: PourFamilyOut;
}

/** Who was rostered on one weekday and shift at one outlet over the last four weeks. Being on shift is not proof of who poured. */
function teamOn(outletId: string, weekday: number, shift: Shift, mayName: boolean): PourTeam {
  const dates = Array.from({ length: 28 }, (_, i) => addDays(DEMO_TODAY, i - 27)).filter((d) => weekdayOf(d) === weekday);
  const byDate = dates.map((d) => rostered(outletId, d, shift));
  const counts = new Map<string, number>();
  for (const ids of byDate) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const shifts = dates.length;
  const perShift = shifts ? Math.round((byDate.reduce((n, ids) => n + ids.length, 0) / shifts) * 10) / 10 : 0;
  const people = [...counts].map(([staffId, n]) => ({ staffId, role: staffById[staffId]?.role ?? "server", shifts: n, ...(mayName ? { name: staffById[staffId]?.name ?? staffId } : {}) })).sort((a, b) => b.shifts - a.shifts);
  return { shifts, perShift, people };
}

/**
 * Who was on each day at one outlet, set against what was not billed that day, over the last four weeks.
 * Compares each person's days with the days they were off, so someone who simply works a lot does not stand out for that alone.
 */
function staffView(outletId: string, log: readonly PourEntry[]): PourStaffView {
  const dates = Array.from({ length: 28 }, (_, i) => addDays(DEMO_TODAY, i - 27));
  const here = log.filter((e) => e.outletId === outletId);
  // One unit per shift that sold drinks: what it did not bill, and who was rostered.
  const shifts = dates.flatMap((date) => SHIFTS.map((sh) => {
    const entries = here.filter((e) => e.date === date && e.shift === sh.id);
    return entries.length ? { date, value: figures(entries).gapValue, people: rostered(outletId, date, sh.id) } : null;
  })).filter((x): x is { date: string; value: number; people: string[] } => x !== null);
  const days = dates.map((date) => {
    const mine = shifts.filter((x) => x.date === date);
    return { date, value: mine.reduce((n, x) => n + x.value, 0), people: [...new Set(mine.flatMap((x) => x.people))] };
  });
  const top = [...days].filter((d) => d.value > 0).sort((a, b) => b.value - a.value).slice(0, 5).map((d) => d.date);
  const ids = [...new Set(shifts.flatMap((x) => x.people))];
  const mean = (xs: number[]) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : 0);
  const all = shifts.map((x) => x.value);
  const sd = Math.sqrt(mean(all.map((v) => (v - mean(all)) ** 2)));
  const people = ids.map((staffId) => {
    const mine = shifts.filter((x) => x.people.includes(staffId));
    const rest = shifts.filter((x) => !x.people.includes(staffId));
    const on = mean(mine.map((x) => x.value));
    const off = mean(rest.map((x) => x.value));
    // How many standard errors the difference is: under 2 is within what chance alone produces.
    const se = sd * Math.sqrt(1 / Math.max(mine.length, 1) + 1 / Math.max(rest.length, 1));
    const z = se > 0 && mine.length >= 6 && rest.length >= 6 ? Math.round(((on - off) / se) * 10) / 10 : 0;
    return { staffId, name: staffById[staffId]?.name ?? staffId, role: staffById[staffId]?.role ?? "server", days: mine.length, avgOn: Math.round(on), avgOff: Math.round(off), inTop: days.filter((d) => top.includes(d.date) && d.people.includes(staffId)).length, z };
  }).sort((a, b) => b.z - a.z);
  return { outletId, days, top, people };
}

type Result = { ok: true; pour: PourOut } | { ok: false; status: number; error: string };

const byPeriod = (entries: readonly PourEntry[]) => Object.fromEntries((Object.keys(FROM) as PourPeriod[]).map((p) => [p, figures(entries.filter((e) => e.date >= FROM[p] && e.date <= DEMO_TODAY))])) as Record<PourPeriod, PourFigures>;

export function pourFor(user: User, propertyId: string, asked?: readonly string[]): Result {
  if (!allowedProperties(user).includes(propertyId)) return { ok: false, status: 403, error: "This hotel is outside your access." };
  const mine = allowedOutlets(user).filter((o) => outletById[o].propertyId === propertyId);
  const outletIds = asked?.length ? mine.filter((o) => asked.includes(o)) : mine;
  const log = pourLog(getDataset().orders).filter((e) => outletIds.includes(e.outletId));
  const currency = propertyById[propertyId].currency;
  const money = (n: number) => fmtMoney(n, currency);
  // Names of the team only for managers who already see cases by person. Staff and the bar team never see them.
  const mayName = canOpen(user, "investigations") && user.role !== "employee";
  const familyOut = (family: PourFamily): PourFamilyOut => {
    const skus = POUR_SKUS.filter((s) => s.family === family);
    const ids = new Set(skus.map((s) => s.id));
    const entries = log.filter((e) => ids.has(e.skuId));
    // Where and when it keeps happening: each weekday and shift at each outlet, over the last four weeks.
    const flags: PourFlag[] = [];
    const recent = entries.filter((e) => e.date >= addDays(DEMO_TODAY, -27));
    const keys = new Set(recent.map((e) => `${e.outletId}|${weekdayOf(e.date)}|${e.shift}`));
    for (const k of keys) {
      const [outletId, day, shift] = k.split("|") as [string, string, Shift];
      const weekday = Number(day);
      const f = figures(recent.filter((e) => e.outletId === outletId && weekdayOf(e.date) === weekday && e.shift === shift), POUR_RULES.minBottlesPattern);
      if (f.flagged && f.gap > 0) {
        const team = teamOn(outletId, weekday, shift, mayName);
        flags.push({ id: `pour-${family}-${k}`, outletId, weekday, shift, figures: f, text: flagLine(outletId, weekday, shift, f, family, money), team, reasons: pourReasons({ weekday, shift, figures: f }, family, team) });
      }
    }
    flags.sort((a, b) => b.figures.gapValue - a.figures.gapValue);
    return {
      family,
      totals: byPeriod(entries),
      rows: skus.map((s) => ({ skuId: s.id, name: s.name, perBottle: perBottle(s), periods: byPeriod(entries.filter((e) => e.skuId === s.id)) })),
      outlets: outletIds.filter((o) => pourSellsAt(o, family)).map((outletId) => {
        const here = entries.filter((e) => e.outletId === outletId);
        return { outletId, periods: byPeriod(here), shifts: Object.fromEntries(SHIFTS.map((s) => [s.id, byPeriod(here.filter((e) => e.shift === s.id))])) as Record<Shift, Record<PourPeriod, PourFigures>> };
      }),
      flags,
      daily: Array.from({ length: 30 }, (_, i) => addDays(DEMO_TODAY, i - 29)).map((date) => {
        const today = entries.filter((e) => e.date === date);
        const f = figures(today);
        return { date, gap: f.gap, gapValue: f.gapValue, shifts: Object.fromEntries(SHIFTS.map((sh) => [sh.id, figures(today.filter((e) => e.shift === sh.id)).gapValue])) as Record<Shift, number> };
      }),
      lastWeek: figures(entries.filter((e) => e.date >= addDays(DEMO_TODAY, -13) && e.date <= addDays(DEMO_TODAY, -7))),
      lastMonth: figures(entries.filter((e) => e.date >= LAST_MONTH && e.date < monthStart(DEMO_TODAY))),
    };
  };
  const staff = mayName ? outletIds.filter((o) => pourSellsAt(o, "wine") || pourSellsAt(o, "spirits")).map((o) => staffView(o, log)).filter((v) => v.days.some((d) => d.value > 0)) : undefined;
  return { ok: true, pour: { staff, propertyId, currency, threshold: POUR_RULES.threshold, wine: familyOut("wine"), spirits: familyOut("spirits") } };
}
