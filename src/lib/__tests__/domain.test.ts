import { describe, expect, it } from "vitest";
import { OUTLETS, USERS, ingredientById, outletsOfProperty, userById } from "../data/catalog";
import { HERO_EXCEPTION_ID, HERO_ORDER_ID, getDataset } from "../data/generate";
import { AccessError, allowedOutlets, assertCan, can, canOpen, clampScope, moduleOfPath, scopeCurrency, scopeOutlets } from "../domain/access";
import { POLICY, detectOrderException, detectPatterns, detectRoomChargeException } from "../domain/detect";
import { explain } from "../domain/explain";
import { buildForecast, defaultInputs } from "../domain/forecast";
import { matchDeliveryLine, orderPack, stockPosition, wasteCost, type StockInputs } from "../domain/inventory";
import { compare, computeTotals, itemPerformance, prevSel, totalsByDay, totalsByOutlet, type Ctx, type Sel } from "../domain/metrics";
import { assessArrival, predictTicket, roomReadyAt, stationLoad } from "../domain/operations";
import { buildRollups, orderTotals } from "../domain/orders";
import { ingredientCostAt, itemCostAt, itemEconomics } from "../domain/pricing";
import type { CountRecord, InvestigationState, Order, PriceChange, RoomCharge, WasteLog } from "../types";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, fxRate, presetRange, previousRange } from "../util";

const data = getDataset();
const ALL = OUTLETS.map((o) => o.id);
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ data, waste: data.wasteLogs, counts: data.counts, overrides: [], investigations: {}, ...over });
const sel = (over: Partial<Sel> = {}): Sel => ({ outletIds: ALL, wholeProperties: ["dxb", "doh"], dept: "all", range: presetRange("week"), currency: "AED", ...over });
const close = (a: number, b: number, tol = 0.01) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("order arithmetic", () => {
  const hero = data.ordersById.get(HERO_ORDER_ID)!;

  it("bills the burger only on the worked example", () => {
    const t = orderTotals(hero);
    expect(t.original).toBe(120);
    expect(t.net).toBe(98);
    expect(t.removedPost).toBe(22);
    expect(t.gross).toBe(98);
  });

  it("applies discounts to kept lines and leaves complimentary lines out of net sales", () => {
    const order: Order = {
      id: "T-1", outletId: "dxb-terrace", date: DEMO_TODAY, openMin: 700, closeMin: 760, covers: 2, staffId: "TRC-S1", table: "Table 1", discountPct: 10, payment: "card",
      lines: [
        { itemId: "burger", qty: 2, unitPrice: 100, state: "kept", enteredMin: 701, sentMin: 702 },
        { itemId: "coke", qty: 1, unitPrice: 20, state: "comped", enteredMin: 701, sentMin: 702, reason: "Service recovery", approvedBy: "TRC-S7" },
      ],
      refund: { amount: 30, min: 770, reason: "Guest complaint", approvedBy: "TRC-S7" },
    };
    const t = orderTotals(order);
    expect(t.gross).toBe(220);
    expect(t.comps).toBe(20);
    expect(t.discounts).toBe(20);
    expect(t.net).toBe(150);
    const { dayItems } = buildRollups([order]);
    const net = dayItems.reduce((s, r) => s + r.gross - r.comps - r.discounts - r.refunds, 0);
    close(net, 150);
  });

  it("counts a voided order as no revenue", () => {
    const t = orderTotals({ ...hero, voided: { min: 1250 } });
    expect(t.net).toBe(0);
    expect(t.gross).toBe(0);
    expect(buildRollups([{ ...hero, voided: { min: 1250 } }]).dayItems).toHaveLength(0);
  });
});

