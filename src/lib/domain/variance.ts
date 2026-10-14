// Where did it go? Compares what an outlet's own stock records say was used with what sales and recipes say should have been.
// Everything here is arithmetic on recorded figures. Possible causes are listed with the records that bear on them; none is concluded.
import { ingredientById, itemById, outletById, propertyById } from "../data/catalog";
import type { Recount, RecipeChange, UsagePeriod, WasteLog } from "../types";
import { fxRate } from "../util";
import { qtyPerUnit, wasteQuantities } from "./inventory";

export { qtyPerUnit };

/** Corrections made in the session that change a period's figures. */
export interface Adjustments {
  recounts: readonly Recount[];
  recipes: readonly RecipeChange[];
  /** Waste and breakage logged in the session, already corrected. */
  waste: readonly WasteLog[];
}

export const NO_ADJUSTMENTS: Adjustments = { recounts: [], recipes: [], waste: [] };

export const VARIANCE_RULES = {
  /** Smaller differences are within normal counting and portioning. */
  minShare: 0.05,
  /** In AED, converted for other currencies. */
  minValue: 20,
  /** A difference this large, as a share of expected use, opens a case automatically. */
  caseShare: 0.1,
};

export interface SessionWaste {
  id: string;
  date: string;
  qty: number;
  reason: string;
  by: string;
  late: boolean;
}

export interface Variance {
  opening: number;
  closing: number;
  /** Original counts, where a recount replaced them. */
  openingWas?: number;
  closingWas?: number;
  received: number;
  transfers: number;
  /** Opening + received ± transfers − closing. */
  actual: number;
  /** Units sold and given away, times the recipe quantity. */
  expected: number;
  soldUnits: number;
  compedUnits: number;
  waste: number;
  breakage: number;
  /** Actual less expected less recorded waste and breakage. Positive means stock is missing. */
  unexplained: number;
  /** Value of the unexplained quantity in the property's currency. */
  value: number;
  /** Unexplained as a share of expected use. */
  share: number;
  tolerance: number;
  /** Larger than counting uncertainty and normal portioning. */
  significant: boolean;
  /** Quantity on lines that were sent for preparation and then removed or voided. */
  removedQty: number;
  sessionWaste: SessionWaste[];
}

const latestRecount = (recounts: readonly Recount[], checkId: string) =>
  recounts.filter((r) => r.checkId === checkId).sort((a, b) => b.seq - a.seq)[0];

/** Does a session waste entry belong to this period? Late entries name their period; others go by date. */
const inPeriod = (p: UsagePeriod, w: WasteLog) => (w.periodId ? w.periodId === p.id : w.date > p.from.date && w.date <= p.to.date);

export function periodVariance(p: UsagePeriod, adj: Adjustments = NO_ADJUSTMENTS): Variance {
  const openRe = latestRecount(adj.recounts, p.from.id);
  const closeRe = latestRecount(adj.recounts, p.to.id);
  const opening = openRe ? openRe.counted : p.from.counted;
  const closing = closeRe ? closeRe.counted : p.to.counted;
  const received = p.issues.reduce((s, m) => s + m.qty, 0);
  const transfers = p.transfers.reduce((s, m) => s + m.qty, 0);
  const actual = opening + received + transfers - closing;

  let expected = 0, soldUnits = 0, compedUnits = 0;
  for (const s of p.sales) {
    expected += s.units * qtyPerUnit(s.qtyPerUnit, s.itemId, p.ingredientId, s.date, adj.recipes);
    soldUnits += s.units;
    compedUnits += s.comped;
  }

  let waste = 0, breakage = 0;
  for (const w of p.waste) {
    if (w.reason === "breakage") breakage += w.qty;
    else waste += w.qty;
  }
  const sessionWaste: SessionWaste[] = [];
  for (const w of adj.waste) {
    if (w.outletId !== p.outletId || !w.synced || !inPeriod(p, w)) continue;
    const qty = wasteQuantities(w).filter((q) => q.ingredientId === p.ingredientId).reduce((s, q) => s + q.qty, 0);
    if (qty <= 0) continue;
    if (w.reason === "breakage") breakage += qty;
    else waste += qty;
    sessionWaste.push({ id: w.id, date: w.date, qty, reason: w.reason, by: w.by, late: !!w.periodId });
  }

  const unexplained = actual - expected - waste - breakage;
  const value = unexplained * p.unitCost;
  const share = expected > 0 ? unexplained / expected : unexplained > 0 ? 1 : 0;
  const minValue = VARIANCE_RULES.minValue * fxRate("AED", propertyById[p.propertyId].currency);
  const significant = Math.abs(unexplained) > p.tolerance + 1e-9 && Math.abs(share) >= VARIANCE_RULES.minShare && Math.abs(value) >= minValue;
  const removedQty = p.removals.reduce((s, r) => s + r.qty * r.qtyPerUnit, 0);
  return {
    opening, closing, openingWas: openRe ? p.from.counted : undefined, closingWas: closeRe ? p.to.counted : undefined,
    received, transfers, actual, expected, soldUnits, compedUnits, waste, breakage, unexplained, value, share,
    tolerance: p.tolerance, significant, removedQty, sessionWaste,
  };
}

