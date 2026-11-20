// Bought against used, per item: the rules, the planted Coca-Cola story, the totals and who may see it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-bu-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { BOUGHT_USED_RULES, boughtAgainstUsed, boughtQty, boughtUsedExceptions, boughtUsedPeriod, summarise } = await import("../domain/bought-used");
const { stockPosition } = await import("../domain/inventory");
const { getDataset } = await import("../data/generate");
const { demoCases } = await import("../data/demo-cases");
const { BOUGHT_STORY, BOUGHT_STORY_EXCEPTION_ID } = await import("../data/constants");
const { boughtUsedCases, boughtUsedFor, checkRows, clearCheck, confirmCheck, countsNow, markChecked, stateFromCheck } = await import("../server/bought-used");
const { snapshotFor } = await import("../server/snapshot");
const { resetDemo } = await import("../server/demo");
const { loadStore } = await import("../server/purchasing-store");
const { userById } = await import("../data/catalog");
const { can } = await import("../domain/access");
const { activeItem } = await import("../nav");
const { TYPE_LABEL, datedFlags } = await import("../domain/detect");
const { weekSums } = await import("../domain/trends");
const { explain } = await import("../domain/explain");
const { computeTotals } = await import("../domain/metrics");
const { NO_ADJUSTMENTS } = await import("../domain/variance");
const { DEMO_TODAY, addDays, presetRange, rel } = await import("../util");
type Delivery = import("../types").Delivery;
type DayItem = import("../types").DayItem;
type WasteLog = import("../types").WasteLog;
type Ctx = import("../domain/metrics").Ctx;
type Sel = import("../domain/metrics").Sel;

const U = (id: string) => userById[id];
const { from, to } = boughtUsedPeriod();

// A small, hand-made month for one item: Coca-Cola cans at €1.35, sold as "coke" (one can a unit).
const delivery = (date: string, qty: number, extra: Partial<Delivery> = {}): Delivery => ({
  id: `D-${date}-${qty}`, propertyId: "lis", supplierId: "bev", date, status: "delivered",
  lines: [{ ingredientId: "coke", ordered: qty, delivered: qty, invoiced: qty, poPrice: 1.35, invoicePrice: 1.35 }], ...extra,
});
const sold = (date: string, units: number): DayItem => ({ outletId: "lis-terrace", date, itemId: "coke", late: false, units, gross: units * 5, comps: 0, discounts: 0, refunds: 0 });
const waste = (date: string, qty: number, over: Partial<WasteLog> = {}): WasteLog => ({ id: `W-${date}-${qty}`, outletId: "lis-lobby", date, ingredientId: "coke", qty, reason: "damaged", by: "AZU-S9", synced: true, seq: 1, ...over });
const coke = (deliveries: Delivery[], dayItems: DayItem[], wasteLogs: WasteLog[] = [], transfers: import("../types").Transfer[] = []) =>
  boughtAgainstUsed({ propertyId: "lis", from, to, deliveries, dayItems, waste: wasteLogs, transfers, standardCost: () => 1.5 }).find((r) => r.ingredientId === "coke")!;
// Four deliveries of 240 cans; the last one, today, is the shelf allowance.
const month = [delivery(addDays(to, -21), 240), delivery(addDays(to, -14), 240), delivery(addDays(to, -7), 240), delivery(to, 240)];

