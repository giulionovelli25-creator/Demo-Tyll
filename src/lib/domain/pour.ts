// Pour Control: how many glasses each bottle really gave, by wine, outlet and shift.
// Glasses sold are the recorded POS lines. Bottles opened are SIMULATED for this demo, because the POS does not record them:
// each outlet and shift pours a set amount per glass, which gives the bottles it would have got through.
// Nothing here looks at individual staff. A low yield is a prompt to check, not a finding about anyone.
import { itemById, outletById } from "../data/catalog";
import type { Order } from "../types";
import { DEMO_TODAY, addDays, rng, sum } from "../util";
import { menuPriceAt } from "./pricing";

export type PourFamily = "wine" | "spirits";
export type Shift = "day" | "evening" | "late";
export const SHIFTS: { id: Shift; name: string }[] = [{ id: "day", name: "Day" }, { id: "evening", name: "Evening" }, { id: "late", name: "Late" }];
/** Day until 5 PM, evening until 10 PM, late after that. */
export const shiftOf = (min: number): Shift => (min < 17 * 60 ? "day" : min < 22 * 60 ? "evening" : "late");

export const POUR_RULES = {
  /** Yield below this share of what a bottle should give is flagged. */
  threshold: 0.9,
  /** Fewer bottles than this is too few to judge. */
  minBottles: 3,
  /** A pattern on one weekday and shift needs more behind it, over the four weeks it looks at. */
  minBottlesPattern: 5,
};

export interface PourSku {
  id: string;
  name: string;
  family: PourFamily;
  /** The menu item that sells it, and how much of the drink's price belongs to it. */
  itemId: string;
  priceShare: number;
  bottleMl: number;
  pourMl: number;
  /** Part bottles are counted to a tenth at close, as the outlet stock counts already are. */
  countStep: number;
  /** A wine's share of house wine glasses. */
  share?: number;
}

// The menu has one house wine by the glass. This demo shares its recorded glasses across four labels, so the totals still match sales.
export const POUR_SKUS: PourSku[] = [
  { id: "white", name: "House white", family: "wine", itemId: "wine", priceShare: 1, bottleMl: 750, pourMl: 150, countStep: 0.1, share: 0.4 },
  { id: "red", name: "House red", family: "wine", itemId: "wine", priceShare: 1, bottleMl: 750, pourMl: 150, countStep: 0.1, share: 0.35 },
  { id: "rose", name: "Rose", family: "wine", itemId: "wine", priceShare: 1, bottleMl: 750, pourMl: 150, countStep: 0.1, share: 0.15 },
  { id: "prosecco", name: "Prosecco", family: "wine", itemId: "wine", priceShare: 1, bottleMl: 750, pourMl: 150, countStep: 0.1, share: 0.1 },
  { id: "rum", name: "White rum", family: "spirits", itemId: "mojito", priceShare: 1, bottleMl: 1000, pourMl: 50, countStep: 0.1 },
  { id: "vodka", name: "Vodka", family: "spirits", itemId: "martini", priceShare: 0.6, bottleMl: 1000, pourMl: 40, countStep: 0.1 },
  { id: "liqueur", name: "Coffee liqueur", family: "spirits", itemId: "martini", priceShare: 0.4, bottleMl: 1000, pourMl: 25, countStep: 0.1 },
];
export const perBottle = (s: PourSku) => Math.round(s.bottleMl / s.pourMl);
const skuById = Object.fromEntries(POUR_SKUS.map((s) => [s.id, s]));

/** Simulated pour size against the standard, by outlet and shift. Most sit close to standard; a few run heavy. */
const PROFILE: Record<string, Partial<Record<Shift, number>>> = {
  // The same story as the house wine worked example: about 187 ml poured for a 150 ml glass.
  "dxb-lobby": { day: 1.2, evening: 1.25, late: 1.3 },
  "dxb-pool": { day: 1.04, evening: 1.18 },
  "dxb-terrace": { evening: 1.06, late: 1.14 },
  "doh-sky": { evening: 1.12, late: 1.24 },
};
const pourFactor = (outletId: string, shift: Shift, family: PourFamily, date: string) => {
  const base = PROFILE[outletId]?.[shift] ?? 1.01;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekend = shift !== "day" && (weekday === 5 || weekday === 6) ? 0.04 : 0;
  // Spirits run closer to standard: a measure is easier to keep than a free pour of wine.
  return 1 + (base - 1 + weekend) * (family === "spirits" ? 0.6 : 1);
};

export interface PourEntry { date: string; outletId: string; shift: Shift; skuId: string; sold: number; ml: number }

const cache = new WeakMap<object, PourEntry[]>();