/** Should a period open a case by itself? Only clear shortfalls well beyond counting uncertainty. */
export const needsCase = (v: Variance) => v.significant && v.unexplained > 0 && v.share >= VARIANCE_RULES.caseShare;

// ---- Plain-English explanation --------------------------------------------------------------------------------

const isWine = (ingredientId: string) => ingredientId === "wine";
export const BOTTLE_L = 0.75;

/** A quantity in the way staff count it: cans as units, wine in bottles and millilitres, food by weight. */
export function qtyWords(qty: number, ingredientId: string): string {
  const g = ingredientById[ingredientId];
  const a = Math.abs(qty);
  if (g.unit === "each") {
    const n = Math.round(a * 10) / 10;
    const noun = ingredientId === "coke" ? (n === 1 ? "can" : "cans") : n === 1 ? "unit" : "units";
    return `${n % 1 === 0 ? n : n.toFixed(1)} ${noun}`;
  }
  if (isWine(ingredientId)) return `${Math.round(a * 1000).toLocaleString("en-US")} ml`;
  if (g.unit === "kg") return a < 1 ? `${Math.round(a * 1000)} g` : `${(Math.round(a * 100) / 100).toLocaleString("en-US")} kg`;
  return a < 1 ? `${Math.round(a * 1000)} ml` : `${(Math.round(a * 100) / 100).toLocaleString("en-US")} l`;
}

export const bottles = (litres: number) => Math.round((litres / BOTTLE_L) * 10) / 10;

export function headlineFor(p: UsagePeriod, v: Variance): string {
  const g = ingredientById[p.ingredientId];
  const o = outletById[p.outletId].name;
  if (v.unexplained <= 0) return `${plainName(p.ingredientId)} at ${o}: use matches sales`;
  if (isWine(p.ingredientId)) return `Wine use at ${o} is ${qtyWords(v.unexplained, p.ingredientId)} above what was sold`;
  if (g.dept === "beverage") return `${qtyWords(v.unexplained, p.ingredientId)} of ${plainName(p.ingredientId)} unexplained at ${o}`;
  return `${plainName(p.ingredientId)} use at ${o} is ${qtyWords(v.unexplained, p.ingredientId)} above the recipes`;
}

