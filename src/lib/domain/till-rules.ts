// Till rules (overnight feature 5): how bills were rung and changed at the till.
// Three rules read one bill each and live in detect.ts (bill reopened after payment, open item or price set by hand, rung
// twice or an unusual quantity). The fourth, a cheaper item rung up, needs a week of bottles against a week of sales, so it
// lives here. Every rule reads recorded facts only; a flag is a prompt to check, never a finding about a person.
import { ingredientById, itemById, outletById, propertyById } from "../data/catalog";
import type { BottleIssue, Currency, DayItem, Exception, ExceptionType, MixEvidence } from "../types";
import { DATA_START, addDays, fmtDate, fmtMoney, round2 } from "../util";
import { TILL_TYPES } from "./detect";
import { menuPriceAt } from "./pricing";

/** A premium bottle a bar hands back empty for a full one, and the serves it is sold as. */
export interface MixLabel {
  id: string;
  name: string;
  rule: MixEvidence["rule"];
  /** The premium serve, and the cheaper serve that could be rung instead. */
  premiumItemId: string;
  cheapItemId: string;
  bottleMl: number;
  /** One glass of wine, or one single measure of a spirit. */
  serveMl: number;
  /** "glasses" or "measures", for the words on screen. */
  unit: string;
}

export const MIX_LABELS: MixLabel[] = [
  { id: "reserve", name: "Douro reserve red", rule: "premium", premiumItemId: "reserve", cheapItemId: "wine", bottleMl: 750, serveMl: 150, unit: "glasses" },
  { id: "gin", name: "Premium gin", rule: "double", premiumItemId: "gintonic2", cheapItemId: "gintonic", bottleMl: 700, serveMl: 50, unit: "measures" },
];
export const mixLabelById: Record<string, MixLabel> = Object.fromEntries(MIX_LABELS.map((l) => [l.id, l]));
/** The bars that sell the premium serves and hand back their empties for full bottles. */
export const MIX_OUTLETS = ["lis-lobby"];
export const perBottle = (l: MixLabel) => Math.round(l.bottleMl / l.serveMl);
/** The cheaper serve in words: the house wine's own name ("House wine"), or "single" for a spirit. */
export const cheapName = (l: MixLabel) => (l.rule === "premium" ? ingredientById[l.cheapItemId]?.name ?? itemById[l.cheapItemId].name : "single");

export const MIX_RULES = {
  /** Seven closed days at a time, the last one ending yesterday. */
  days: 7,
  /** The bottles must give at least this many bottles more than was billed: one open bottle is never enough. */
  minGapBottles: 2,
  /** And at least this share of what the bottles give. */
  minShare: 0.25,
  /** Weeks before, for the comparison shown beside it. */
  beforeWeeks: 4,
  /** How many weeks back the check runs. */
  weeks: 8,
};

/** Serves billed in the period, in the label's own units: glasses, or single measures with a double counting two. */
function served(units: Map<string, number>, l: MixLabel) {
  const premium = units.get(l.premiumItemId) ?? 0;
  const cheap = units.get(l.cheapItemId) ?? 0;
  return l.rule === "premium" ? { billed: premium, cheapBilled: cheap } : { billed: cheap + 2 * premium, cheapBilled: cheap };
}

/** One week of one label at one bar: bottles issued against serves billed. */
export function mixWeek(dayItems: readonly DayItem[], issues: readonly BottleIssue[], outletId: string, labelId: string, to: string) {
  const l = mixLabelById[labelId];
  const from = addDays(to, -(MIX_RULES.days - 1));
  const sum = (a: string, b: string) => {
    const units = new Map<string, number>();
    for (const r of dayItems) if (r.outletId === outletId && r.date >= a && r.date <= b && (r.itemId === l.premiumItemId || r.itemId === l.cheapItemId)) units.set(r.itemId, (units.get(r.itemId) ?? 0) + r.units);
    const bottles = issues.filter((x) => x.outletId === outletId && x.labelId === labelId && x.date >= a && x.date <= b).reduce((s, x) => s + x.bottles, 0);
    return { bottles, ...served(units, l) };
  };
  const now = sum(from, to);
  const per = perBottle(l);
  // Weeks before, as far back as the records go.
  const weeks = Array.from({ length: MIX_RULES.beforeWeeks }, (_, i) => addDays(from, -7 * (i + 1))).filter((d) => d >= DATA_START);
  const prior = weeks.map((d) => sum(d, addDays(d, 6)));
  // Bottles to a tenth, serves whole: "6.3 bottles a week, 303 glasses".
  const avg = (k: "bottles" | "billed" | "cheapBilled") => (prior.length ? Math.round((prior.reduce((s, x) => s + x[k], 0) / prior.length) * (k === "bottles" ? 10 : 1)) / (k === "bottles" ? 10 : 1) : 0);
  const premiumPrice = menuPriceAt(l.premiumItemId, outletId, to);
  const cheapPrice = menuPriceAt(l.cheapItemId, outletId, to);
  const evidence: MixEvidence = {
    from, to, rule: l.rule, labelId, premiumItemId: l.premiumItemId, cheapItemId: l.cheapItemId, perBottle: per,
    bottles: now.bottles, billed: now.billed, gap: Math.max(0, now.bottles * per - now.billed), cheapBilled: now.cheapBilled,
    priceGap: premiumPrice - cheapPrice,
    before: { bottles: avg("bottles"), billed: avg("billed"), cheapBilled: avg("cheapBilled") },
  };
  return evidence;
}

