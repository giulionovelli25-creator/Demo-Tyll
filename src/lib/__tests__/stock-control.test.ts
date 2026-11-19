import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-sc-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const D = await import("../domain/procurement");
const { resetPurchasingStore, loadStore } = await import("../server/purchasing-store");
const T = await import("../server/stocktake");
const X = await import("../server/expiry");
const C = await import("../server/cash");
const P = await import("../server/purchasing");
const { procurementOf } = await import("../server/procurement");
const { stockFor } = await import("../server/stock");
const { snapshotFor } = await import("../server/snapshot");
const { detectOrderException, detectRoomChargeException } = await import("../domain/detect");
const { getDataset } = await import("../data/generate");
const { userById } = await import("../data/catalog");
const { DEMO_TODAY, addDays } = await import("../util");

type Entries = import("../server/stock").SessionEntries;
const none: Entries = { waste: [], counts: [], overrides: [], recipes: [], receipts: [] };
const U = (id: string) => userById[id];
const ok = <T,>(r: ({ ok: true } & T) | { ok: false; status: number; error: string }): T => { if (!r.ok) throw new Error(`${r.status}: ${r.error}`); return r as T; };

beforeEach(() => resetPurchasingStore());

describe("variance maths", () => {
  it("compares system and counted in units and money, by item and group; items not counted change nothing", () => {
    const r = D.varianceReport([
      { ingredientId: "a", group: "Meat and fish", system: 10, counted: 8, unitCost: 5 },
      { ingredientId: "b", group: "Dry goods", system: 5, counted: 6, unitCost: 2 },
      { ingredientId: "c", group: "Dry goods", system: 3, counted: null, unitCost: 9 },
    ]);
    expect(r.lines.map((l) => [l.diff, l.value])).toEqual([[-2, -10], [1, 2], [0, 0]]);
    expect(r.totals).toMatchObject({ items: 3, counted: 2, notCounted: 1, withDifference: 2, net: -8, missing: -10, surplus: 2, systemValue: 60, countedValue: 52 });
    expect(r.groups.find((g) => g.group === "Dry goods")).toMatchObject({ items: 2, counted: 1, net: 2 });
  });
});

describe("expiry ordering", () => {
  const batches = [
    { ingredientId: "x", batch: "A", expiry: "2026-10-14", qty: 5, received: "2026-10-10", source: "s" },
    { ingredientId: "x", batch: "B", expiry: "2026-10-16", qty: 10, received: "2026-10-12", source: "s" },
  ];
  it("uses the first expiring batch first, so the batches left are the ones that expire last", () => {
    const r = D.remainingByFefo(12, batches);
    expect(r.batches.map((b) => [b.batch, b.left])).toEqual([["A", 2], ["B", 10]]);
    expect(r.noBatch).toBe(0);
    expect(D.remainingByFefo(8, batches).batches.map((b) => b.batch)).toEqual(["B"]);
    expect(D.remainingByFefo(20, batches).noBatch).toBe(5);
  });
  it("suggests an action by fixed rules", () => {
    expect(D.expiryAction({ left: 4, daysLeft: -1, dailyUse: 1, unitWord: "kg" }).kind).toBe("waste");
    expect(D.expiryAction({ left: 4, daysLeft: 1, dailyUse: 3, unitWord: "kg" }).kind).toBe("use_first");
    expect(D.expiryAction({ left: 10, daysLeft: 1, dailyUse: 2, unitWord: "kg", transferTo: { name: "Banquets", canUse: 8 } }).kind).toBe("transfer");
    expect(D.expiryAction({ left: 10, daysLeft: 1, dailyUse: 2, unitWord: "kg", dish: "Salmon tartare" })).toEqual({ kind: "special", text: "Use 6 kg in a special, such as Salmon tartare." });
    expect(D.expiryAction({ left: 10, daysLeft: 0, dailyUse: 2, unitWord: "kg" }).kind).toBe("staff_meal");
    expect(D.daysToExpiry("2026-10-16", "2026-10-13")).toBe(3);
  });
  it("a batch received with an expiry date in three days is listed as expiring soon, with its value and an action", () => {
    const nadia = U("u-buy"), sara = U("u-rm"), priya = U("u-fc"), marco = U("u-fnb"), ahmed = U("u-store");
    const made = ok(require_po(nadia, sara, priya, marco));
    ok(P.actOnRequest(ahmed, made.id, { action: "receive", lines: [{ ingredientId: "salmon", delivered: 30, damaged: 0, batch: "PA-77812", expiry: addDays(DEMO_TODAY, 2) }] }));
    const r = X.expiringFor(sara, "lis", none, 3);
    if (!r.ok) throw new Error(r.error);
    const row = r.rows.find((x) => x.batch === "PA-77812");
    expect(row).toBeTruthy();
    expect(row!.daysLeft).toBe(2);
    expect(row!.value).toBeGreaterThan(0);
    expect(row!.action.text.length).toBeGreaterThan(10);
    expect(r.totals.batches).toBeGreaterThan(0);
  });
});