describe("detection rules", () => {
  const hero = data.ordersById.get(HERO_ORDER_ID)!;

  it("flags the Coke removed six minutes after dispatch, for its menu price", () => {
    const e = detectOrderException(hero)!;
    expect(e.type).toBe("removed_after_dispatch");
    expect(e.exposure).toBe(22);
    expect(e.headline).toContain("6 min");
    expect(e.id).toBe(HERO_EXCEPTION_ID);
  });

  it("does not flag a removal that carries an approval", () => {
    const approved: Order = { ...hero, lines: hero.lines.map((l) => (l.state === "removed_post" ? { ...l, approvedBy: "TRC-S7", reason: "Guest changed order" } : l)) };
    expect(detectOrderException(approved)).toBeNull();
  });

  it("does not flag items removed before they were sent", () => {
    const early: Order = { ...hero, lines: hero.lines.map((l) => (l.state === "removed_post" ? { ...l, state: "removed_pre" as const, sentMin: undefined } : l)) };
    expect(detectOrderException(early)).toBeNull();
  });

  it("flags discounts above policy or without a reason, and passes approved ones", () => {
    const base: Order = { ...hero, lines: [hero.lines[0]] };
    expect(detectOrderException({ ...base, discountPct: 15, discountReason: "Loyalty member", discountApprovedBy: "TRC-S7" })).toBeNull();
    expect(detectOrderException({ ...base, discountPct: POLICY.discountMaxPct + 5, discountReason: "Loyalty member", discountApprovedBy: "TRC-S7" })?.type).toBe("unusual_discount");
    expect(detectOrderException({ ...base, discountPct: 10 })?.type).toBe("unusual_discount");
  });

  it("classifies room-charge postings", () => {
    const c: RoomCharge = { id: "RC-X", propertyId: "dxb", date: DEMO_TODAY, min: 600, room: "1204", source: "minibar", description: "Minibar", expected: 80, posted: [80] };
    expect(detectRoomChargeException(c)).toBeNull();
    expect(detectRoomChargeException({ ...c, posted: [] })).toMatchObject({ type: "room_charge_missing", exposure: 80 });
    expect(detectRoomChargeException({ ...c, posted: [80, 80] })).toMatchObject({ type: "room_charge_duplicate", exposure: 80 });
    expect(detectRoomChargeException({ ...c, posted: [60] })).toMatchObject({ type: "room_charge_incorrect", exposure: 20 });
  });

  it("never states a cause in the explanation, and reproduces the product's example wording", () => {
    const e = data.exceptions.find((x) => x.id === HERO_EXCEPTION_ID)!;
    const ex = explain(e, data, data.counts, detectPatterns(data.exceptions, DEMO_TODAY));
    expect(ex.message).toBe("The Coke was removed from the customer's bill six minutes after the preparation ticket was sent to the bar. The final bill does not include the drink. Please verify whether the item was prepared or served and whether the cancellation was authorized.");
    expect(ex.possibleCauses.length).toBeGreaterThan(1);
    const text = [ex.message, ex.whatHappened, ...ex.facts, ...ex.recommended].join(" ").toLowerCase();
    for (const word of ["fraud", "theft", "stole", "stolen"]) expect(text).not.toContain(word);
  });
});