/**
 * Whether a week breaks the rule: the bottles give at least two bottles' worth more than was billed and a quarter of what
 * they give, and the cheaper serve was billed at least as often as the serves missing (a bar that barely sells the cheaper
 * serve cannot have rung the premium one on its key).
 *
 * The last condition does not tell a premium serve rung on the cheaper key from one not rung up at all: house wine sells
 * about 300 glasses a week and its weeks vary by 20 to 40 either way, more than a swap of 20 to 25 glasses adds. So the
 * flag is a prompt to check, the case shows the cheaper serve's week against the weeks before, and "not rung up at all"
 * is one of its possible causes. Review of feature 5, logged in OVERNIGHT_LOG.md.
 */
export function mixFlagged(m: MixEvidence): boolean {
  return m.gap >= MIX_RULES.minGapBottles * m.perBottle && m.gap >= MIX_RULES.minShare * m.bottles * m.perBottle && m.cheapBilled >= m.gap && m.priceGap > 0;
}

/** The value of the serves rung as the cheaper one: each at the menu price difference. An estimate. */
export const mixValue = (m: MixEvidence) => round2(m.gap * m.priceGap);

const mmdd = (iso: string) => `${iso.slice(5, 7)}${iso.slice(8, 10)}`;

export function mixHeadline(m: MixEvidence): string {
  const l = mixLabelById[m.labelId];
  return `${l.name}: ${m.bottles} bottles used, ${m.billed} of about ${m.bottles * m.perBottle} ${l.unit} billed${l.rule === "double" ? ", mostly as singles" : ""}`;
}

export function mixComparedWith(m: MixEvidence, currency: Currency): string {
  const l = mixLabelById[m.labelId];
  const money = (n: number) => fmtMoney(n, currency, { decimals: n % 1 !== 0 });
  const cheap = cheapName(l);
  return l.rule === "premium"
    ? `Compared with the bottles issued to the bar: ${m.bottles} bottles of ${l.name} in the 7 days to ${fmtDate(m.to)} give about ${m.bottles * m.perBottle} glasses, and ${m.billed} were billed. In the same days ${m.cheapBilled} glasses of ${cheap} were billed. The ${m.gap} glasses not billed as reserve are valued at the ${money(m.priceGap)} difference to ${cheap}, an estimate.`
    : `Compared with the bottles issued to the bar: ${m.bottles} bottles of ${l.name} in the 7 days to ${fmtDate(m.to)} give about ${m.bottles * m.perBottle} single measures, and the bills account for ${m.billed}, with ${m.cheapBilled} singles. The ${m.gap} measures not billed are valued as doubles rung as singles, ${money(m.priceGap)} each, an estimate.`;
}

/**
 * The weekly check over the history: weeks of seven closed days, the latest ending yesterday. A flag is dated the morning
 * after its week, at 6:00 AM, when the check runs, and carries the week's figures as evidence.
 */
export function detectMix(dayItems: readonly DayItem[], issues: readonly BottleIssue[], today: string): Exception[] {
  const out: Exception[] = [];
  for (const outletId of MIX_OUTLETS) {
    const outlet = outletById[outletId];
    const currency = propertyById[outlet.propertyId].currency;
    for (let k = 0; k < MIX_RULES.weeks; k++) {
      const to = addDays(today, -1 - 7 * k);
      if (addDays(to, -(MIX_RULES.days - 1)) < DATA_START) break;
      for (const l of MIX_LABELS) {
        const m = mixWeek(dayItems, issues, outletId, l.id, to);
        if (!mixFlagged(m)) continue;
        out.push({
          id: `EX-MIX-${outlet.code}-${l.id.toUpperCase()}-${mmdd(to)}`, type: "cheaper_item_rung", propertyId: outlet.propertyId, outletId,
          date: addDays(to, 1), min: 6 * 60, exposure: mixValue(m), headline: mixHeadline(m), comparedWith: mixComparedWith(m, currency), basis: "estimate", mix: m,
        });
      }
    }
  }
  return out;
}

/** What the till rule check counts, by rule, from the flags. The same flags as the flags page, so the two agree. */
export function tillByType<T extends { type: ExceptionType; exposure: number }>(flags: readonly T[]) {
  return TILL_TYPES.map((type) => {
    const list = flags.filter((f) => f.type === type);
    return { type, n: list.length, value: round2(list.reduce((s, f) => s + f.exposure, 0)) };
  });
}
