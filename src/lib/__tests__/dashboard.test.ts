import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-dashboard-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { INGREDIENTS, userById } = await import("../data/catalog");
const { DEFAULT_ROUTE, locationOf } = await import("../data/locations");
const { POUR_RULES } = await import("../domain/pour");
const { pourFor } = await import("../server/pour");
const { MONTH_BUFFER_DAYS, buildMonthOrder, buyPlan, monthPlanFor, outlookFor } = await import("../server/purchasing");
const { allowedOutlets, can, canOpen } = await import("../domain/access");
const { confidenceOf } = await import("../domain/planning");
const { presetRange, addDays, DEMO_TODAY, fmtRange } = await import("../util");

const entries: import("../server/stock").SessionEntries = { waste: [], counts: [], overrides: [], recipes: [], receipts: [] };
const buyer = userById["u-fnb"];
const outlets = allowedOutlets(buyer).filter((o) => o.startsWith("dxb"));
const outlook = (period: string, user = buyer) => {
  const r = outlookFor(user, { propertyId: "dxb", outletIds: outlets, period }, entries);
  if (!r.ok) throw new Error(r.error);
  return r.outlook;
};

describe("prediction", () => {
  it("orders exactly what What to buy suggests, so the two screens never disagree", () => {
    const plan = buyPlan(buyer, { propertyId: "dxb", outletIds: outlets, period: "7" }, entries);
    if (!plan.ok) throw new Error(plan.error);
    expect(outlook("7").lines).toEqual(plan.plan.lines);
  });

  it("adds outlets up to the total, and looks one day or seven days ahead", () => {
    const t = outlook("tomorrow");
    expect(t.period.from).toBe(addDays(DEMO_TODAY, 1));
    expect(t.period.to).toBe(addDays(DEMO_TODAY, 1));
    expect(outlook("7").period.to).toBe(addDays(DEMO_TODAY, 7));
    expect(t.guests.total).toBe(t.outlets.reduce((s, o) => s + o.guests, 0));
    expect(t.guests.total).toBeGreaterThan(0);
    expect(t.prep.length).toBeGreaterThan(0);
    expect(t.prep[0].portions).toBeGreaterThanOrEqual(t.prep[t.prep.length - 1].portions);
  });

  it("states confidence as a plain rule on bookings and how steady the same weekdays have been", () => {
    const { confidence, guests } = outlook("tomorrow");
    expect(confidence.bookedShare).toBeCloseTo((guests.reservations + guests.eventGuests) / guests.total, 5);
    expect(confidence.level).toBe(confidenceOf(confidence.bookedShare, confidence.swing));
    expect(confidenceOf(0.5, 0.9)).toBe("high");
    expect(confidenceOf(0, 0.1)).toBe("high");
    expect(confidenceOf(0.25, 0.9)).toBe("medium");
    expect(confidenceOf(0, 0.2)).toBe("medium");
    expect(confidenceOf(0.1, 0.5)).toBe("low");
  });

  it("refuses an outlet outside the person's access", () => {
    const r = outlookFor(userById["u-chef"], { propertyId: "dxb", outletIds: ["dxb-lune"], period: "7" }, entries);
    expect(r.ok).toBe(false);
  });
});