describe("financial aggregation", () => {
  it("keeps the statement identities", () => {
    const t = computeTotals(ctx(), sel());
    close(t.net, t.gross - t.comps - t.discounts - t.refunds);
    close(t.fnbCost, t.theoCost + t.waste + t.variance);
    close(t.grossProfit, t.net - t.fnbCost);
    close(t.gpMargin, t.grossProfit / t.net, 1e-9);
    close(t.operatingProfit!, t.net - t.fnbCost - t.labor! - t.opex!);
    expect(t.gpMargin).toBeGreaterThan(0.6);
    expect(t.gpMargin).toBeLessThan(0.85);
  });

  it("adds outlets up to the group, in one currency", () => {
    const c = ctx();
    const group = computeTotals(c, sel());
    const rows = totalsByOutlet(c, sel());
    close(rows.reduce((s, r) => s + r.now.net, 0), group.net);
    close(rows.reduce((s, r) => s + r.now.theoCost, 0), group.theoCost);
    close(rows.reduce((s, r) => s + r.now.waste, 0), group.waste);
    close(rows.reduce((s, r) => s + r.now.variance, 0), group.variance);
    close(rows.reduce((s, r) => s + (r.now.labor ?? 0), 0), group.labor!);
    expect(rows.reduce((s, r) => s + r.now.orders, 0)).toBe(group.orders);
  });

  it("converts Doha from QAR to AED at the dollar pegs", () => {
    const doha = outletsOfProperty("doh").map((o) => o.id);
    const qar = computeTotals(ctx(), sel({ outletIds: doha, currency: "QAR" }));
    const aed = computeTotals(ctx(), sel({ outletIds: doha, currency: "AED" }));
    close(aed.net, qar.net * fxRate("QAR", "AED"), 0.01);
    close(fxRate("QAR", "AED"), 3.6725 / 3.64, 1e-9);
  });

  it("adds days up to the period and items up to revenue", () => {
    const c = ctx();
    const s = sel();
    const total = computeTotals(c, s);
    close(totalsByDay(c, s).reduce((sum, d) => sum + d.now.net, 0), total.net);
    close(itemPerformance(c, s).reduce((sum, r) => sum + r.revenue, 0), total.gross);
    close(itemPerformance(c, s).reduce((sum, r) => sum + r.cost, 0), total.theoCost);
  });

  it("splits food and beverage without losing or double counting sales", () => {
    const c = ctx();
    const food = computeTotals(c, sel({ dept: "food" }));
    const bev = computeTotals(c, sel({ dept: "beverage" }));
    const all = computeTotals(c, sel());
    close(food.net + bev.net, all.net);
    expect(food.labor).toBeNull();
    expect(food.operatingProfit).toBeNull();
  });

  it("compares a period that ends today with the previous one cut at the same time", () => {
    const today = sel({ range: presetRange("today") });
    const prev = prevSel(today);
    expect(prev.range).toEqual({ from: addDays(DEMO_TODAY, -1), to: addDays(DEMO_TODAY, -1) });
    expect(prev.cutDate).toBe(addDays(DEMO_TODAY, -1));
    const cut = computeTotals(ctx(), prev);
    const full = computeTotals(ctx(), { ...prev, cutDate: undefined });
    expect(cut.net).toBeLessThan(full.net);
    expect(previousRange(presetRange("week"))).toEqual({ from: addDays(DEMO_TODAY, -13), to: addDays(DEMO_TODAY, -7) });
  });

  it("shows The Terrace with the lowest and falling margin and the most adjustments", () => {
    const rows = totalsByOutlet(ctx(), sel());
    const terrace = rows.find((r) => r.outletId === "dxb-terrace")!;
    expect(Math.min(...rows.map((r) => r.now.gpMargin))).toBe(terrace.now.gpMargin);
    expect(terrace.now.gpMargin).toBeLessThan(terrace.before.gpMargin);
    expect(Math.max(...rows.map((r) => r.now.adjustments))).toBe(terrace.now.adjustments);
  });

  it("moves a case from potential loss to confirmed loss or recovered when it is closed", () => {
    const s = sel({ range: presetRange("today") });
    const before = computeTotals(ctx(), s);
    const closed = (over: Partial<InvestigationState>): Record<string, InvestigationState> => ({ [HERO_EXCEPTION_ID]: { status: "closed", notes: [], confirmedLoss: 0, recovered: 0, ...over } });
    const lost = computeTotals(ctx({ investigations: closed({ outcome: "confirmed_loss", confirmedLoss: 22 }) }), s);
    close(lost.potentialLoss, before.potentialLoss - 22);
    close(lost.confirmedLoss, before.confirmedLoss + 22);
    expect(lost.openCases).toBe(before.openCases - 1);
    const recovered = computeTotals(ctx({ investigations: closed({ outcome: "recovered", recovered: 22 }) }), s);
    close(recovered.recovered, before.recovered + 22);
    close(recovered.net, before.net);
  });

  it("only shows a user's own outlets in their totals", () => {
    const manager = userById["u-rm"];
    const ids = scopeOutlets(manager, { propertyId: "all", outletId: "all", dept: "all" });
    expect(ids).toEqual(["dxb-terrace"]);
    const mine = computeTotals(ctx(), sel({ outletIds: ids, wholeProperties: [] }));
    const terrace = totalsByOutlet(ctx(), sel()).find((r) => r.outletId === "dxb-terrace")!;
    close(mine.net, terrace.now.net);
  });
});

describe("pricing", () => {
  it("applies supplier price changes from their date", () => {
    expect(ingredientCostAt("wagyu", "2026-09-23")).toBe(ingredientById.wagyu.cost);
    expect(ingredientCostAt("wagyu", "2026-09-24")).toBe(182);
    expect(itemCostAt("burger", "2026-09-24")).toBeGreaterThan(itemCostAt("burger", "2026-09-23"));
  });

  it("carries a price change made today into recipe cost, margin and today's cost of sales only", () => {
    const overrides: PriceChange[] = [{ id: "wagyu", from: DEMO_TODAY, value: 400 }];
    const before = itemEconomics("burger", "dxb-terrace", DEMO_TODAY);
    const after = itemEconomics("burger", "dxb-terrace", DEMO_TODAY, overrides);
    // itemEconomics rounds to cents, so allow a cent either way.
    close(after.cost - before.cost, 0.18 * (400 - 182), 0.011);
    expect(after.margin).toBeLessThan(before.margin);
    const today = sel({ range: presetRange("today") });
    expect(computeTotals(ctx({ overrides }), today).theoCost).toBeGreaterThan(computeTotals(ctx(), today).theoCost);
    const yesterday = sel({ range: { from: addDays(DEMO_TODAY, -1), to: addDays(DEMO_TODAY, -1) } });
    close(computeTotals(ctx({ overrides }), yesterday).theoCost, computeTotals(ctx(), yesterday).theoCost);
  });
});

