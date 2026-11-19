import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-nav-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { resetPurchasingStore } = await import("../server/purchasing-store");
const P = await import("../server/purchasing");
const { userById } = await import("../data/catalog");
const { ALL_ITEMS, SECTIONS, activeItem, sectionOf } = await import("../nav");
const { versus, byDay, lastDays } = await import("../domain/trends");

const none: import("../server/stock").SessionEntries = { waste: [], counts: [], overrides: [], recipes: [], receipts: [] };
beforeEach(() => resetPurchasingStore());

describe("sidebar in three sections", () => {
  it("puts every page in exactly one place, with few items per section", () => {
    const hrefs = ALL_ITEMS.flatMap((i) => [i.href, ...(i.also ?? [])]);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(SECTIONS.map((s) => s.title)).toEqual(["Stock and waste", "Purchasing", "Revenue and reconciliation"]);
    // Purchasing is the flow hotels save most time in, so the owner asked for it to be the most visible (19 November 2026):
    // To order, Automatic ordering, Predictions, Orders, Suppliers, Deliveries and invoices. The other sections keep four.
    for (const s of SECTIONS) expect(s.items.length).toBeLessThanOrEqual(s.id === "purchasing" ? 6 : s.id === "stock" ? 5 : 4); // Expiry has its own item: the kitchen must find it at once.
    for (const href of ["/", "/alerts", "/stock", "/waste", "/drinks", "/forecast", "/money", "/reports", "/settings", "/more"]) expect(hrefs).toContain(href);
  });

  it("lights up the right item and colours the page by its section", () => {
    expect(activeItem("/stock", "suppliers")?.label).toBe("Deliveries and invoices");
    expect(sectionOf("/stock", "suppliers")?.tone).toBe("blue");
    expect(sectionOf("/stock", null)?.tone).toBe("teal");
    expect(activeItem("/investigations/EX-1", null)?.label).toBe("Flagged transactions");
    expect(activeItem("/finance", "invoices")?.label).toBe("Deliveries and invoices");
    expect(activeItem("/stock", "counts")?.label).toBe("Stock takes and missing stock");
    expect(activeItem("/stock", "takes")?.label).toBe("Stock takes and missing stock");
    expect(activeItem("/stock", "expiry")?.label).toBe("Expiring soon");
    expect(activeItem("/forecast", "pars")?.label).toBe("To order");
    expect(activeItem("/forecast", "catalogue")?.label).toBe("Suppliers");
    expect(activeItem("/money", "cash")?.label).toBe("Flagged transactions");
    expect(activeItem("/forecast", "buy")?.label).toBe("Orders");
    expect(sectionOf("/money", "flags")?.tone).toBe("violet");
    expect(activeItem("/money", "mistakes")?.label).toBe("Flagged transactions");
    expect(activeItem("/money", "orders")?.label).toBe("Revenue");
    expect(sectionOf("/", null)).toBeNull();
  });
});

describe("number strip comparisons", () => {
  it("says the direction in words and colours by what is better", () => {
    expect(versus(80, 100, "down")).toEqual({ text: "20% less than last week", good: true });
    expect(versus(120, 100, "down").good).toBe(false);
    expect(versus(0, 0, "down").good).toBeNull();
    expect(versus(5, 0, "up").text).toBe("None last week");
  });

  it("fills every day, even days with nothing", () => {
    const days = lastDays(3, "2026-10-13");
    expect(byDay([{ d: "2026-10-12", v: 4 }, { d: "2026-10-12", v: 1 }, { d: "2026-09-01", v: 9 }], (r) => r.d, (r) => r.v, days)).toEqual([
      { date: "2026-10-11", value: 0 }, { date: "2026-10-12", value: 5 }, { date: "2026-10-13", value: 0 },
    ]);
  });
});