/** One entry per day, outlet, shift and label. */
export function pourLog(orders: readonly Order[]): PourEntry[] {
  const hit = cache.get(orders);
  if (hit) return hit;
  const since = addDays(DEMO_TODAY, -45);
  const wines = POUR_SKUS.filter((s) => s.family === "wine");
  const buckets = new Map<string, PourEntry>();
  const add = (date: string, outletId: string, shift: Shift, sku: PourSku, qty: number, billed: boolean) => {
    const k = `${date}|${outletId}|${shift}|${sku.id}`;
    const b = buckets.get(k) ?? { date, outletId, shift, skuId: sku.id, sold: 0, ml: 0 };
    if (billed) b.sold += qty;
    b.ml += qty * sku.pourMl * pourFactor(outletId, shift, sku.family, date);
    buckets.set(k, b);
  };
  for (const o of orders) {
    if (o.date < since) continue;
    o.lines.forEach((l, li) => {
      const billed = !o.voided && (l.state === "kept" || l.state === "comped");
      const poured = billed || l.state === "removed_post" || (!!o.voided && l.sentMin !== undefined && l.state !== "removed_pre");
      if (!poured) return;
      const shift = shiftOf(l.sentMin ?? l.enteredMin);
      if (l.itemId === "wine") {
        // Each glass goes to one label, from a fixed seed so the split never changes between loads.
        for (let n = 0; n < l.qty; n++) {
          const roll = rng(`pour|${o.id}|${li}|${n}`).next();
          let at = 0;
          add(o.date, o.outletId, shift, wines.find((w) => (at += w.share!) >= roll) ?? wines[0], 1, billed);
        }
      } else {
        for (const sku of POUR_SKUS.filter((s) => s.itemId === l.itemId)) add(o.date, o.outletId, shift, sku, l.qty, billed);
      }
    });
  }
  const out = [...buckets.values()];
  cache.set(orders, out);
  return out;
}

export interface PourFigures {
  opened: number;
  sold: number;
  expected: number;
  /** Glasses a bottle gave, on average. Null when no bottle was opened. */
  yieldPer: number | null;
  perBottle: number;
  gap: number;
  /** Selling value of the gap, in the hotel's currency. */
  gapValue: number;
  flagged: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Bottles are worked out per label, outlet and shift, so tables add up whichever way they are cut. */
export function figures(entries: readonly PourEntry[], minBottles = POUR_RULES.minBottles): PourFigures {
  const groups = new Map<string, { sku: PourSku; outletId: string; sold: number; ml: number }>();
  for (const e of entries) {
    const k = `${e.outletId}|${e.skuId}|${e.shift}`;
    const g = groups.get(k) ?? { sku: skuById[e.skuId], outletId: e.outletId, sold: 0, ml: 0 };
    g.sold += e.sold;
    g.ml += e.ml;
    groups.set(k, g);
  }
  let opened = 0, sold = 0, expected = 0, value = 0;
  for (const g of groups.values()) {
    const bottles = Math.round(g.ml / g.sku.bottleMl / g.sku.countStep) * g.sku.countStep;
    const exp = Math.round(bottles * perBottle(g.sku));
    opened += bottles;
    sold += g.sold;
    expected += exp;
    value += (exp - g.sold) * menuPriceAt(g.sku.itemId, g.outletId, DEMO_TODAY) * g.sku.priceShare;
  }
  opened = round1(opened);
  const per = opened > 0 ? expected / opened : 0;
  const yieldPer = opened > 0 ? sold / opened : null;
  return {
    opened, sold, expected, yieldPer, perBottle: round1(per), gap: Math.max(0, expected - sold), gapValue: Math.max(0, Math.round(value)),
    flagged: opened >= minBottles && yieldPer !== null && yieldPer < per * POUR_RULES.threshold,
  };
}

const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHIFT_WORD: Record<Shift, string> = { day: "day shift", evening: "evening shift", late: "late shift" };
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export interface PourFlag { id: string; outletId: string; weekday: number; shift: Shift; figures: PourFigures; text: string }

/** One plain line for a flagged pattern. Never names a person. */
export function flagLine(outletId: string, weekday: number, shift: Shift, f: PourFigures, family: PourFamily, money: (n: number) => string): string {
  const noun = family === "wine" ? "glasses" : "measures";
  const what = family === "wine" ? "wine" : "spirits";
  return `${outletById[outletId].name}, ${DAY_NAME[weekday]} ${SHIFT_WORD[shift]}: ${f.opened} bottles opened, ${f.sold} ${noun} sold, expected ${f.expected}. About ${money(f.gapValue)} of ${what} not billed.`;
}

export const pourSellsAt = (outletId: string, family: PourFamily) => POUR_SKUS.some((s) => s.family === family && outletById[outletId].menu.some((m) => m.itemId === s.itemId && itemById[m.itemId]));
export const totalGapValue = (flags: readonly { figures: PourFigures }[]) => sum(flags, (f) => f.figures.gapValue);