describe("stock", () => {
  const inputs = (over: Partial<StockInputs> = {}): StockInputs => ({ dayItems: data.dayItems, counts: data.counts, deliveries: data.deliveries, transfers: data.transfers, waste: data.wasteLogs, ...over });
  const row = (id: string, i: StockInputs) => stockPosition("dxb", i).find((r) => r.ingredientId === id)!;

  it("estimates stock as count plus deliveries less usage, waste and transfers", () => {
    for (const r of stockPosition("dxb", inputs())) {
      close(r.estimated, r.baselineQty + r.received - r.usage - r.waste - r.breakage + r.transferIn - r.transferOut, 1e-6);
      expect(r.estimated).toBeGreaterThanOrEqual(0);
    }
  });

  it("lowers estimated stock and raises waste cost when waste is logged", () => {
    const log: WasteLog = { id: "W-T", outletId: "dxb-terrace", date: DEMO_TODAY, ingredientId: "salmon", qty: 1.5, reason: "spoilage", by: "TRC-S9", synced: true, seq: 1 };
    const before = row("salmon", inputs());
    const after = row("salmon", inputs({ waste: [...data.wasteLogs, log] }));
    close(after.estimated, before.estimated - 1.5, 1e-6);
    close(wasteCost(log), 1.5 * 151);
    const s = sel({ range: presetRange("today") });
    close(computeTotals(ctx({ waste: [...data.wasteLogs, log] }), s).waste - computeTotals(ctx(), s).waste, 1.5 * 151);
  });

  it("keeps an offline entry out of stock and reports until it synchronises", () => {
    const log: WasteLog = { id: "W-O", outletId: "dxb-terrace", date: DEMO_TODAY, ingredientId: "salmon", qty: 2, reason: "waste", by: "TRC-S9", synced: false, seq: 1 };
    close(row("salmon", inputs({ waste: [...data.wasteLogs, log] })).estimated, row("salmon", inputs()).estimated, 1e-9);
    const s = sel({ range: presetRange("today") });
    close(computeTotals(ctx({ waste: [...data.wasteLogs, log] }), s).waste, computeTotals(ctx(), s).waste);
  });

  it("converts a wasted dish into its recipe ingredients", () => {
    const log: WasteLog = { id: "W-D", outletId: "dxb-terrace", date: DEMO_TODAY, itemId: "burger", qty: 2, reason: "waste", by: "TRC-S9", synced: true, seq: 1 };
    close(row("wagyu", inputs({ waste: [...data.wasteLogs, log] })).estimated, row("wagyu", inputs()).estimated - 0.36, 1e-6);
  });

  it("restarts the estimate from a new count and reports the difference once", () => {
    const before = row("coke", inputs());
    const count: CountRecord = { id: "C-T", propertyId: "dxb", ingredientId: "coke", date: DEMO_TODAY, kind: "spot", expected: before.estimated, counted: before.estimated - 12, by: "TRC-S9", seq: 5, allocation: { "dxb-terrace": 1 } };
    const after = row("coke", inputs({ counts: [...data.counts, count] }));
    close(after.estimated, before.estimated - 12, 1e-6);
    const later: WasteLog = { id: "W-L", outletId: "dxb-terrace", date: DEMO_TODAY, ingredientId: "coke", qty: 3, reason: "damaged", by: "TRC-S9", synced: true, seq: 6 };
    close(row("coke", inputs({ counts: [...data.counts, count], waste: [...data.wasteLogs, later] })).estimated, before.estimated - 15, 1e-6);
    const s = sel({ range: presetRange("today") });
    close(computeTotals(ctx({ counts: [...data.counts, count] }), s).variance - computeTotals(ctx(), s).variance, 12 * 3.5);
  });

  it("matches order, delivery and invoice", () => {
    const ok = matchDeliveryLine({ ingredientId: "salmon", ordered: 10, delivered: 10, invoiced: 10, poPrice: 150, invoicePrice: 150 });
    expect(ok.issues).toEqual([]);
    expect(ok.overcharge).toBe(0);
    const short = matchDeliveryLine({ ingredientId: "salmon", ordered: 10, delivered: 8, invoiced: 10, poPrice: 150, invoicePrice: 150 });
    expect(short.issues).toEqual(["short_delivery", "invoiced_not_delivered"]);
    expect(short.overcharge).toBe(300);
    const dear = matchDeliveryLine({ ingredientId: "salmon", ordered: 10, delivered: 10, invoiced: 10, poPrice: 150, invoicePrice: 156 });
    expect(dear.issues).toEqual(["price_above_po"]);
    expect(dear.overcharge).toBe(60);
  });
});