/** The one-paragraph summary at the top of a case. Built from the figures, so it changes when they change. */
export function summaryFor(p: UsagePeriod, v: Variance): string {
  const g = ingredientById[p.ingredientId];
  const q = (n: number) => qtyWords(n, p.ingredientId);
  if (!v.significant) {
    return `${plainName(p.ingredientId)} use at ${outletById[p.outletId].name} is within ${q(Math.max(v.tolerance, Math.abs(v.unexplained)))} of what sales and recorded waste explain. That is within normal counting and portioning.`;
  }
  if (v.unexplained < 0) {
    return `Less ${plainName(p.ingredientId)} was used than sales and recipes expect, by ${q(v.unexplained)}. Check the counts and whether recipes overstate the quantity.`;
  }
  if (isWine(p.ingredientId)) {
    const glasses = v.soldUnits;
    return `Recorded wine use is higher than expected from the ${glasses} glass${glasses === 1 ? "" : "es"} sold: ${q(v.actual)} left stock against ${q(v.expected)} expected, a difference of ${q(v.unexplained)}. Check serving sizes, wastage and complimentary pours.`;
  }
  if (g.dept === "beverage") {
    return `${cap(q(v.unexplained))} of ${plainName(p.ingredientId)} remain unexplained after comparing recorded sales with stock use. Check complimentary drinks, waste records, stock counts and supplier deliveries.`;
  }
  return `${plainName(p.ingredientId)} use exceeded recipe-based expectations by ${q(v.unexplained)}. Check portion sizes, preparation waste and inventory records.`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- Possible causes ------------------------------------------------------------------------------------------

/** What the records say about a possible cause. "open" means the records cannot settle it: someone has to check. */
export type CauseStatus = "supported" | "against" | "open";

export interface Cause {
  id: string;
  title: string;
  status: CauseStatus;
  /** What the records show about this cause. */
  evidence: string[];
  /** How a manager can confirm or rule it out. */
  check: string;
  /** Up to how much of the difference this could account for, where the records give a figure. */
  upTo?: number;
}

export function causesFor(p: UsagePeriod, v: Variance): Cause[] {
  const g = ingredientById[p.ingredientId];
  const q = (n: number) => qtyWords(n, p.ingredientId);
  const bev = g.dept === "beverage";
  const wine = isWine(p.ingredientId);
  const prior = p.history.slice(-5);
  const priorAbs = prior.length ? prior.reduce((s, h) => s + Math.abs(h.unexplained), 0) / prior.length : null;
  const out: Cause[] = [];

  // Served but not charged: the POS shows lines prepared and then removed or voided.
  const removals = p.removals.filter((r) => r.qty * r.qtyPerUnit > 0);
  out.push({
    id: "not_charged",
    title: bev ? "Drinks served but not entered in the POS, or removed from the bill" : "Dishes made but not charged",
    status: removals.length ? "supported" : "open",
    evidence: removals.length
      ? [
        `${removals.length} line${removals.length === 1 ? " was" : "s were"} sent to the ${bev ? "bar" : "kitchen"} and then ${removals.every((r) => r.how === "removed") ? "removed from the bill" : "removed or voided"}, using ${q(v.removedQty)}.`,
        "These are recorded facts. Whether the item was served is not recorded.",
      ]
      : ["No line using this item was removed or voided after it was sent in this period.", "Drinks or dishes never entered in the POS cannot be seen in any record."],
    check: removals.length ? "Open each order below and ask the team whether the item was served." : "Compare the bar or kitchen ticket printer log with the POS for the period.",
    upTo: removals.length ? Math.min(v.removedQty, Math.max(0, v.unexplained)) : undefined,
  });

  // Complimentary items are already in expected use when they are recorded.
  out.push({
    id: "comps",
    title: bev ? "Unrecorded complimentary drinks" : "Complimentary dishes",
    status: "open",
    evidence: [
      v.compedUnits > 0
        ? `${v.compedUnits} complimentary unit${v.compedUnits === 1 ? " was" : "s were"} recorded in the POS. Those are already counted as expected use.`
        : "No complimentary units were recorded in the POS in this period.",
      "Complimentary items given without a POS entry leave no record.",
    ],
    check: "Ask the shift supervisor about any complimentary items not entered in the POS.",
  });

  if (wine) {
    const perGlass = p.sales.find((s) => s.itemId === "wine")?.qtyPerUnit ?? 0.15;
    const glassesWorth = perGlass > 0 ? v.unexplained / perGlass : 0;
    const impliedPour = v.soldUnits > 0 ? (v.actual - v.waste - v.breakage) / v.soldUnits : 0;
    out.push({
      id: "overpour",
      title: "Pours larger than the standard measure",
      status: "open",
      evidence: [
        `The standard pour is ${Math.round(perGlass * 1000)} ml. If every glass sold accounts for the stock used, the average pour would have been ${Math.round(impliedPour * 1000)} ml.`,
        `The difference is about ${glassesWorth.toFixed(1)} standard glasses. The same total could come from a few unrecorded glasses instead of larger pours.`,
        "Pour size is not recorded anywhere, so the records cannot show it.",
      ],
      check: "Watch pours during a service, and check that the bar uses the correct measure or marked glasses.",
    });
    out.push({
      id: "tasting",
      title: "Wine tastings or bottles opened for guests to try",
      status: "open",
      evidence: ["No tasting is recorded as waste or as a complimentary item in this period."],
      check: "Ask whether a bottle was opened for a tasting, and log it as waste if so.",
    });
    out.push({
      id: "setting",
      title: "The standard serving size in Tyll is wrong",
      status: "open",
      evidence: [`Tyll expects ${Math.round(perGlass * 1000)} ml a glass. If the menu or the glass is a different size, every glass adds to the difference.`],
      check: "Compare the menu's stated serving with the setting, and change it below if it is wrong.",
    });
  }

  if (!bev) {
    out.push({
      id: "portion",
      title: "Portions larger than the recipe",
      status: "open",
      evidence: [
        `Recipes allow ${q(v.expected)} for ${v.soldUnits} portion${v.soldUnits === 1 ? "" : "s"} sold.`,
        v.soldUnits > 0 ? `The difference is ${q(v.unexplained / v.soldUnits)} a portion on average.` : "No portions were sold.",
        "Portion weights are not recorded, so the records cannot show this.",
      ],
      check: "Weigh a few portions during service against the recipe.",
    });
    out.push({
      id: "prep",
      title: "Preparation waste or trimming not logged",
      status: "open",
      evidence: [v.waste > 0 ? `${q(v.waste)} of waste is already recorded and taken off.` : "No preparation waste was logged in this period."],
      check: "Ask the kitchen how much was trimmed or discarded, and log it if so.",
    });
    out.push({
      id: "recipe",
      title: "Recipe quantity set incorrectly",
      status: "open",
      evidence: ["Tyll uses the recipe quantities in Recipes and costs. If the kitchen's standard differs, every portion adds to the difference."],
      check: "Check the recipe card in the kitchen against Recipes and costs.",
    });
    out.push({
      id: "staff",
      title: "Staff meals",
      status: "open",
      evidence: ["No staff meals were recorded against this outlet's stock in this period."],
      check: "Ask whether the staff canteen took stock from this kitchen.",
    });
  } else {
    out.push({
      id: "staff",
      title: "Staff consumption",
      status: "open",
      evidence: ["No staff drinks were recorded against this outlet's stock in this period."],
      check: "Ask whether staff drinks are taken from the bar stock.",
    });
  }

  out.push({
    id: "spillage",
    title: wine ? "Spillage, or a bottle that was corked or broken" : bev ? "Spillage or breakage" : "Spoilage or items dropped",
    status: "open",
    evidence: [v.waste + v.breakage > 0 ? `${q(v.waste + v.breakage)} of waste and breakage is recorded and already taken off.` : "No waste or breakage was recorded in this period."],
    check: "If anything was spilled or broken, log it as a late entry for this period below.",
  });

  const countStatus: CauseStatus = Math.abs(v.unexplained) <= v.tolerance ? "supported" : priorAbs !== null && priorAbs < Math.abs(v.unexplained) / 3 ? "against" : "open";
  out.push({
    id: "count",
    title: "Incorrect physical count",
    status: countStatus,
    evidence: [
      wine
        ? `Open bottles are counted to the nearest tenth, so the two counts together can be out by up to ${q(v.tolerance)}.`
        : `The two counts together can be out by up to ${q(v.tolerance)}.`,
      priorAbs !== null
        ? `In the previous ${prior.length} periods the difference averaged ${q(priorAbs)}, so a counting error of ${q(v.unexplained)} would be unusual.`
        : "There are no earlier periods to compare with.",
    ],
    check: "Recount the item now and record the recount below. The figures update straight away.",
  });

  out.push({
    id: "delivery",
    title: "Storeroom issue recorded for more than arrived",
    status: "open",
    evidence: p.issues.length
      ? [`${p.issues.length} issue${p.issues.length === 1 ? "" : "s"} from the main storeroom, ${q(v.received)} in total, ${p.issues.length === 1 ? "is" : "are"} recorded as received at the outlet.`]
      : ["Nothing was issued to the outlet in this period."],
    check: "Check the signed issue notes against what the outlet received.",
  });

  if (wine || !bev) {
    out.push({
      id: "transfer",
      title: "Transfers not recorded",
      status: "open",
      evidence: [p.transfers.length ? `${p.transfers.length} transfer${p.transfers.length === 1 ? " is" : "s are"} recorded.` : "No transfers in or out are recorded for this outlet in this period."],
      check: "Ask whether stock was lent to another outlet or to banqueting.",
    });
  }

  out.push({
    id: "removal",
    title: "Stock taken without authorisation",
    status: "open",
    evidence: [
      "No record can show this. A difference on its own does not show that anything was taken.",
      "Consider it only after the other explanations have been checked.",
    ],
    check: "Review storeroom access and the issue process with the outlet manager.",
  });
  return out;
}

/** Recommended next steps, most useful first. */
export function stepsFor(p: UsagePeriod, v: Variance): string[] {
  const g = ingredientById[p.ingredientId];
  const steps = [`Recount ${plainName(p.ingredientId)} at ${outletById[p.outletId].name} and record the recount here.`];
  if (p.removals.length) steps.push("Open the removed or voided orders and ask whether the items were served.");
  if (isWine(p.ingredientId)) steps.push("Check the pour measure and the standard serving size.");
  else if (g.dept !== "beverage") steps.push(`Weigh a few portions against the recipe for ${p.sales.map((s) => itemById[s.itemId].name).filter((n, i, a) => a.indexOf(n) === i).slice(0, 2).join(" and ")}.`);
  else steps.push("Ask the shift team about complimentary or staff drinks not entered in the POS.");
  steps.push("Log any waste, spillage or breakage that was not recorded.");
  steps.push("Check the storeroom issue notes for the period.");
  if (v.unexplained > 0) steps.push("Record the verified cause and any corrective action, then resolve the case.");
  return steps;
}

/** The product as people say it: "Coca-Cola", not "Coca-Cola cans", where the unit already says cans. */
export const plainName = (ingredientId: string) => (ingredientId === "coke" ? "Coca-Cola" : ingredientById[ingredientId].name);
