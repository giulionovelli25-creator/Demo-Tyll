import { NO_ADJUSTMENTS } from "../domain/variance";
import { describe, expect, it } from "vitest";
import { OUTLETS } from "../data/catalog";
import { HERO_EXCEPTION_ID, getDataset } from "../data/generate";
import { detectPatterns } from "../domain/detect";
import { buildIssues, dailyBriefing } from "../domain/issues";
import { compare, listInvestigations, totalsByOutlet, type Ctx, type Sel } from "../domain/metrics";
import { DEMO_TODAY, presetRange } from "../util";

const data = getDataset();
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ data, waste: data.wasteLogs, counts: data.counts, overrides: [], investigations: {}, adjust: NO_ADJUSTMENTS, ...over });
const ALL = OUTLETS.map((o) => o.id);
const group: Sel = { outletIds: ALL, wholeProperties: ["dxb", "doh"], dept: "all", range: presetRange("week"), currency: "AED" };
const terrace: Sel = { ...group, outletIds: ["dxb-terrace"], wholeProperties: [] };
const patterns = detectPatterns(data.exceptions, DEMO_TODAY);
const rank = { high: 0, medium: 1, low: 2 };

describe("needs attention", () => {
  const issues = buildIssues(ctx(), group, listInvestigations(ctx()), patterns, { includeStock: true });

  it("lists every open investigation once, highest priority first", () => {
    const open = listInvestigations(ctx()).filter((i) => i.status !== "closed");
    expect(issues.filter((i) => i.kind === "investigation")).toHaveLength(open.length);
    for (let k = 1; k < issues.length; k++) expect(rank[issues[k - 1].priority]).toBeLessThanOrEqual(rank[issues[k].priority]);
  });

  it("marks the worked example high priority because it belongs to a repeated pattern", () => {
    expect(issues.find((i) => i.id === HERO_EXCEPTION_ID)?.priority).toBe("high");
  });

  it("adds waste and menu-margin issues backed by the figures", () => {
    const rows = totalsByOutlet(ctx(), group);
    const waste = issues.filter((i) => i.kind === "waste");
    expect(waste.some((i) => i.outletId === "dxb-terrace")).toBe(true);
    for (const w of waste) {
      const r = rows.find((x) => x.outletId === w.outletId)!;
      expect(w.impact).toBeCloseTo(r.now.waste - r.before.waste, 6);
    }
  });

  it("drops a case from the list once it is closed", () => {
    const closed = ctx({ investigations: { [HERO_EXCEPTION_ID]: { status: "closed", outcome: "recovered", recovered: 22, confirmedLoss: 0, notes: [] } } });
    const after = buildIssues(closed, group, listInvestigations(closed), patterns, { includeStock: true });
    expect(after.find((i) => i.id === HERO_EXCEPTION_ID)).toBeUndefined();
    expect(after.length).toBe(issues.length - 1);
  });

  it("keeps an outlet manager's list to their outlet and leaves out property-wide supplier issues", () => {
    const mine = buildIssues(ctx(), terrace, listInvestigations(ctx()), patterns, { includeStock: true, includeSuppliers: false });
    expect(mine.every((i) => i.kind !== "supplier")).toBe(true);
    expect(mine.filter((i) => i.kind === "investigation").every((i) => i.outletId === "dxb-terrace")).toBe(true);
  });
});

describe("daily briefing", () => {
  it("states only figures that come from the comparison", () => {
    const c = compare(ctx(), group);
    const rows = totalsByOutlet(ctx(), group);
    const text = dailyBriefing(c, rows, buildIssues(ctx(), group, listInvestigations(ctx()), patterns, { includeStock: true, rows }), group);
    const change = ((c.now.net - c.before.net) / c.before.net) * 100;
    expect(text).toContain(`Revenue is ${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)}% on the previous 7 days.`);
    expect(text).toContain("Gross margin fell most at The Terrace");
  });
});