describe("forecast", () => {
  const stock: StockInputs = { dayItems: data.dayItems, counts: data.counts, deliveries: data.deliveries, transfers: data.transfers, waste: data.wasteLogs };
  const base = defaultInputs(data, "dxb");
  const total = (f: ReturnType<typeof buildForecast>) => f.items.reduce((s, i) => s + i.total, 0);

  it("forecasts seven days and raises demand with occupancy, reservations and events", () => {
    const f = buildForecast(data, stock, "dxb", base);
    expect(f.days).toHaveLength(7);
    expect(f.days[0]).toBe(addDays(DEMO_TODAY, 1));
    expect(total(buildForecast(data, stock, "dxb", { ...base, occupancy: base.occupancy + 0.1 }))).toBeGreaterThan(total(f));
    expect(total(buildForecast(data, stock, "dxb", { ...base, occupancy: base.occupancy - 0.1 }))).toBeLessThan(total(f));
    expect(total(buildForecast(data, stock, "dxb", { ...base, reservations: base.reservations * 1.3 }))).toBeGreaterThan(total(f));
    expect(total(buildForecast(data, stock, "dxb", { ...base, eventAttendance: base.eventAttendance + 200 }))).toBeGreaterThan(total(f));
  });

  it("suggests whole packs that satisfy the stated arithmetic", () => {
    for (const p of buildForecast(data, stock, "dxb", base).plans) {
      const need = p.demand + p.safety - p.onHand - p.incoming;
      const pack = orderPack(ingredientById[p.ingredientId]);
      expect(p.pack).toBe(pack);
      if (need <= 0) expect(p.suggested).toBe(0);
      else {
        expect(p.suggested).toBeGreaterThanOrEqual(need - 1e-6);
        expect(p.suggested - need).toBeLessThan(pack + 1e-6);
        close(Math.round(p.suggested / pack) * pack, p.suggested, 1e-6);
      }
    }
  });

  it("orders more with more safety stock and less when more stock is on hand", () => {
    const plan = (i: typeof base) => buildForecast(data, stock, "dxb", i).plans.find((p) => p.ingredientId === "salmon")!;
    const normal = plan(base);
    expect(plan({ ...base, safetyDays: 3 }).suggested).toBeGreaterThanOrEqual(normal.suggested);
    expect(plan({ ...base, stockOverride: { salmon: 0 } }).suggested).toBeGreaterThan(plan({ ...base, stockOverride: { salmon: 500 } }).suggested);
    expect(plan({ ...base, stockOverride: { salmon: 500 } }).suggested).toBe(0);
    // Salmon is delivered daily, so tomorrow's delivery covers an empty shelf. Truffle paste has a four-day lead time and no delivery tomorrow.
    expect(plan({ ...base, stockOverride: { salmon: 0 } }).shortageDay).toBeNull();
    const truffle = buildForecast(data, stock, "dxb", { ...base, stockOverride: { truffle: 0 } }).plans.find((p) => p.ingredientId === "truffle")!;
    expect(truffle.shortageDay).toBe(addDays(DEMO_TODAY, 1));
    expect(truffle.suggested).toBeGreaterThan(0);
  });
});