describe("bought against used rules", () => {
  it("flags a gap larger than the last delivery, a share of use and the money threshold", () => {
    const r = coke(month, [sold(addDays(to, -3), 600)]);
    expect(r.bought).toBe(960);
    expect(r.used).toBe(600);
    expect(r.gap).toBe(360);
    expect(r.lastDelivery).toBe(240);
    expect(r.share).toBeCloseTo(0.6, 6);
    expect(r.gapValue).toBeCloseTo(360 * 1.35, 2);
    // What is at risk is the part beyond what today's delivery could leave on the shelf.
    expect(r.excess).toBe(120);
    expect(r.excessValue).toBeCloseTo(120 * 1.35, 2);
    expect(r.flagged).toBe(true);
    expect(boughtUsedExceptions([r])[0].exposure).toBeCloseTo(120 * 1.35, 2);
    expect(summarise([r]).flaggedValue).toBeCloseTo(120 * 1.35, 2);
  });

  it("does not flag when the whole gap is worth the threshold but the part beyond the last delivery is not", () => {
    // 960 bought, 650 used: 310 cans (EUR 418) over, 70 of them beyond today's 240 (EUR 94.50).
    const r = coke(month, [sold(addDays(to, -3), 650)]);
    expect(r.gapValue).toBeGreaterThan(BOUGHT_USED_RULES.minValue);
    expect(r.excess).toBe(70);
    expect(r.excessValue).toBeLessThan(BOUGHT_USED_RULES.minValue);
    expect(r.flagged).toBe(false);
  });

  it("does not flag what the last delivery could leave on the shelf", () => {
    // 960 bought, 730 used: 230 cans left, under the 240 of today's delivery, though 31% of use and worth €310.
    const r = coke(month, [sold(addDays(to, -3), 730)]);
    expect(r.gap).toBe(230);
    expect(r.gapValue).toBeGreaterThan(BOUGHT_USED_RULES.minValue);
    expect(r.flagged).toBe(false);
  });

  it("does not flag a gap below the share of use, or below the money threshold", () => {
    // Share: 3,000 bought, 2,800 used, 200 left (7%) with a last delivery of only 100.
    const big = [delivery(addDays(to, -20), 2900), delivery(addDays(to, -2), 100)];
    const r1 = coke(big, [sold(addDays(to, -1), 2800)]);
    expect(r1.gap).toBe(200);
    expect(r1.share).toBeLessThan(BOUGHT_USED_RULES.minShare);
    expect(r1.flagged).toBe(false);
    // Money: 60 cans over (€81) with a last delivery of 24.
    const small = [delivery(addDays(to, -20), 200), delivery(addDays(to, -2), 24)];
    const r2 = coke(small, [sold(addDays(to, -1), 164)]);
    expect(r2.gap).toBe(60);
    expect(r2.share).toBeGreaterThan(BOUGHT_USED_RULES.minShare);
    expect(r2.gapValue).toBeLessThan(BOUGHT_USED_RULES.minValue);
    expect(r2.flagged).toBe(false);
  });

  it("does not flag using more than was bought: stock went down, and a count shows it", () => {
    const r = coke(month, [sold(addDays(to, -3), 1200)]);
    expect(r.gap).toBe(-240);
    expect(r.flagged).toBe(false);
    expect(summarise([r]).drawnDown).toBe(1);
  });

  it("takes logged waste and transfers out off the gap, and adds transfers in", () => {
    const base = coke(month, [sold(addDays(to, -3), 600)]);
    const withWaste = coke(month, [sold(addDays(to, -3), 600)], [waste(addDays(to, -2), 30)]);
    expect(withWaste.gap).toBe(base.gap - 30);
    expect(withWaste.waste).toBe(30);
    const moved = coke(month, [sold(addDays(to, -3), 600)], [], [
      { id: "T-a", propertyId: "lis", ingredientId: "coke", date: addDays(to, -1), qty: 48, direction: "out", counterparty: "Banqueting" },
      { id: "T-b", propertyId: "lis", ingredientId: "coke", date: addDays(to, -1), qty: 24, direction: "in", counterparty: "Banqueting" },
    ]);
    expect(moved.gap).toBe(base.gap - 48 + 24);
    // A move between the hotel's own outlets changes nothing for the whole hotel.
    const inside = coke(month, [sold(addDays(to, -3), 600)], [], [
      { id: "T-c", propertyId: "lis", ingredientId: "coke", date: addDays(to, -1), qty: 48, direction: "in", counterparty: "Banqueting", outletId: "lis-banquets" },
      { id: "T-d", propertyId: "lis", ingredientId: "coke", date: addDays(to, -1), qty: 24, direction: "out", counterparty: "Bar Azulejo", outletId: "lis-lobby" },
    ]);
    expect(inside.gap).toBe(base.gap);
    expect(inside.movedIn + inside.movedOut).toBe(0);
  });

  it("writes a month of wine in litres and bottles, and keeps millilitres for a glass", () => {
    expect(boughtQty(34.8, "wine")).toBe("34.8 L, about 46 bottles");
    expect(boughtQty(0.75, "wine")).toBe("750 ml");
    expect(boughtQty(496, "coke")).toBe("496 cans");
  });

  it("leaves out what does not belong to the period, the hotel or a recorded fact", () => {
    const outside = [...month, delivery(addDays(from, -1), 500), delivery(addDays(to, 1), 500, { status: "expected" }), delivery(addDays(to, -5), 500, { propertyId: "other" })];
    expect(coke(outside, [sold(addDays(to, -3), 600)]).bought).toBe(960);
    // A waste entry still on a phone, not yet synchronised, does not count.
    expect(coke(month, [sold(addDays(to, -3), 600)], [waste(addDays(to, -2), 30, { synced: false })]).waste).toBe(0);
    // Sales before the period do not count either.
    expect(coke(month, [sold(addDays(from, -1), 600)]).sold).toBe(0);
  });

  it("only compares food and drink: glassware and hotel supplies have no recipe", () => {
    const d = getDataset();
    const rows = checkRows("lis");
    expect(rows.length).toBeGreaterThan(30);
    expect(rows.some((r) => ["wineglass", "plate", "amenity", "towel"].includes(r.ingredientId))).toBe(false);
    expect(d.deliveries.length).toBeGreaterThan(0);
  });

  it("values the gap at the price paid, or the standard cost when nothing was invoiced", () => {
    const paid = coke([delivery(addDays(to, -10), 600, { lines: [{ ingredientId: "coke", ordered: 600, delivered: 600, invoiced: 600, poPrice: 1.35, invoicePrice: 1.5 }] }), delivery(to, 24)], [sold(to, 300)]);
    expect(paid.unitCost).toBeCloseTo((600 * 1.5 + 24 * 1.35) / 624, 6);
    const free = coke([delivery(addDays(to, -10), 600, { lines: [{ ingredientId: "coke", ordered: 600, delivered: 600, invoiced: 0, poPrice: 1.35, invoicePrice: 1.35 }] })], [sold(to, 300)]);
    expect(free.unitCost).toBe(1.5);
  });

  it("adds up day by day to the same gap, so the trend ends where the list does", () => {
    const r = coke(month, [sold(addDays(to, -3), 400), sold(addDays(to, -1), 200)], [waste(addDays(to, -2), 30)]);
    expect(Object.values(r.byDay).reduce((s, v) => s + v, 0)).toBeCloseTo(r.gap, 9);
  });
});