describe("month plan", () => {
  const plan = () => {
    const r = monthPlanFor(buyer, "dxb", entries);
    if (!r.ok) throw new Error(r.error);
    return r.plan;
  };

  it("runs from tomorrow to month end, and finishes each order with a buffer", () => {
    const p = plan();
    expect(p.period).toEqual({ from: addDays(DEMO_TODAY, 1), to: "2026-10-31" });
    const chicken = p.items.find((i) => i.ingredientId === "chicken")!;
    expect(chicken.buffer).toBeCloseTo((chicken.predicted / 18) * MONTH_BUFFER_DAYS, 5);
    // The order covers use and buffer, less what is on hand and coming, rounded up to packs.
    expect(chicken.onHand + chicken.incoming + chicken.orderQty).toBeGreaterThanOrEqual(chicken.predicted + chicken.buffer - 1e-6);
    expect(chicken.cost).toBeCloseTo(chicken.orderQty * chicken.unitPrice, 1);
  });

  it("sends fresh food in several deliveries, and spirits in one", () => {
    const p = plan();
    const chicken = p.items.find((i) => i.ingredientId === "chicken")!;
    expect(chicken.deliveries).toBeGreaterThan(1);
    expect(chicken.nextQty).toBeLessThan(chicken.orderQty);
    const rum = p.items.find((i) => i.ingredientId === "rum")!;
    if (rum.orderQty > 0) expect(rum.deliveries).toBe(1);
  });

  it("marks an item critical only when an order today would arrive too late", () => {
    for (const i of plan().items) {
      if (i.health !== "critical") continue;
      expect(i.onHand <= 0 || (i.runOutDate !== null && i.runOutDate <= addDays(DEMO_TODAY, i.leadDays))).toBe(true);
    }
  });

  it("charts stock and use in money on one axis, with a reorder date", () => {
    const p = plan();
    expect(p.categories.map((c) => c.id)).toEqual(["meat", "produce", "bakery", "dry", "drinks"]);
    for (const c of p.categories) {
      expect(c.points[0].date).toBe(DEMO_TODAY);
      expect(c.points[0].used).toBe(0);
      expect(c.points[c.points.length - 1].date).toBe("2026-10-31");
    }
  });

  it("Build order makes one draft with lines from several suppliers, and building again updates it", () => {
    const first = buildMonthOrder(buyer, "dxb", entries);
    if (!first.ok) throw new Error(first.error);
    expect(first.request.status).toBe("draft");
    expect(first.request.period.to).toBe("2026-10-31");
    expect(new Set(first.request.lines.map((l) => l.supplierId)).size).toBeGreaterThan(1);
    const again = buildMonthOrder(buyer, "dxb", entries);
    if (!again.ok) throw new Error(again.error);
    expect(again.request.id).toBe(first.request.id);
    expect(buildMonthOrder(userById["u-fc"], "dxb", entries).ok).toBe(false);
  });
});

describe("Pour Control", () => {
  const out = () => {
    const r = pourFor(buyer, "dxb");
    if (!r.ok) throw new Error(r.error);
    return r.pour;
  };

  it("adds up whichever way it is cut, and shares the recorded glasses across labels", () => {
    const w = out().wine.totals.week;
    expect(w.sold).toBe(out().wine.rows.reduce((s, r) => s + r.periods.week.sold, 0));
    expect(w.sold).toBe(out().wine.outlets.reduce((s, o) => s + o.periods.week.sold, 0));
    expect(w.opened).toBeCloseTo(out().wine.outlets.reduce((s, o) => s + o.periods.week.opened, 0), 5);
  });

  it("flags the Lobby Lounge, as the house wine case does, and says so in one plain line with no names", () => {
    const flags = out().wine.flags;
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0].outletId).toBe("dxb-lobby");
    expect(flags[0].text).toMatch(/^Lobby Lounge, \w+ \w+ shift: [\d.]+ bottles opened, \d+ glasses sold, expected \d+\. About AED [\d,]+ of wine not billed\.$/);
    expect(flags[0].figures.yieldPer!).toBeLessThan(5 * POUR_RULES.threshold);
    for (const f of flags) expect(f.text).not.toMatch(/TRC-|LBY-S|login/);
  });

  it("never shows a money gap without a glass gap", () => {
    const check = (f: { gap: number; gapValue: number }) => { if (f.gap === 0) expect(f.gapValue).toBeLessThan(200); };
    for (const fam of [out().wine, out().spirits]) for (const p of ["today", "week", "month"] as const) check(fam.totals[p]);
  });

  it("limits a manager to their own outlets", () => {
    const r = pourFor(userById["u-rm"], "dxb");
    if (!r.ok) throw new Error(r.error);
    expect(r.pour.wine.outlets.map((o) => o.outletId)).toEqual(["dxb-terrace"]);
    expect(pourFor(userById["u-rm"], "doh").ok).toBe(false);
  });
});

describe("count locations", () => {
  it("puts every item in one known location, so a full count misses nothing", () => {
    const known = new Set<string>(DEFAULT_ROUTE);
    for (const g of INGREDIENTS) expect(known.has(locationOf(g.id))).toBe(true);
    expect(locationOf("wineglass")).toBe("glass");
    expect(locationOf("wine")).toBe("cellar");
  });

  it("offers twelve breakable items for the breakage grid", () => {
    expect(INGREDIENTS.filter((g) => g.dept === "glassware").length).toBeGreaterThanOrEqual(12);
  });
});