describe("edited order quantities", () => {
  it("builds the draft with the manager's quantity and keeps the suggestion beside it", () => {
    const u = userById["u-fnb"];
    const plan = P.monthPlanFor(u, "lis", none);
    if (!plan.ok) throw new Error(plan.error);
    const item = plan.plan.items.find((i) => i.nextQty > 0)!;
    const r = P.buildMonthOrder(u, "lis", none, { [item.ingredientId]: item.nextQty + 3 });
    if (!r.ok) throw new Error(r.error);
    const line = r.requests.flatMap((x) => x.lines).find((l) => l.ingredientId === item.ingredientId)!;
    // A purchase order goes in the supplier's whole packs, so the manager's quantity is rounded up and the change is said.
    expect(line.qty).toBe(Math.round(Math.ceil((item.nextQty + 3) / line.packSize! - 1e-9) * line.packSize! * 1000) / 1000);
    expect(line.qty).toBeGreaterThanOrEqual(item.nextQty + 3);
    expect(line.suggested).toBe(item.nextQty);
  });

  it("leaves an item out when its quantity is set to zero", () => {
    const u = userById["u-fnb"];
    const plan = P.monthPlanFor(u, "lis", none);
    if (!plan.ok) throw new Error(plan.error);
    const item = plan.plan.items.find((i) => i.nextQty > 0)!;
    const r = P.buildMonthOrder(u, "lis", none, { [item.ingredientId]: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.requests.flatMap((x) => x.lines).some((l) => l.ingredientId === item.ingredientId)).toBe(false);
  });
});

describe("over pouring shift view", () => {
  it("gives possible reasons and help without naming anyone, and names the team only for managers", async () => {
    const { pourFor } = await import("../server/pour");
    const { STAFF } = await import("../data/catalog");
    const manager = pourFor(userById["u-fnb"], "lis");
    if (!manager.ok) throw new Error(manager.error);
    const flag = manager.pour.wine.flags[0];
    expect(flag.team!.shifts).toBeGreaterThan(0);
    expect(flag.team!.people.length).toBeGreaterThan(0);
    expect(flag.team!.people[0].name).toBeTruthy();
    expect(flag.reasons!.likely.length).toBeGreaterThan(0);
    expect(flag.reasons!.help.length).toBeGreaterThan(0);
    const words = [...flag.reasons!.likely, ...flag.reasons!.help].join(" ");
    for (const s of STAFF) expect(words).not.toContain(s.name);
    const bar = Object.values(userById).find((u) => u.role === "employee")!;
    const staff = pourFor(bar, "lis");
    if (staff.ok) for (const f of staff.pour.wine.flags) for (const p of f.team?.people ?? []) expect(p.name).toBeUndefined();
  });
});

describe("who was on, against the trend", () => {
  it("picks out the Bar Azulejo bartender beyond chance, nobody else, and only for managers", async () => {
    const { pourFor } = await import("../server/pour");
    const r = pourFor(userById["u-fnb"], "lis");
    if (!r.ok) throw new Error(r.error);
    const standing = (r.pour.staff ?? []).flatMap((v) => v.people.filter((p) => p.z >= 3).map((p) => `${v.outletId}:${p.staffId}`));
    expect(standing).toEqual(["lis-lobby:AZU-S5"]);
    const lobby = r.pour.staff!.find((v) => v.outletId === "lis-lobby")!;
    expect(lobby.days).toHaveLength(28);
    expect(lobby.people[0].avgOn).toBeGreaterThan(lobby.people[0].avgOff * 2);
    const bar = Object.values(userById).find((u) => u.role === "employee")!;
    const staff = pourFor(bar, "lis");
    if (staff.ok) expect(staff.pour.staff).toBeUndefined();
  });
});

describe("trend line", () => {
  it("fits a straight line and says whether the direction is good news", async () => {
    const { fitLine, trendVerdict } = await import("../../components/charts");
    const falling = [100, 95, 90, 85, 80, 75, 70].map((value) => ({ value }));
    const fit = fitLine(falling)!;
    expect(fit.slope).toBeCloseTo(-5, 5);
    expect(fit.values[0]).toBeCloseTo(100, 5);
    expect(trendVerdict(falling, "down")).toMatchObject({ direction: "down", good: true });
    expect(trendVerdict(falling, "up")).toMatchObject({ direction: "down", good: false });
    const level = [100, 101, 99, 100, 102, 98, 100].map((value) => ({ value }));
    expect(trendVerdict(level, "down")).toMatchObject({ direction: "flat", good: null });
    expect(fitLine([{ value: 1 }, { value: null }])).toBeNull();
  });
});