describe("the Coca-Cola story", () => {
  it("is the largest flagged gap: two extra cases came with every drinks delivery for three weeks", () => {
    const rows = checkRows("lis");
    const flagged = rows.filter((r) => r.flagged);
    expect(flagged[0].ingredientId).toBe(BOUGHT_STORY.ingredientId);
    const c = flagged[0];
    expect(c.gap).toBeGreaterThan(c.lastDelivery + 2 * 24);
    expect(c.share).toBeGreaterThan(0.2);
    expect(c.excessValue).toBeGreaterThan(150);
    // The Banqueting move (T-3) is inside the hotel, so it is not counted as stock coming in.
    expect(c.movedIn).toBe(0);
    // Only a few items stand out; the rest move with sales.
    expect(flagged.length).toBeLessThanOrEqual(4);
    const ex = boughtUsedExceptions(rows).find((e) => e.ingredientId === "coke")!;
    expect(ex.id).toBe(BOUGHT_STORY_EXCEPTION_ID);
  });

  it("is flagged on every business day of a week, whatever the delivery days", async () => {
    for (let i = 0; i < 7; i++) {
      vi.resetModules();
      process.env.TYLL_DEMO_DATE = addDays("2026-11-16", i);
      const g = await import("../data/generate");
      const b = await import("../domain/bought-used");
      const p = await import("../domain/pricing");
      const d = g.getDataset();
      const period = b.boughtUsedPeriod();
      const rows = b.boughtAgainstUsed({ propertyId: "lis", ...period, deliveries: d.deliveries, dayItems: d.dayItems, waste: d.wasteLogs, transfers: d.transfers, standardCost: (id) => p.ingredientCostAt(id, period.to) });
      const c = rows.find((r) => r.ingredientId === "coke")!;
      expect(c.flagged, period.to).toBe(true);
      expect(rows.filter((r) => r.flagged)[0].ingredientId, period.to).toBe("coke");
      // The part beyond the last delivery stays well above the threshold, whichever day of the week it is.
      expect(c.excessValue, period.to).toBeGreaterThan(150);
      expect(c.excessValue, period.to).toBeLessThan(650);
    }
    vi.resetModules();
    process.env.TYLL_DEMO_DATE = "2026-10-13";
  });

  it("adds the standing order's extra cases to every drinks delivery of the story weeks", () => {
    // Drinks arrive on Tuesdays and Fridays. Each one in the story weeks carries at least the three extra cases.
    const lines = getDataset().deliveries.filter((d) => d.propertyId === "lis" && d.supplierId === "bev" && d.status === "delivered" && d.date >= rel(BOUGHT_STORY.fromDay)).flatMap((d) => d.lines.filter((l) => l.ingredientId === "coke"));
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(lines.every((l) => l.delivered >= BOUGHT_STORY.extraPerDelivery)).toBe(true);
  });

  it("agrees with the count records: the weekly counts find the extra cases on the shelf, and Missing stock is unchanged", () => {
    const d = getDataset();
    const storyDeliveries = d.deliveries.filter((x) => x.propertyId === "lis" && x.supplierId === "bev" && x.status === "delivered" && x.date >= rel(BOUGHT_STORY.fromDay));
    const extrasBy = (date: string) => storyDeliveries.filter((x) => x.date <= date).length * BOUGHT_STORY.extraPerDelivery;
    const counts = d.counts.filter((c) => c.propertyId === "lis" && c.ingredientId === "coke");
    const inStory = counts.filter((c) => extrasBy(c.date) > 0);
    expect(inStory.length).toBeGreaterThanOrEqual(2);
    for (const c of counts) {
      // The book stock includes the extra cases delivered so far, and the count finds them: the shortfall at each count
      // stays the usual few dozen cans, before and during the story.
      expect(c.expected, c.date).toBeGreaterThanOrEqual(extrasBy(c.date));
      expect(c.counted, c.date).toBeGreaterThanOrEqual(extrasBy(c.date));
      expect(c.expected - c.counted, c.date).toBeLessThan(60);
    }
    // So the stock estimate holds at least the cans the flag counts beyond the last delivery: "Counted, on the shelf" is
    // what a count would find.
    const row = checkRows("lis").find((r) => r.ingredientId === "coke")!;
    const est = stockPosition("lis", { counts: d.counts, deliveries: d.deliveries, dayItems: d.dayItems, waste: d.wasteLogs, transfers: d.transfers, recipes: [] }).find((r) => r.ingredientId === "coke")!;
    expect(est.estimated).toBeGreaterThan(row.excess);
  });
});

