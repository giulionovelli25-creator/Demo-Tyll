// One prioritised list of what needs attention, and a short briefing built from the same figures.
import { itemById, outletById, propertyById, supplierById } from "../data/catalog";
import type { Investigation } from "../types";
import { DEMO_TODAY, diffDays, fmtPct, fxRate } from "../util";
import { REMOVAL_TYPES, type Pattern } from "./detect";
import { deliveryOvercharge } from "./inventory";
import { exceptionInSel, itemPerformance, totalsByOutlet, type Compared, type Ctx, type OutletRow, type Sel } from "./metrics";

export type Priority = "high" | "medium" | "low";
export type IssueKind = "investigation" | "waste" | "margin" | "supplier";

export interface Issue {
  id: string;
  kind: IssueKind;
  title: string;
  location: string;
  outletId?: string;
  /** Money involved, in the selection's currency. Null where it cannot be measured. */
  impact: number | null;
  priority: Priority;
  assignee?: string;
  status: string;
  href: string;
}

const RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** Thresholds are in AED and converted for other currencies. */
export const ISSUE_RULES = {
  highImpact: 300,
  mediumImpact: 60,
  wasteRise: 0.3,
  wasteRiseMin: 200,
  marginFallPts: 2,
  marginMinUnits: 20,
  supplierDays: 3,
};

const where = (outletId: string | undefined, propertyId: string) =>
  outletId ? `${outletById[outletId].name}, ${propertyById[propertyId].city}` : propertyById[propertyId].name;

export function buildIssues(
  ctx: Ctx,
  sel: Sel,
  investigations: readonly Investigation[],
  patterns: readonly Pattern[],
  opts: { includeStock: boolean; includeSuppliers?: boolean; rows?: OutletRow[] },
): Issue[] {
  const aed = fxRate("AED", sel.currency);
  const out: Issue[] = [];

  for (const i of investigations) {
    if (i.status === "closed" || !exceptionInSel(i, sel)) continue;
    const impact = i.exposure * fxRate(propertyById[i.propertyId].currency, sel.currency);
    const patterned = REMOVAL_TYPES.includes(i.type) && patterns.some((p) => p.exceptionIds.includes(i.id));
    const overdue = !!i.deadline && i.deadline < DEMO_TODAY;
    const priority: Priority = impact >= ISSUE_RULES.highImpact * aed || (patterned && i.status === "new") || overdue ? "high" : impact >= ISSUE_RULES.mediumImpact * aed ? "medium" : "low";
    out.push({
      id: i.id, kind: "investigation", title: i.headline, location: where(i.outletId, i.propertyId), outletId: i.outletId, impact, priority,
      assignee: i.assigneeId, status: overdue ? "Overdue" : { new: "New", assigned: "Assigned", in_review: "In review", closed: "Closed" }[i.status],
      href: `/investigations/${i.id}`,
    });
  }

  if (opts.includeStock) {
    const rows = opts.rows ?? totalsByOutlet(ctx, sel);
    for (const r of rows) {
      const rise = r.now.waste - r.before.waste;
      if (r.before.waste > 0 && rise / r.before.waste >= ISSUE_RULES.wasteRise && rise >= ISSUE_RULES.wasteRiseMin * aed) {
        out.push({
          id: `waste-${r.outletId}`, kind: "waste", title: `Food waste up ${fmtPct(rise / r.before.waste, 0)} on the previous period`,
          location: where(r.outletId, outletById[r.outletId].propertyId), outletId: r.outletId, impact: rise,
          priority: rise >= 1000 * aed ? "high" : "medium", status: "Open", href: "/stock?tab=waste",
        });
      }
    }
    const props = opts.includeSuppliers === false ? [] : [...new Set(sel.outletIds.map((id) => outletById[id].propertyId))];
    for (const d of ctx.data.deliveries) {
      if (d.status !== "delivered" || !props.includes(d.propertyId) || diffDays(DEMO_TODAY, d.date) >= ISSUE_RULES.supplierDays) continue;
      const over = deliveryOvercharge(d) * fxRate(propertyById[d.propertyId].currency, sel.currency);
      if (over <= 0) continue;
      out.push({
        id: `supplier-${d.id}`, kind: "supplier", title: `${supplierById[d.supplierId].name} invoiced more than was delivered or agreed`,
        location: propertyById[d.propertyId].name, impact: over, priority: over >= ISSUE_RULES.highImpact * aed ? "medium" : "low", status: "Open", href: "/stock?tab=suppliers",
      });
    }
  }

  const items = itemPerformance(ctx, sel)
    .filter((r) => r.marginBefore !== null && r.units >= ISSUE_RULES.marginMinUnits && (r.margin - r.marginBefore) * 100 <= -ISSUE_RULES.marginFallPts)
    .map((r) => ({ r, lost: (r.marginBefore! - r.margin) * r.net }))
    .sort((a, b) => b.lost - a.lost)
    .slice(0, 3);
  for (const { r, lost } of items) {
    out.push({
      id: `margin-${r.itemId}`, kind: "margin", title: `${itemById[r.itemId].name} margin down ${((r.marginBefore! - r.margin) * 100).toFixed(1)} pts`,
      location: sel.outletIds.length === 1 ? outletById[sel.outletIds[0]].name : "Menu", impact: lost, priority: lost >= 1000 * aed ? "high" : "medium",
      status: "Open", href: `/menu/${r.itemId}`,
    });
  }

  return out.sort((a, b) => RANK[a.priority] - RANK[b.priority] || (b.impact ?? 0) - (a.impact ?? 0));
}