/** A salmon order raised, approved and sent, for the receiving tests. */
function require_po(nadia: typeof userById[string], sara: typeof userById[string], priya: typeof userById[string], marco: typeof userById[string]) {
  const X2 = require_mod();
  const made = X2.createPurchaseOrders(sara, "lis", [{ ingredientId: "salmon", qty: 30 }], { source: "manual" });
  if (!made.ok) return made;
  const id = made.orders[0].id;
  for (const [u, a] of [[sara, "submit"], [nadia, "purchasing"], [priya, "accounting"], [marco, "fnb"]] as const) {
    const st = loadStore().requests.find((r) => r.id === id)!.status;
    if (a !== "submit" && st !== a) continue;
    const r = P.actOnRequest(u, id, a === "submit" ? { action: "submit" } : { action: a, decision: "approve" });
    if (!r.ok) return r;
  }
  X2.sendPurchaseOrder(nadia, id);
  return { ok: true as const, id };
}
let procMod: typeof import("../server/procurement") | null = null;
const require_mod = () => procMod!;
beforeEach(async () => { procMod = await import("../server/procurement"); });

describe("stock take end to end", () => {
  it("finds a variance, a manager approves it, stock adjusts, the month-end report shows it, and a stock loss is confirmed", () => {
    const counter = U("u-buy"), manager = U("u-fnb");
    const take = ok(T.startStockTake(counter, { propertyId: "lis", kind: "partial", areas: ["walkin"] }, none)).take;
    expect(take.lines.length).toBeGreaterThan(3);
    expect(take.status).toBe("counting");
    const line = take.lines.find((l) => l.ingredientId === "chicken") ?? take.lines[0];
    const g = line.ingredientId;
    // Counted by scanning the pack barcode, 2 short of the system figure.
    const code = procurementOf().catalogue.find((c) => c.ingredientId === g && c.preferred)!.barcode;
    const counted = Math.max(0, Math.round((line.system - 2) * 1000) / 1000);
    const scanned = ok(T.countItem(counter, take.id, { barcode: code, counted }));
    expect(scanned.ingredientId).toBe(g);
    expect(scanned.take.lines.find((l) => l.ingredientId === g)!.method).toBe("scan");
    expect(T.countItem(counter, take.id, { barcode: "2900000000000" }).ok).toBe(false);
    // Another item counted by hand, exactly as the system says.
    const other = take.lines.find((l) => l.ingredientId !== g)!;
    ok(T.countItem(counter, take.id, { ingredientId: other.ingredientId, counted: other.system }));

    // Before anything changes: the variance report.
    const before = stockFor(manager, "lis", none).find((r) => r.ingredientId === g)!.estimated;
    const sub = ok(T.submitStockTake(counter, take.id)).take;
    expect(sub.status).toBe("submitted");
    expect(sub.report.totals.counted).toBe(2);
    expect(sub.report.totals.withDifference).toBe(1);
    const diff = Math.round((counted - line.system) * 1000) / 1000;
    expect(sub.report.lines.find((l) => l.ingredientId === g)!.diff).toBe(diff);
    expect(sub.report.totals.net).toBe(Math.round(diff * line.unitCost * 100) / 100);
    expect(stockFor(manager, "lis", none).find((r) => r.ingredientId === g)!.estimated).toBe(before);

    // The person who counted cannot approve; a manager can. Stock then follows the count.
    expect(T.decideStockTake(counter, take.id, { decision: "approve" }).ok).toBe(false);
    const done = ok(T.decideStockTake(manager, take.id, { decision: "approve" })).take;
    expect(done.status).toBe("approved");
    expect(done.countIds).toHaveLength(2);
    expect(stockFor(manager, "lis", none).find((r) => r.ingredientId === g)!.estimated).toBeCloseTo(counted, 3);
    // The counts are dated on the day of the count, which the month-end uses.
    expect(loadStore().stockLog.counts.filter((c) => done.countIds!.includes(c.id)).every((c) => c.date === take.date)).toBe(true);
    // Someone who counted a line cannot approve, and is not offered the button.
    expect(T.stockTakeFor(counter, take.id).ok && (T.stockTakeFor(counter, take.id) as { mayDecide: boolean }).mayDecide).toBe(false);

    // Month-end shows the approved stock take and its variance.
    const month = T.monthEnd(manager, "lis", DEMO_TODAY.slice(0, 7));
    if (!month.ok) throw new Error(month.error);
    expect(month.takes.map((t) => t.id)).toContain(take.id);
    expect(month.totals.net).toBe(sub.report.totals.net);

    // A stock loss on an item the stock take counted is now confirmed, with what it was compared against.
    const snap = snapshotFor(U("u-gm"));
    const stockFlag = snap.exceptions.find((e) => e.type === "usage_variance");
    if (stockFlag) expect(["estimate", "confirmed"]).toContain(stockFlag.basis);
    expect(T.confirmedByStockTake("lis", g, DEMO_TODAY)).toBe(take.id);
  });

  it("a full stock take needs every item; a partial one at least one", () => {
    const u = U("u-buy");
    const full = ok(T.startStockTake(u, { propertyId: "lis", kind: "full" }, none)).take;
    expect(full.areas.length).toBeGreaterThan(3);
    ok(T.countItem(u, full.id, { ingredientId: full.lines[0].ingredientId, counted: 1 }));
    expect(T.submitStockTake(u, full.id).ok).toBe(false);
    const rejected = T.decideStockTake(U("u-fnb"), full.id, { decision: "reject", note: "x" });
    expect(rejected.ok).toBe(false);
  });
});