describe("navigation and dates", () => {
  it("adds Yesterday to the date range, and writes ranges without a dash", () => {
    expect(presetRange("yesterday")).toEqual({ from: addDays(DEMO_TODAY, -1), to: addDays(DEMO_TODAY, -1) });
    expect(fmtRange({ from: "2026-10-07", to: "2026-10-13" })).toBe("7 Oct to 13 Oct");
  });

  it("opens Alerts only for roles that act on stock or money, and never for frontline staff", () => {
    expect(canOpen(userById["u-fnb"], "alerts")).toBe(true);
    expect(canOpen(userById["u-buy"], "alerts")).toBe(true);
    expect(canOpen(userById["u-emp"], "alerts")).toBe(false);
    expect(canOpen(userById["u-buy"], "waste")).toBe(true);
    expect(can(userById["u-fc"], "purchase.create")).toBe(false);
  });

  it("puts every stock item in one area: food, drinks or inventory", async () => {
    const { stockAreaOf } = await import("../data/locations");
    expect(stockAreaOf("chicken")).toBe("food");
    expect(stockAreaOf("lime")).toBe("food");
    expect(stockAreaOf("wine")).toBe("drinks");
    expect(stockAreaOf("wineglass")).toBe("inventory");
    expect(stockAreaOf("towel")).toBe("inventory");
  });

  it("shows the public demo a short list of flags, and keeps the worked examples", async () => {
    const { demoCases } = await import("../data/demo-cases");
    const { getDataset } = await import("../data/generate");
    const d = getDataset();
    const kept = demoCases(d.exceptions, d.seedInvestigations);
    const open = kept.filter((e) => e.propertyId === "dxb" && d.seedInvestigations[e.id]?.status !== "closed");
    expect(open.length).toBeLessThanOrEqual(12);
    for (const id of ["EX-TRC-1013-198", "EX-VAR-TRC-WAGYU-1013", "EX-VAR-TRC-COKE-1013", "EX-VAR-LBY-WINE-1012"]) expect(kept.some((e) => e.id === id)).toBe(true);
    expect(d.exceptions.length).toBeGreaterThan(kept.length);
  });

  it("puts one alert from each area first, so stock does not crowd out money", async () => {
    const { topAlerts } = await import("../domain/top-alerts");
    const stock = [1, 2, 3].map((n) => ({ kind: "stock", rag: "red", amount: 5000 - n }));
    const money = { kind: "money", rag: "amber", amount: 400 };
    const pour = { kind: "pour", rag: "amber", amount: 800 };
    expect(topAlerts([...stock, money, pour]).map((a) => a.kind).sort()).toEqual(["money", "pour", "stock"]);
    expect(topAlerts(stock)).toHaveLength(3);
  });

  it("keeps the live data files out of the bundler's sight, so saving a record never reloads the page", async () => {
    const fs = await import("node:fs");
    for (const f of ["auth.ts", "purchasing-store.ts"]) expect(fs.readFileSync(`src/lib/server/${f}`, "utf8")).not.toMatch(/process\.cwd\(\)[^\n]*\.data/);
    const { dataFile } = await import("../server/data-file");
    expect(dataFile("auth.json")).toBe(`${process.cwd()}/.data/auth.json`);
  });

  it("gives Drinks control to the roles that see revenue, and switches page without a reload when the role fits", async () => {
    const { demoRoleFits, moduleOfPath } = await import("../domain/access");
    expect(moduleOfPath("/drinks")).toBe("drinks");
    expect(canOpen(userById["u-fnb"], "drinks")).toBe(true);
    expect(canOpen(userById["u-buy"], "drinks")).toBe(false);
    expect(demoRoleFits(userById["u-fnb"], "forecast")).toBe(true);
    expect(demoRoleFits(userById["u-chef"], "money")).toBe(false);
  });

  it("files every stock item under a hotel category, inside its food, beverage or inventory area", async () => {
    const { STOCK_GROUPS, groupByStock, stockAreaOf, stockGroupOf } = await import("../data/locations");
    for (const g of INGREDIENTS) expect(STOCK_GROUPS.find((x) => x.id === stockGroupOf(g.id))!.area).toBe(stockAreaOf(g.id));
    expect(stockGroupOf("coke")).toBe("soft");
    expect(stockGroupOf("chicken")).toBe("meat");
    expect(groupByStock(["coke", "wine", "soda"], (x) => x).map((g) => g.name)).toEqual(["Wine", "Soft drinks"]);
  });
});
