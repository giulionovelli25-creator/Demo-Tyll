// Pour Control figures for the outlets a person may see. No staff names at any level.
import { outletById, propertyById, staffById } from "../data/catalog";
import { allowedOutlets, allowedProperties, mayNameStaff } from "../domain/access";
import { POUR_RULES, POUR_SKUS, SHIFTS, figures, flagLine, perBottle, pourLog, pourReasons, pourSellsAt, weekdayOf, type PourEntry, type PourFamily, type PourFigures, type PourFlag, type PourTeam, type Shift } from "../domain/pour";
import type { User } from "../types";
import { DEMO_TODAY, addDays, fmtMoney } from "../util";
import { getDataset } from "../data/generate";
import { rostered } from "../domain/rota";
import { pourOutlets, scanningFrom, withScans, type EmptyScan } from "../domain/empties";
import { emptyScans, scannedByWord } from "./empties";

export type PourPeriod = "today" | "week" | "month";

// "month" is the last 30 days; "lastMonth" the 30 days before, for the pace comparison.
const LAST_MONTH = addDays(DEMO_TODAY, -59);
const FROM: Record<PourPeriod, string> = { today: DEMO_TODAY, week: addDays(DEMO_TODAY, -6), month: addDays(DEMO_TODAY, -29) };

export interface PourFamilyOut {
  family: PourFamily;
  totals: Record<PourPeriod, PourFigures>;
  rows: { skuId: string; name: string; perBottle: number; periods: Record<PourPeriod, PourFigures> }[];
  outlets: { outletId: string; periods: Record<PourPeriod, PourFigures>; shifts: Record<Shift, Record<PourPeriod, PourFigures>> }[];
  flags: PourFlag[];
  /** Value not billed per day for the last 30 days, and the week before this one, for the trend and the comparison. */
  daily: { date: string; gap: number; gapValue: number; shifts: Record<Shift, number> }[];
  lastWeek: PourFigures;
  /** The 30 days before the last 30, for the pace the Overview compares with. */
  lastMonth: PourFigures;
  /** The full days of the last 30 (today left out), worked out the same way as lastMonth so the two compare. */
  recentFull: PourFigures;
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

/** One shift and bottle where the empties were scanned: what the scans show against the glasses sold. */
export interface ScannedShift {
  id: string;
  date: string;
  outletId: string;
  shift: Shift;
  skuId: string;
  name: string;
  family: PourFamily;
  figures: PourFigures;
  /** Each empty: the time, how it was logged and who by job (never by name). */
  scans: { min: number; method: "scan" | "pick"; who: string }[];
}

export interface PourEmpties {
  /** Every outlet in view that pours: the first day its bottles come from scans (null while simulated), and empties scanned. */
  outlets: { outletId: string; from: string | null; startsTomorrow: boolean; today: number; week: number; month: number }[];
  /** Scanned shifts of the last 30 days whose bottles gave under the threshold, with at least SCANNED_SHIFT_MIN not billed, most first. */
  shifts: ScannedShift[];
}

export interface PourOut {
  staff?: PourStaffView[];
  empties: PourEmpties;
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

/** A scanned shift is listed when its bottle gave under the threshold and at least this much was not billed. */
export const SCANNED_SHIFT_MIN = 50;

/** Where the bottles on Over pouring come from, outlet by outlet, and the scanned shifts that show the most not billed. */
function emptiesView(outletIds: readonly string[], scans: readonly EmptyScan[], log: readonly PourEntry[]): PourEmpties {
  const from = scanningFrom(scans);
  const counted = scans.filter((x) => !x.withdrawnAt);
  const since = (d: string) => counted.filter((x) => x.date >= d && x.date <= DEMO_TODAY);
  const outlets = pourOutlets(outletIds).map((outletId) => {
    const here = (d: string) => since(d).filter((x) => x.outletId === outletId).length;
    return {
      outletId, from: from.get(outletId) ?? null, startsTomorrow: !from.has(outletId) && counted.some((x) => x.outletId === outletId && x.date === DEMO_TODAY),
      today: here(DEMO_TODAY), week: here(FROM.week), month: here(FROM.month),
    };
  });
  const shifts: ScannedShift[] = [];
  for (const e of log) {
    if (e.scanned === undefined || e.date < FROM.month) continue;
    const f = figures([e], 1);
    if (!f.flagged || f.gapValue < SCANNED_SHIFT_MIN) continue;
    const sku = POUR_SKUS.find((x) => x.id === e.skuId)!;
    const mine = counted.filter((x) => x.date === e.date && x.outletId === e.outletId && x.shift === e.shift && x.skuId === e.skuId).sort((a, b) => a.min - b.min);
    shifts.push({ id: `${e.date}|${e.outletId}|${e.shift}|${e.skuId}`, date: e.date, outletId: e.outletId, shift: e.shift, skuId: e.skuId, name: sku.name, family: sku.family, figures: f, scans: mine.map((x) => ({ min: x.min, method: x.method, who: scannedByWord(x) })) });
  }
  shifts.sort((a, b) => b.figures.gapValue - a.figures.gapValue || b.date.localeCompare(a.date));
  return { outlets, shifts: shifts.slice(0, 12) };
}

type Result = { ok: true; pour: PourOut } | { ok: false; status: number; error: string };

const byPeriod = (entries: readonly PourEntry[]) => Object.fromEntries((Object.keys(FROM) as PourPeriod[]).map((p) => [p, figures(entries.filter((e) => e.date >= FROM[p] && e.date <= DEMO_TODAY))])) as Record<PourPeriod, PourFigures>;

export function pourFor(user: User, propertyId: string, asked?: readonly string[]): Result {
  if (!allowedProperties(user).includes(propertyId)) return { ok: false, status: 403, error: "This hotel is outside your access." };
  const mine = allowedOutlets(user).filter((o) => outletById[o].propertyId === propertyId);
  const outletIds = asked?.length ? mine.filter((o) => asked.includes(o)) : mine;
  // Bottles come from empty bottle scans where an outlet scans them, and stay simulated everywhere else.
  const scans = emptyScans(propertyId).filter((x) => outletIds.includes(x.outletId));
  const log = withScans(pourLog(getDataset().orders).filter((e) => outletIds.includes(e.outletId)), scans);
  const currency = propertyById[propertyId].currency;
  const money = (n: number) => fmtMoney(n, currency);
  // Names of the team only for managers who already see cases by person. Staff and the bar team never see them.
  const mayName = mayNameStaff(user);
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
      lastMonth: figures(entries.filter((e) => e.date >= LAST_MONTH && e.date < addDays(DEMO_TODAY, -29))),
      recentFull: figures(entries.filter((e) => e.date >= addDays(DEMO_TODAY, -29) && e.date < DEMO_TODAY)),
    };
  };
  const staff = mayName ? outletIds.filter((o) => pourSellsAt(o, "wine") || pourSellsAt(o, "spirits")).map((o) => staffView(o, log)).filter((v) => v.days.some((d) => d.value > 0)) : undefined;
  return { ok: true, pour: { staff, empties: emptiesView(outletIds, scans, log), propertyId, currency, threshold: POUR_RULES.threshold, wine: familyOut("wine"), spirits: familyOut("spirits") } };
}
