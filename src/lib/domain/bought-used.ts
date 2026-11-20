// Bought against used, per item: what came in from suppliers over 30 days against what the till and the waste log say
// went out. It needs no stock count, so every gap is an estimate: stock still on the shelf is part of it until a count
// confirms it. Everything here is arithmetic on recorded figures; nothing decides why.
import { ingredientById, itemById, outletById, propertyById } from "../data/catalog";
import type { DayItem, Delivery, Exception, Transfer, WasteLog } from "../types";
import { DEMO_TODAY, addDays, fmtDate, fxRate, round2 } from "../util";
import { qtyWords } from "./variance";
import { wasteQuantities } from "./inventory";

/** Thresholds a hotel would agree with Tyll. Money in euros, converted for other currencies. */
export const BOUGHT_USED_RULES = {
  /** The period the check covers, ending today. */
  days: 30,
  /** A gap smaller than this share of what was used is within normal stock movement. */
  minShare: 0.1,
  /** A gap worth less than this is not worth a manager's time. */
  minValue: 100,
};

/** What could explain a gap, with how to check each. Fixed rules, none of them established. */
export const BOUGHT_USED_CAUSES: { id: string; title: string; check: string }[] = [
  { id: "shelf", title: "More was ordered than needed, and the stock is still on the shelf.", check: "Count the item. If it is there, order less until it is used." },
  { id: "recipe", title: "It goes into something with no recipe in the till: a drinks package, an event menu, minibars or staff drinks.", check: "Ask the bar and banqueting teams, then add the recipe or record the use." },
  { id: "waste", title: "Waste, breakage or out of date stock that was not logged.", check: "Ask the team, and log it so the next check is right." },
  { id: "delivery", title: "A delivery recorded for more than arrived.", check: "Compare the delivery notes with what was received, on Deliveries and invoices." },
  { id: "comp", title: "Served or given away without a till entry.", check: "Ask the shift supervisors about complimentary items not entered in the till." },
];

/** One menu item's share of an ingredient's use. */
export interface UseLine {
  itemId: string;
  units: number;
  qty: number;
}

export interface BoughtUsedRow {
  ingredientId: string;
  propertyId: string;
  from: string;
  to: string;
  /** Units received from suppliers: dataset deliveries and deliveries received in Tyll. */
  bought: number;
  /** What the supplier invoices charged for them. */
  boughtValue: number;
  deliveries: number;
  /** The most recent delivery's quantity: stock that may well still be on the shelf. */
  lastDelivery: number;
  lastDeliveryDate: string | null;
  /** Recipe quantity of everything sold, including complimentary items. */
  sold: number;
  /** Logged waste, spoilage and breakage. */
  waste: number;
  movedIn: number;
  movedOut: number;
  /** Sold plus waste plus moved out. */
  used: number;
  /** Bought plus moved in, less used. Positive means more came in than went out. */
  gap: number;
  /** Average price paid per unit over the period, or the standard cost when nothing was invoiced. */
  unitCost: number;
  /** The gap valued at the price paid. An estimate. */
  gapValue: number;
  /** Gap as a share of use. */
  share: number;
  flagged: boolean;
  /** The menu items that used it, largest first. */
  uses: UseLine[];
  /** Bought less used on each day of the period, in the item's unit. Days with no movement are left out. */
  byDay: Record<string, number>;
}

export interface BoughtUsedInputs {
  propertyId: string;
  from: string;
  to: string;
  deliveries: readonly Delivery[];
  dayItems: readonly DayItem[];
  waste: readonly WasteLog[];
  transfers: readonly Transfer[];
  /** Standard cost per unit, for items bought without an invoice price. */
  standardCost: (ingredientId: string) => number;
}

/** The check covers the last 30 days, today included, like every other 30 day view. */
export const boughtUsedPeriod = (to = DEMO_TODAY) => ({ from: addDays(to, -(BOUGHT_USED_RULES.days - 1)), to });

const inside = (date: string, from: string, to: string) => date >= from && date <= to;

/** Is a row's gap large enough to flag? More than the last delivery could leave on the shelf, a share of use, and money. */
export function gapFlagged(r: Pick<BoughtUsedRow, "gap" | "gapValue" | "share" | "lastDelivery" | "propertyId">): boolean {
  const minValue = BOUGHT_USED_RULES.minValue * fxRate("EUR", propertyById[r.propertyId].currency);
  return r.gap > r.lastDelivery + 1e-9 && r.share >= BOUGHT_USED_RULES.minShare && r.gapValue >= minValue;
}

