// Pour Control figures for the outlets a person may see. No staff names at any level.
import { outletById, propertyById } from "../data/catalog";
import { allowedOutlets, allowedProperties } from "../domain/access";
import { POUR_RULES, POUR_SKUS, SHIFTS, figures, flagLine, perBottle, pourLog, pourSellsAt, weekdayOf, type PourEntry, type PourFamily, type PourFigures, type PourFlag, type Shift } from "../domain/pour";
import type { User } from "../types";
import { DEMO_TODAY, addDays, fmtMoney } from "../util";
import { getDataset } from "../data/generate";

export type PourPeriod = "today" | "week" | "month";

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const FROM: Record<PourPeriod, string> = { today: DEMO_TODAY, week: addDays(DEMO_TODAY, -6), month: monthStart(DEMO_TODAY) };

export interface PourFamilyOut {
  family: PourFamily;
  totals: Record<PourPeriod, PourFigures>;
  rows: { skuId: string; name: string; perBottle: number; periods: Record<PourPeriod, PourFigures> }[];
  outlets: { outletId: string; periods: Record<PourPeriod, PourFigures>; shifts: Record<Shift, Record<PourPeriod, PourFigures>> }[];
  flags: PourFlag[];
}

export interface PourOut {
  propertyId: string;
  currency: string;
  threshold: number;
  wine: PourFamilyOut;
  spirits: PourFamilyOut;
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
      if (f.flagged && f.gap > 0) flags.push({ id: `pour-${family}-${k}`, outletId, weekday, shift, figures: f, text: flagLine(outletId, weekday, shift, f, family, money) });
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
    };
  };
  return { ok: true, pour: { propertyId, currency, threshold: POUR_RULES.threshold, wine: familyOut("wine"), spirits: familyOut("spirits") } };
}