describe("the flag", () => {
  const flags = boughtUsedExceptions(checkRows("lis"));
  const story = flags.find((e) => e.id === BOUGHT_STORY_EXCEPTION_ID)!;

  it("is a hotel wide estimate, dated today, valued at the gap, with its figures", () => {
    expect(TYPE_LABEL.bought_not_used).toBe("Bought more than used");
    expect(story.type).toBe("bought_not_used");
    expect(story.outletId).toBeUndefined();
    expect(story.orderId).toBeUndefined();
    expect(story.date).toBe(DEMO_TODAY);
    expect(story.basis).toBe("estimate");
    const row = checkRows("lis").find((r) => r.ingredientId === "coke")!;
    expect(story.exposure).toBe(row.excessValue);
    expect(story.exposure).toBeCloseTo((row.gap - row.lastDelivery) * row.unitCost, 1);
    expect(story.boughtUsed!.gap).toBe(row.gap);
    // The headline ends on the quantity the amount at risk values, so the two agree when someone does the sum.
    const m = story.headline.match(/^Coca-Cola: ([\d,]+) cans more bought than used in 30 days, ([\d,]+) cans beyond the last delivery$/);
    expect(m).not.toBeNull();
    const [whole, beyond] = [Number(m![1].replace(/,/g, "")), Number(m![2].replace(/,/g, ""))];
    expect(whole).toBe(Math.round(row.gap));
    expect(beyond).toBe(Math.round(row.excess));
    expect(beyond * row.unitCost).toBeCloseTo(story.exposure, 0);
    expect(story.comparedWith).toContain("received from suppliers");
  });

  it("explains itself from its figures, with possible causes and no blame", () => {
    const ex = explain(story, getDataset(), [], []);
    expect(ex.facts.join(" ")).toContain("received from suppliers");
    expect(ex.message).toContain("estimate until a count confirms it");
    expect(ex.possibleCauses.length).toBeGreaterThanOrEqual(4);
    expect(`${ex.message} ${ex.possibleCauses.join(" ")}`).not.toMatch(/theft|stole|fraud/i);
  });

  it("starts new, closes when a check settles it, and stays in review when nothing was found", () => {
    expect(stateFromCheck(undefined).status).toBe("new");
    const base = { id: "BUC-1", propertyId: "lis", ingredientId: "coke", date: DEMO_TODAY, by: "u-fnb", role: "fnb_director" as const, at: "", gap: 1, gapValue: 1 };
    const shelf = stateFromCheck({ ...base, outcome: "on_shelf" });
    expect(shelf).toMatchObject({ status: "closed", outcome: "legitimate", confirmedLoss: 0, recovered: 0, closedBy: "u-fnb" });
    expect(stateFromCheck({ ...base, outcome: "no_recipe" }).status).toBe("closed");
    expect(stateFromCheck({ ...base, outcome: "not_found" }).status).toBe("in_review");
  });

  it("a settling check from someone who may not close flags waits in review until a manager confirms it", () => {
    const buy = { id: "BUC-2", propertyId: "lis", ingredientId: "coke", date: DEMO_TODAY, by: "u-buy", role: "purchasing" as const, at: "", gap: 1, gapValue: 1 };
    for (const outcome of ["on_shelf", "no_recipe"] as const) {
      const st = stateFromCheck({ ...buy, outcome });
      expect(st.status, outcome).toBe("in_review");
      expect(st.outcome, outcome).toBeUndefined();
      expect(st.closedBy, outcome).toBeUndefined();
    }
    const confirmed = stateFromCheck({ ...buy, outcome: "on_shelf", confirmedBy: "u-fnb", confirmedRole: "fnb_director" });
    expect(confirmed).toMatchObject({ status: "closed", outcome: "legitimate", closedBy: "u-fnb" });
  });
});