describe("operations", () => {
  it("predicts later finishes as the kitchen gets busier", () => {
    const t = data.liveOrders.find((o) => o.outletId === "dxb-terrace" && o.station === "kitchen" && o.status === "preparing")!;
    const calm = predictTicket(t, data.liveOrders, { kitchenExtra: 0, barExtra: 0 }, DEMO_NOW_MIN, 1);
    const busy = predictTicket(t, data.liveOrders, { kitchenExtra: 20, barExtra: 0 }, DEMO_NOW_MIN, 1);
    expect(busy.predictedTotal).toBeGreaterThan(calm.predictedTotal);
    expect(stationLoad("dxb-terrace", "kitchen", data.liveOrders, { kitchenExtra: 20, barExtra: 0 }).factor).toBeGreaterThan(1);
    expect(predictTicket({ ...t, status: "served" }, data.liveOrders, { kitchenExtra: 0, barExtra: 0 }, DEMO_NOW_MIN, 1).risk).toBe("done");
  });

  it("recommends prioritising the suite whose guest arrives in 35 minutes", () => {
    const arrival = data.arrivals.find((a) => a.id === "ARR-dxb-0")!;
    const room = data.rooms.find((r) => r.propertyId === "dxb" && r.number === arrival.room)!;
    expect(arrival.etaMin - DEMO_NOW_MIN).toBe(35);
    expect(room.status).toBe("cleaning");
    expect(assessArrival(arrival, room, DEMO_NOW_MIN).risk).toBe("late");
    const boosted = { ...room, priority: true };
    expect(roomReadyAt(boosted, DEMO_NOW_MIN)!).toBeLessThan(arrival.etaMin);
    expect(["ok", "tight"]).toContain(assessArrival(arrival, boosted, DEMO_NOW_MIN).risk);
  });
});

describe("access", () => {
  const owner = userById["u-owner"];
  const manager = userById["u-rm"];
  const employee = userById["u-emp"];
  const controller = userById["u-fc"];

  it("clamps any requested scope to what the user may see", () => {
    expect(clampScope(manager, { propertyId: "doh", outletId: "doh-sky", dept: "all" })).toEqual({ propertyId: "dxb", outletId: "dxb-terrace", dept: "all" });
    expect(scopeOutlets(manager, { propertyId: "all", outletId: "all", dept: "all" })).toEqual(["dxb-terrace"]);
    expect(scopeOutlets(userById["u-gm"], { propertyId: "doh", outletId: "all", dept: "all" }).every((id) => id.startsWith("dxb"))).toBe(true);
    expect(allowedOutlets(owner)).toHaveLength(OUTLETS.length);
    expect(scopeCurrency(owner, { propertyId: "all", outletId: "all", dept: "all" })).toBe("AED");
    expect(scopeCurrency(owner, { propertyId: "doh", outletId: "all", dept: "all" })).toBe("QAR");
  });

  it("limits modules and actions by role", () => {
    expect(canOpen(employee, "overview")).toBe(false);
    expect(canOpen(employee, "money")).toBe(false);
    expect(canOpen(employee, "stock")).toBe(true);
    expect(canOpen(manager, "rooms")).toBe(false);
    expect(canOpen(controller, "flow")).toBe(false);
    expect(can(manager, "investigation.close")).toBe(true);
    expect(can(manager, "investigation.reopen")).toBe(false);
    expect(can(employee, "investigation.close")).toBe(false);
    expect(can(controller, "stock.logWaste")).toBe(false);
    expect(moduleOfPath("/money/orders/TRC-1")).toBe("money");
    expect(moduleOfPath("/menu/burger")).toBe("overview");
    for (const u of USERS) expect(canOpen(u, "settings")).toBe(true);
  });

  it("refuses actions outside role or outlet", () => {
    expect(() => assertCan(undefined, "stock.logWaste")).toThrow(AccessError);
    expect(() => assertCan(employee, "investigation.close", "dxb-terrace")).toThrow(AccessError);
    expect(() => assertCan(manager, "investigation.close", "doh-sky")).toThrow(AccessError);
    expect(() => assertCan(manager, "investigation.close", "dxb-terrace")).not.toThrow();
  });
});

describe("dataset", () => {
  it("is deterministic and internally consistent", () => {
    expect(getDataset()).toBe(data);
    expect(data.orders.length).toBeGreaterThan(20000);
    expect(data.orders.filter((o) => o.date === DEMO_TODAY).every((o) => o.closeMin <= DEMO_NOW_MIN)).toBe(true);
    expect(new Set(data.exceptions.map((e) => e.id)).size).toBe(data.exceptions.length);
    for (const e of data.exceptions) expect(data.seedInvestigations[e.id]).toBeDefined();
    expect(data.seedInvestigations[HERO_EXCEPTION_ID].status).toBe("new");
    const c = compare(ctx(), sel());
    expect(c.now.net).toBeGreaterThan(0);
    expect(c.before.net).toBeGreaterThan(0);
  });

  it("finds the repeated pattern at The Terrace that the worked example belongs to", () => {
    const patterns = detectPatterns(data.exceptions, DEMO_TODAY);
    expect(patterns.some((p) => p.outletId === "dxb-terrace" && p.staffId === "TRC-S2")).toBe(true);
  });
});