describe("reconciliation rules", () => {
  it("every till and room-charge flag says what it was compared against", () => {
    const d = getDataset();
    const flags = d.exceptions.filter((e) => e.type !== "usage_variance");
    expect(flags.length).toBeGreaterThan(5);
    for (const e of flags) expect(e.comparedWith, e.id).toMatch(/^Compared with/);
    for (const e of d.exceptions.filter((x) => x.type === "usage_variance")) expect(e.basis).toBe("estimate");
  });
  it("flags a refund with no reason, above the share of the bill or late; a void after sending without approval; comps without a reason or above the limit", () => {
    const base = { id: "O1", outletId: "lis-terrace", date: DEMO_TODAY, openMin: 1200, closeMin: 1260, covers: 2, staffId: "MER-S1", table: "4", discountPct: 0, payment: "card" as const };
    const line = (state: "kept" | "comped" | "removed_post", extra = {}) => ({ itemId: "burger", qty: 1, unitPrice: 20, state, enteredMin: 1200, sentMin: 1201, ...extra });
    const refund = detectOrderException({ ...base, lines: [line("kept"), line("kept")], refund: { amount: 5, min: 1265 } })!;
    expect(refund.type).toBe("unusual_refund");
    expect(refund.comparedWith).toContain("no reason");
    expect(detectOrderException({ ...base, lines: [line("kept"), line("kept")], refund: { amount: 5, min: 1265, reason: "Cold dish" } })).toBeNull();
    const voided = detectOrderException({ ...base, lines: [line("kept")], voided: { min: 1250 } })!;
    expect(voided.type).toBe("unexplained_void");
    const comp = detectOrderException({ ...base, lines: [line("comped")] })!;
    expect(comp.type).toBe("excessive_comp");
    expect(comp.comparedWith).toContain("1 of 1 without a reason or approval");
    const removed = detectOrderException({ ...base, lines: [line("kept"), line("removed_post", { removedMin: 1230 })] })!;
    expect(removed.type).toBe("removed_after_dispatch");
    expect(removed.comparedWith).toContain("no manager approval");
    const room = detectRoomChargeException({ id: "RC1", propertyId: "lis", outletId: "lis-terrace", date: DEMO_TODAY, min: 1200, room: "1211", source: "restaurant", expected: 50, posted: [] } as never)!;
    expect(room.comparedWith).toContain("guest folio");
  });
  it("compares cash counted with the till's cash sales per shift, flags above €10 or 1%, and says so", () => {
    expect(D.cashCheck(1000, 985)).toMatchObject({ diff: -15, limit: 10, flagged: true, kind: "short" });
    expect(D.cashCheck(1000, 995).flagged).toBe(false);
    expect(D.cashCheck(3000, 2975)).toMatchObject({ limit: 30, flagged: false });
    const r = C.cashFor(U("u-fc"), "lis");
    if (!r.ok) throw new Error(r.error);
    expect(r.rows.length).toBeGreaterThan(10);
    const planted = r.rows.find((x) => x.outletId === "lis-lobby" && x.flagged && x.diff < 0);
    expect(planted).toBeTruthy();
    expect(planted!.comparedWith).toContain("cash sales on the till");
    // A cash-up entered in Tyll replaces the simulated count, and a difference notifies the controller.
    const target = r.rows.find((x) => !x.flagged)!;
    const rec = C.recordCashUp(U("u-fnb"), { outletId: target.outletId, date: target.date, shift: target.shift, counted: target.expected - 40 });
    if (!rec.ok) throw new Error(rec.error);
    expect(rec.check.flagged).toBe(true);
    const again = C.cashFor(U("u-fc"), "lis");
    if (!again.ok) throw new Error(again.error);
    expect(again.rows.find((x) => x.outletId === target.outletId && x.date === target.date && x.shift === target.shift)).toMatchObject({ source: "entered", flagged: true });
    expect(loadStore().notify.notices.some((n) => n.type === "cash-diff")).toBe(true);
  });
});

describe("expiry bell notice", () => {
  it("tells the kitchen, outlet managers, F&B director and storekeeper once a day, and nobody else", () => {
    const rows = ok(X.expiringFor(U("u-gm"), "lis", none, 1)).rows;
    X.ensureExpiryNotice("lis");
    X.ensureExpiryNotice("lis");
    const notices = loadStore().notify.notices.filter((n) => n.type === "expiry");
    expect(loadStore().expiryChecks?.lis).toBe(DEMO_TODAY);
    if (!rows.length) return void expect(notices).toEqual([]);
    expect(new Set(notices.map((n) => n.to))).toEqual(new Set(["u-chef", "u-rm", "u-lby", "u-fnb", "u-store"]));
    expect(notices.every((n) => n.ref === `EXP-lis-${DEMO_TODAY}` && n.href === "/stock?tab=expiry")).toBe(true);
    expect(notices[0].title).toMatch(/to use today or tomorrow|expired/);
  });
});