describe("totals reconcile", () => {
  const d = getDataset();
  const ctx = (exceptions: import("../types").Exception[], seed: Record<string, import("../types").InvestigationState>): Ctx => ({
    data: { ...d, exceptions: [...d.exceptions, ...exceptions], seedInvestigations: { ...d.seedInvestigations, ...seed } },
    waste: d.wasteLogs, counts: d.counts, overrides: [], investigations: {}, adjust: NO_ADJUSTMENTS,
  });
  const sel: Sel = { outletIds: ["lis-terrace", "lis-lobby", "lis-banquets", "lis-ird"], wholeProperties: ["lis"], dept: "all", range: presetRange("week"), currency: "EUR" };

  it("the page's flagged total is the sum of the open flags, and the trend ends on it", () => {
    const view = boughtUsedFor(U("u-fnb"), "lis");
    if (!view.ok) throw new Error(view.error);
    const cases = boughtUsedCases(["lis"]);
    expect(cases.exceptions.map((e) => e.ingredientId)).toEqual(view.rows.filter((r) => r.flagged).map((r) => r.ingredientId));
    expect(view.summary.flaggedValue).toBeCloseTo(cases.exceptions.reduce((s, e) => s + e.exposure, 0), 2);
    expect(view.trend.at(-1)!.value).toBeCloseTo(view.summary.flaggedValue, 0);
    expect(view.rows.filter((r) => r.flagged).every((r) => r.flagId && cases.exceptions.some((e) => e.id === r.flagId))).toBe(true);
  });

  it("open flags and value at risk include the gaps; flags per 1,000 orders do not, as no bill is involved", () => {
    const { exceptions, seed } = boughtUsedCases(["lis"]);
    const before = computeTotals(ctx([], {}), sel);
    const after = computeTotals(ctx(exceptions, seed), sel);
    expect(after.openCases - before.openCases).toBe(exceptions.length);
    expect(after.flaggedCases - before.flaggedCases).toBe(exceptions.length);
    expect(after.potentialLoss - before.potentialLoss).toBeCloseTo(exceptions.reduce((s, e) => s + e.exposure, 0), 2);
    expect(after.adjustments).toBe(before.adjustments);
    // Choosing one outlet in the top bar leaves a hotel wide flag out, like minibar charges.
    const one = { ...sel, outletIds: ["lis-terrace"], wholeProperties: [] };
    expect(computeTotals(ctx(exceptions, seed), one).openCases).toBe(computeTotals(ctx([], {}), one).openCases);
  });

  it("the flags page and the Money Back List count the same flags this week, from one shared rule", () => {
    const { exceptions } = boughtUsedCases(["lis"]);
    const all = [...d.exceptions, ...exceptions];
    const dated = datedFlags(all);
    expect(dated.some((e) => e.type === "bought_not_used")).toBe(false);
    expect(dated.length).toBe(all.length - exceptions.length);
    const week = weekSums(dated, (e) => e.date, () => 1);
    expect(week.now).toBe(weekSums(d.exceptions, (e) => e.date, () => 1).now);
    // Both pages take their per day chart and New this week from the same helper, never a filter of their own.
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    // Simplify pass: the Money Back List body moved into src/components/money/case-list.tsx, shown inside Flagged transactions.
    for (const f of ["src/app/money/page.tsx", "src/components/money/case-list.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("datedFlags(");
      expect(src, f).not.toContain('type !== "bought_not_used"');
      expect(src, f).not.toMatch(/byDay\((inScope|inSel),/);
      expect(src, f).not.toMatch(/weekSums\((inScope|inSel),/);
    }
  });

  it("the public demo keeps every flag the check lists, and still shows at most twelve open", () => {
    const { exceptions, seed } = boughtUsedCases(["lis"]);
    const all = { ...d.seedInvestigations, ...seed };
    const kept = demoCases([...d.exceptions, ...exceptions], all);
    for (const e of exceptions) expect(kept.some((k) => k.id === e.id)).toBe(true);
    expect(kept.filter((e) => e.propertyId === "lis" && all[e.id]?.status !== "closed").length).toBeLessThanOrEqual(12);
  });
});

describe("who may see it, and checks saved on the server", () => {
  it("is for roles that see the whole hotel: F&B director, general manager, controller, owner and purchasing", () => {
    for (const id of ["u-fnb", "u-gm", "u-fc", "u-owner", "u-buy"]) expect(boughtUsedFor(U(id), "lis").ok, id).toBe(true);
    for (const id of ["u-chef", "u-emp", "u-rm", "u-store"]) {
      const r = boughtUsedFor(U(id), "lis");
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    }
    expect(can(U("u-rm"), "stock.boughtUsed")).toBe(false);
    expect(boughtUsedFor(U("u-fnb"), "nowhere").ok).toBe(false);
  });

  it("sends the flags with the snapshot only to roles that see flags for the whole hotel", () => {
    expect(snapshotFor(U("u-fnb")).exceptions.some((e) => e.id === BOUGHT_STORY_EXCEPTION_ID)).toBe(true);
    for (const id of ["u-buy", "u-chef", "u-rm", "u-emp"]) expect(snapshotFor(U(id)).exceptions.some((e) => e.type === "bought_not_used"), id).toBe(false);
  });

  it("checks validate, save with who did it, close the flag for everyone, and can be taken back", () => {
    const bad = [
      markChecked(U("u-chef"), { propertyId: "lis", ingredientId: "coke", outcome: "on_shelf" }),
      markChecked(U("u-fnb"), { propertyId: "lis", ingredientId: "nothing", outcome: "on_shelf" }),
      markChecked(U("u-fnb"), { propertyId: "lis", ingredientId: "coke", outcome: "lost" }),
      markChecked(U("u-fnb"), { propertyId: "lis", ingredientId: "berries", outcome: "on_shelf" }),
    ];
    expect(bad.map((r) => (r.ok ? 200 : r.status))).toEqual([403, 400, 400, 400]);

    const r = markChecked(U("u-fnb"), { propertyId: "lis", ingredientId: "coke", outcome: "on_shelf", note: "18 cases in the bar store" });
    if (!r.ok) throw new Error(r.error);
    expect(r.check).toMatchObject({ by: "u-fnb", role: "fnb_director", outcome: "on_shelf", note: "18 cases in the bar store", date: DEMO_TODAY });
    expect(loadStore().boughtUsedChecks).toHaveLength(1);
    expect(snapshotFor(U("u-fnb")).seedInvestigations[BOUGHT_STORY_EXCEPTION_ID].status).toBe("closed");
    const view = boughtUsedFor(U("u-fnb"), "lis");
    if (!view.ok) throw new Error(view.error);
    expect(view.summary.checkedFlagged).toBe(1);
    expect(view.rows.find((x) => x.ingredientId === "coke")!.checkState).toBe("closed");

    // A second check of the same item replaces the first.
    const again = markChecked(U("u-fnb"), { propertyId: "lis", ingredientId: "coke", outcome: "not_found" });
    if (!again.ok) throw new Error(again.error);
    expect(loadStore().boughtUsedChecks).toHaveLength(1);
    expect(snapshotFor(U("u-fnb")).seedInvestigations[BOUGHT_STORY_EXCEPTION_ID].status).toBe("in_review");
    // Not found is looked at, not settled: it does not count as checked.
    const looked = boughtUsedFor(U("u-fnb"), "lis");
    if (!looked.ok) throw new Error(looked.error);
    expect(looked.summary.checkedFlagged).toBe(0);

    expect(clearCheck(U("u-chef"), { id: again.check.id }).ok).toBe(false);
    expect(clearCheck(U("u-fnb"), { id: again.check.id }).ok).toBe(true);
    expect(snapshotFor(U("u-fnb")).seedInvestigations[BOUGHT_STORY_EXCEPTION_ID].status).toBe("new");
  });

  it("a purchasing check does not close the flag about its own ordering: it waits for a manager, who confirms it", () => {
    const r = markChecked(U("u-buy"), { propertyId: "lis", ingredientId: "coke", outcome: "on_shelf", note: "18 cases in the bar store" });
    if (!r.ok) throw new Error(r.error);
    expect(r.check).toMatchObject({ by: "u-buy", role: "purchasing", outcome: "on_shelf" });
    const st = snapshotFor(U("u-fnb")).seedInvestigations[BOUGHT_STORY_EXCEPTION_ID];
    expect(st.status).toBe("in_review");
    expect(st.closedBy).toBeUndefined();
    const waiting = boughtUsedFor(U("u-fnb"), "lis");
    if (!waiting.ok) throw new Error(waiting.error);
    expect(waiting.summary.checkedFlagged).toBe(0);
    expect(waiting.rows.find((x) => x.ingredientId === "coke")!.checkState).toBe("awaiting");
    // Still open, so it still counts in open flags and value at risk.
    const { exceptions, seed } = boughtUsedCases(["lis"]);
    expect(seed[BOUGHT_STORY_EXCEPTION_ID].status).not.toBe("closed");
    expect(exceptions.some((e) => e.id === BOUGHT_STORY_EXCEPTION_ID)).toBe(true);

    // Purchasing cannot confirm, nobody confirms their own check, and only a waiting check can be confirmed.
    expect(confirmCheck(U("u-buy"), { id: r.check.id })).toMatchObject({ ok: false, status: 403 });
    expect(confirmCheck(U("u-chef"), { id: r.check.id })).toMatchObject({ ok: false, status: 403 });
    expect(confirmCheck(U("u-fnb"), { id: "BUC-NONE" })).toMatchObject({ ok: false, status: 404 });
    const done = confirmCheck(U("u-fc"), { id: r.check.id });
    if (!done.ok) throw new Error(done.error);
    expect(done.check).toMatchObject({ by: "u-buy", confirmedBy: "u-fc", confirmedRole: "controller" });
    expect(snapshotFor(U("u-fnb")).seedInvestigations[BOUGHT_STORY_EXCEPTION_ID]).toMatchObject({ status: "closed", closedBy: "u-fc" });
    expect(confirmCheck(U("u-fnb"), { id: r.check.id })).toMatchObject({ ok: false, status: 400 });
    expect(clearCheck(U("u-fnb"), { id: r.check.id }).ok).toBe(true);

    // A manager's own check never waits, and cannot be confirmed by the same person.
    const own = markChecked(U("u-fnb"), { propertyId: "lis", ingredientId: "coke", outcome: "no_recipe" });
    if (!own.ok) throw new Error(own.error);
    expect(confirmCheck(U("u-fnb"), { id: own.check.id }).ok).toBe(false);
    expect(clearCheck(U("u-fnb"), { id: own.check.id }).ok).toBe(true);
    // And the person who made a waiting check cannot confirm it, even with a role that may close: checked on the record.
    const mine = markChecked(U("u-buy"), { propertyId: "lis", ingredientId: "coke", outcome: "no_recipe" });
    if (!mine.ok) throw new Error(mine.error);
    expect(confirmCheck({ ...U("u-fnb"), id: "u-buy" }, { id: mine.check.id })).toMatchObject({ ok: false, status: 403 });
    expect(clearCheck(U("u-buy"), { id: mine.check.id }).ok).toBe(true);
  });

  it("only people who count stock may record a count; the controller may record the other answers", () => {
    const fc = boughtUsedFor(U("u-fc"), "lis");
    if (!fc.ok) throw new Error(fc.error);
    expect(fc.outcomes.map((o) => o.value)).toEqual(["no_recipe", "not_found"]);
    expect(fc.mayClose).toBe(true);
    expect(markChecked(U("u-fc"), { propertyId: "lis", ingredientId: "coke", outcome: "on_shelf" })).toMatchObject({ ok: false, status: 403 });
    const buy = boughtUsedFor(U("u-buy"), "lis");
    if (!buy.ok) throw new Error(buy.error);
    expect(buy.outcomes.map((o) => o.value)).toEqual(["on_shelf", "no_recipe", "not_found"]);
    expect(buy.mayClose).toBe(false);
    const r = markChecked(U("u-fc"), { propertyId: "lis", ingredientId: "coke", outcome: "no_recipe" });
    if (!r.ok) throw new Error(r.error);
    expect(snapshotFor(U("u-fnb")).seedInvestigations[BOUGHT_STORY_EXCEPTION_ID].status).toBe("closed");
    expect(clearCheck(U("u-fc"), { id: r.check.id }).ok).toBe(true);
  });

  it("shows the item's latest count and the Stock levels estimate beside the gap, on the page and on the flag", () => {
    const d = getDataset();
    const latest = d.counts.filter((c) => c.propertyId === "lis" && c.ingredientId === "coke").sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq).at(-1)!;
    const c = countsNow("lis").get("coke")!;
    expect(c).toMatchObject({ date: latest.date, counted: latest.counted, expected: latest.expected });
    const est = stockPosition("lis", { counts: d.counts, deliveries: d.deliveries, dayItems: d.dayItems, waste: d.wasteLogs, transfers: d.transfers, recipes: [] }).find((r) => r.ingredientId === "coke")!;
    expect(c.onHand).toBeCloseTo(est.estimated, 1);
    const view = boughtUsedFor(U("u-fnb"), "lis");
    if (!view.ok) throw new Error(view.error);
    expect(view.rows.find((r) => r.ingredientId === "coke")!.lastCount).toEqual(c);
    const flag = boughtUsedCases(["lis"]).exceptions.find((e) => e.id === BOUGHT_STORY_EXCEPTION_ID)!;
    expect(flag.boughtUsed!.lastCount).toEqual(c);
  });

  it("lets an earlier check answer the flag only while the gap has grown by no more than a delivery", async () => {
    const { checkHolds } = await import("../server/bought-used");
    const check = { id: "BUC-x", propertyId: "lis", ingredientId: "coke", date: DEMO_TODAY, outcome: "on_shelf" as const, by: "u-fnb", role: "fnb_director" as const, at: "", gap: 400, gapValue: 1 };
    expect(checkHolds(check, { gap: 400, lastDelivery: 240 })).toBe(true);
    expect(checkHolds(check, { gap: 640, lastDelivery: 240 })).toBe(true);
    expect(checkHolds(check, { gap: 700, lastDelivery: 240 })).toBe(false);
    // In the store: a check recorded when the gap was small no longer closes today's flag, and shows as history.
    const r = markChecked(U("u-fnb"), { propertyId: "lis", ingredientId: "coke", outcome: "on_shelf" });
    if (!r.ok) throw new Error(r.error);
    const { mutateStore } = await import("../server/purchasing-store");
    mutateStore((s) => { s.boughtUsedChecks = (s.boughtUsedChecks ?? []).map((c) => ({ ...c, gap: 10 })); });
    expect(snapshotFor(U("u-fnb")).seedInvestigations[BOUGHT_STORY_EXCEPTION_ID].status).toBe("new");
    const view = boughtUsedFor(U("u-fnb"), "lis");
    if (!view.ok) throw new Error(view.error);
    const coke = view.rows.find((x) => x.ingredientId === "coke")!;
    expect(coke.check).toBeNull();
    expect(coke.earlierCheck?.id).toBe(r.check.id);
    expect(view.summary.checkedFlagged).toBe(0);
    expect(clearCheck(U("u-fnb"), { id: r.check.id }).ok).toBe(true);
  });

  it("is cleared by a stock reset", () => {
    expect(markChecked(U("u-fnb"), { propertyId: "lis", ingredientId: "coke", outcome: "no_recipe" }).ok).toBe(true);
    expect(resetDemo(U("u-gm"), "stock").ok).toBe(true);
    expect(loadStore().boughtUsedChecks).toEqual([]);
  });

  it("lights the Stock takes and missing stock item in the sidebar, with no new menu item", () => {
    expect(activeItem("/stock", "bought")?.id).toBe("missing");
  });
});
