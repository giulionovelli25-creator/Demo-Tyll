import { describe, expect, it } from "vitest";
import { getDataset, getOutletStock } from "../data/generate";
import { latestPeriods } from "../data/outlet-stock";
import { causesFor, needsCase, periodVariance, summaryFor } from "../domain/variance";
import type { RecipeChange, Recount, UsagePeriod, WasteLog } from "../types";
import { DEMO_TODAY } from "../util";

const latest = latestPeriods(getOutletStock().periods);
const find = (outletId: string, ingredientId: string) => latest.find((p) => p.outletId === outletId && p.ingredientId === ingredientId)!;
const coke = find("dxb-terrace", "coke");
const wine = find("dxb-lobby", "wine");
const beef = find("dxb-terrace", "wagyu");
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("worked examples", () => {
  it("Coca-Cola: 40 opening, 10 received, 12 counted, 30 sold, 8 unexplained", () => {
    const v = periodVariance(coke);
    near(v.opening, 40);
    near(v.received, 10);
    near(v.closing, 12);
    near(v.actual, 38);
    near(v.expected, 30);
    near(v.waste + v.breakage, 0);
    near(v.transfers, 0);
    near(v.unexplained, 8);
    expect(v.significant).toBe(true);
    // The Coke removed from the hero order after it was sent to the bar falls inside the period.
    expect(coke.removals.some((r) => r.orderId === "TRC-1013-198" && r.itemId === "coke")).toBe(true);
    expect(summaryFor(coke, v)).toContain("8 cans of Coca-Cola remain unexplained");
  });

  it("Wine: 20 glasses at 150 ml, 3,750 ml used, 750 ml unexplained, beyond counting uncertainty", () => {
    const v = periodVariance(wine);
    expect(v.soldUnits).toBe(20);
    near(v.expected, 3);
    near(v.actual, 3.75);
    near(v.unexplained, 0.75);
    expect(v.tolerance).toBeCloseTo(0.15, 6);
    expect(v.significant).toBe(true);
    // Overpouring is listed as something to check, never as a finding.
    expect(causesFor(wine, v).find((c) => c.id === "overpour")!.status).toBe("open");
  });

  it("Wagyu beef: 80 burgers at 180 g, 16.2 kg used, 1.8 kg unexplained, valued at cost", () => {
    const v = periodVariance(beef);
    expect(beef.sales.filter((s) => s.itemId === "burger").reduce((n, s) => n + s.units, 0)).toBe(80);
    near(v.expected, 14.4);
    near(v.actual, 16.2);
    near(v.unexplained, 1.8);
    near(v.value, 1.8 * beef.unitCost);
  });

  it("opens cases for the three examples and not for ordinary counting noise", () => {
    const cases = getDataset().exceptions.filter((e) => e.type === "usage_variance");
    const keys = cases.map((e) => `${e.outletId}|${e.ingredientId}`);
    expect(keys).toEqual(expect.arrayContaining(["dxb-terrace|coke", "dxb-lobby|wine", "dxb-terrace|wagyu"]));
    expect(cases.length).toBeLessThanOrEqual(8);
    expect(latest.filter((p) => needsCase(periodVariance(p))).length).toBe(cases.length);
  });
});

describe("corrections", () => {
  const waste = (p: UsagePeriod, qty: number, extra: Partial<WasteLog> = {}): WasteLog => ({ id: `W-${qty}`, outletId: p.outletId, date: p.to.date, ingredientId: p.ingredientId, qty, reason: "spoilage", by: "x", synced: true, seq: 1, ...extra });

  it("a recount replaces the closing count without losing the original", () => {
    const recount: Recount = { id: "R1", checkId: coke.to.id, counted: 14, reason: "Two cans were in the back fridge", by: "u-rm", date: DEMO_TODAY, seq: 1 };
    const v = periodVariance(coke, { recounts: [recount], recipes: [], waste: [] });
    near(v.closing, 14);
    expect(v.closingWas).toBe(12);
    near(v.unexplained, 6);
  });

  it("waste logged for the period reduces the unexplained quantity once, and an unsynced entry does not", () => {
    near(periodVariance(coke, { recounts: [], recipes: [], waste: [waste(coke, 2)] }).unexplained, 6);
    near(periodVariance(coke, { recounts: [], recipes: [], waste: [waste(coke, 2, { synced: false })] }).unexplained, 8);
    // A late entry names its period, so it is not also counted in another period that covers the same date.
    const late = waste(wine, 0.15, { date: "2026-10-12", periodId: wine.id });
    near(periodVariance(wine, { recounts: [], recipes: [], waste: [late] }).unexplained, 0.6);
    near(periodVariance(coke, { recounts: [], recipes: [], waste: [{ ...late, outletId: coke.outletId, ingredientId: "coke" }] }).unexplained, 8);
    // A prepared dish converts through its recipe: two burgers carry 360 g of beef.
    near(periodVariance(beef, { recounts: [], recipes: [], waste: [{ ...waste(beef, 2), ingredientId: undefined, itemId: "burger" }] }).unexplained, 1.44);
  });

  it("a corrected standard pour changes expected use from its start date", () => {
    const change: RecipeChange = { id: "P1", itemId: "wine", ingredientId: "wine", qty: 0.1875, from: "2026-10-01", reason: "Menu serves 187.5 ml", by: "u-fnb", seq: 1 };
    const v = periodVariance(wine, { recounts: [], recipes: [change], waste: [] });
    near(v.expected, 3.75);
    near(v.unexplained, 0);
    expect(v.significant).toBe(false);
    near(periodVariance(wine, { recounts: [], recipes: [{ ...change, from: "2026-10-13" }], waste: [] }).expected, 3);
  });
});