const periodWords = (sel: Sel) => {
  const days = diffDays(sel.range.to, sel.range.from) + 1;
  return days === 1 ? (sel.range.to === DEMO_TODAY ? "yesterday at the same time" : "the day before") : `the previous ${days} days`;
};

/** Three or four short sentences, each taken from a figure shown elsewhere on the page. */
export function dailyBriefing(c: Compared, rows: OutletRow[], issues: Issue[], sel: Sel, extra?: string): string {
  const parts: string[] = [];
  if (c.before.net > 0) {
    const change = (c.now.net - c.before.net) / c.before.net;
    parts.push(Math.abs(change) < 0.005 ? `Revenue is level with ${periodWords(sel)}.` : `Revenue is ${change > 0 ? "up" : "down"} ${Math.abs(change * 100).toFixed(1)}% on ${periodWords(sel)}.`);
  }
  if (rows.length > 1) {
    const worst = [...rows].filter((r) => r.before.net > 0).sort((a, b) => a.now.gpMargin - a.before.gpMargin - (b.now.gpMargin - b.before.gpMargin))[0];
    const fall = worst ? (worst.before.gpMargin - worst.now.gpMargin) * 100 : 0;
    if (fall >= 0.5) parts.push(`Gross margin fell most at ${outletById[worst.outletId].name}, down ${fall.toFixed(1)} pts.`);
  } else {
    const move = (c.now.gpMargin - c.before.gpMargin) * 100;
    if (Math.abs(move) >= 0.5) parts.push(`Gross margin is ${move > 0 ? "up" : "down"} ${Math.abs(move).toFixed(1)} pts.`);
  }
  const waste = issues.find((i) => i.kind === "waste");
  if (waste && waste.outletId) parts.push(`Food waste rose at ${outletById[waste.outletId].name}.`);
  const high = issues.filter((i) => i.priority === "high").length;
  if (extra) parts.push(extra);
  else if (high > 0) parts.push(`${high} high-priority issue${high === 1 ? " needs" : "s need"} attention.`);
  return parts.join(" ");
}

export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
export const KIND_LABEL: Record<IssueKind, string> = { investigation: "Investigation", waste: "Waste", margin: "Menu margin", supplier: "Supplier" };