/** Every recipe ingredient of a hotel: bought, used and the gap, largest gap in money first. */
export function boughtAgainstUsed(inp: BoughtUsedInputs): BoughtUsedRow[] {
  const { propertyId, from, to } = inp;
  const rows = new Map<string, Omit<BoughtUsedRow, "used" | "gap" | "unitCost" | "gapValue" | "share" | "flagged" | "uses"> & { uses: Map<string, UseLine>; invoiced: number }>();
  const row = (ingredientId: string) => {
    let r = rows.get(ingredientId);
    if (!r) rows.set(ingredientId, (r = { ingredientId, propertyId, from, to, bought: 0, boughtValue: 0, invoiced: 0, deliveries: 0, lastDelivery: 0, lastDeliveryDate: null, sold: 0, waste: 0, movedIn: 0, movedOut: 0, uses: new Map(), byDay: {} }));
    return r;
  };
  const move = (r: { byDay: Record<string, number> }, date: string, qty: number) => { r.byDay[date] = (r.byDay[date] ?? 0) + qty; };
  // Only food and drink: glassware, china and hotel supplies have no recipe to compare with.
  const counted = (ingredientId: string) => {
    const g = ingredientById[ingredientId];
    return !!g && (g.dept === "food" || g.dept === "beverage");
  };

  for (const d of inp.deliveries) {
    if (d.propertyId !== propertyId || d.status !== "delivered" || !inside(d.date, from, to)) continue;
    for (const l of d.lines) {
      if (!counted(l.ingredientId) || l.delivered <= 0) continue;
      const r = row(l.ingredientId);
      move(r, d.date, l.delivered);
      r.bought += l.delivered;
      r.boughtValue += l.invoiced * l.invoicePrice;
      r.invoiced += l.invoiced;
      r.deliveries += 1;
      if (!r.lastDeliveryDate || d.date > r.lastDeliveryDate) { r.lastDeliveryDate = d.date; r.lastDelivery = l.delivered; }
      else if (d.date === r.lastDeliveryDate) r.lastDelivery += l.delivered;
    }
  }
  for (const s of inp.dayItems) {
    if (outletById[s.outletId]?.propertyId !== propertyId || !inside(s.date, from, to) || s.units <= 0) continue;
    for (const l of itemById[s.itemId]?.recipe ?? []) {
      if (!counted(l.ingredientId)) continue;
      const r = row(l.ingredientId);
      move(r, s.date, -l.qty * s.units);
      r.sold += l.qty * s.units;
      const u = r.uses.get(s.itemId) ?? { itemId: s.itemId, units: 0, qty: 0 };
      u.units += s.units;
      u.qty += l.qty * s.units;
      r.uses.set(s.itemId, u);
    }
  }
  for (const w of inp.waste) {
    if (!w.synced || outletById[w.outletId]?.propertyId !== propertyId || !inside(w.date, from, to)) continue;
    for (const q of wasteQuantities(w)) {
      if (!counted(q.ingredientId)) continue;
      const r = row(q.ingredientId);
      move(r, w.date, -q.qty);
      r.waste += q.qty;
    }
  }
  for (const t of inp.transfers) {
    if (t.propertyId !== propertyId || !inside(t.date, from, to) || !counted(t.ingredientId)) continue;
    const r = row(t.ingredientId);
    move(r, t.date, t.direction === "in" ? t.qty : -t.qty);
    if (t.direction === "in") r.movedIn += t.qty;
    else r.movedOut += t.qty;
  }

  return [...rows.values()].map(({ uses, invoiced, ...r }) => {
    const used = r.sold + r.waste + r.movedOut;
    const gap = r.bought + r.movedIn - used;
    const unitCost = invoiced > 0 ? r.boughtValue / invoiced : inp.standardCost(r.ingredientId);
    const gapValue = round2(gap * unitCost);
    const share = used > 0 ? gap / used : gap > 0 ? 1 : 0;
    const out: BoughtUsedRow = {
      ...r, boughtValue: round2(r.boughtValue), used, gap, unitCost, gapValue, share, flagged: false,
      uses: [...uses.values()].sort((a, b) => b.qty - a.qty),
    };
    out.flagged = gapFlagged(out);
    return out;
  }).sort((a, b) => b.gapValue - a.gapValue || a.ingredientId.localeCompare(b.ingredientId));
}

export interface BoughtUsedSummary {
  checked: number;
  flagged: number;
  /** Value of the flagged gaps. */
  flaggedValue: number;
  boughtValue: number;
  /** Items where more was used than bought: stock was drawn down. Not flagged here; a count shows those. */
  drawnDown: number;
}

export function summarise(rows: readonly BoughtUsedRow[]): BoughtUsedSummary {
  const flagged = rows.filter((r) => r.flagged);
  return {
    checked: rows.length,
    flagged: flagged.length,
    flaggedValue: round2(flagged.reduce((s, r) => s + r.gapValue, 0)),
    boughtValue: round2(rows.reduce((s, r) => s + r.boughtValue, 0)),
    drawnDown: rows.filter((r) => r.gap < 0).length,
  };
}

/** The product as people say it, with a capital where the catalogue name starts one. */
export const itemWords = (ingredientId: string) => (ingredientId === "coke" ? "Coca-Cola" : ingredientById[ingredientId].name);

/** The flag id for an item's gap on a check date. One flag per item per hotel per day. */
export const boughtUsedFlagId = (propertyId: string, ingredientId: string, date: string) =>
  `EX-BU-${propertyId.toUpperCase()}-${ingredientId.toUpperCase()}-${date.slice(5).replace("-", "")}`;

/** The flags raised by a check: one per flagged item, dated the end of the period, before service. */
export function boughtUsedExceptions(rows: readonly BoughtUsedRow[]): Exception[] {
  return rows.filter((r) => r.flagged).map((r) => ({
    id: boughtUsedFlagId(r.propertyId, r.ingredientId, r.to),
    type: "bought_not_used" as const,
    propertyId: r.propertyId,
    date: r.to,
    min: 6 * 60,
    ingredientId: r.ingredientId,
    exposure: r.gapValue,
    headline: `${itemWords(r.ingredientId)}: ${qtyWords(r.gap, r.ingredientId)} more bought than used in 30 days`,
    comparedWith: `Compared with sales and waste: ${qtyWords(r.bought, r.ingredientId)} received from suppliers against ${qtyWords(r.used, r.ingredientId)} used by the recipes of what was sold, logged waste and transfers, over the 30 days to ${fmtDate(r.to)}.`,
    basis: "estimate" as const,
    boughtUsed: { from: r.from, to: r.to, bought: r.bought, deliveries: r.deliveries, lastDelivery: r.lastDelivery, sold: r.sold, waste: r.waste, movedIn: r.movedIn, movedOut: r.movedOut, used: r.used, gap: r.gap, unitCost: r.unitCost, share: r.share },
  }));
}
