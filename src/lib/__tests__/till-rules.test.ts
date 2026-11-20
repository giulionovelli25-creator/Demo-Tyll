// Till rules (overnight feature 5): the four rules with the cases they must not flag, the planted stories, the totals
// across the check, the flags page and the Money Back List, and who may see it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-till-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { POLICY, TILL_TYPES, TYPE_LABEL, detectOrderException, ringFinding } = await import("../domain/detect");
const { MIX_RULES, mixFlagged, mixValue, mixWeek, detectMix } = await import("../domain/till-rules");
const { explain } = await import("../domain/explain");
const { orderTimeline, orderTotals } = await import("../domain/orders");
const { computeTotals } = await import("../domain/metrics");
const { getDataset, TILL_RATES } = await import("../data/generate");
const { demoCases } = await import("../data/demo-cases");
const { MIX_STORY_EXCEPTION_ID, TILL_PRICE_ORDER_ID, TILL_RING_ORDER_ID, TILL_STORY_EXCEPTION_ID, TILL_STORY_ORDER_ID, WAITER_STORY } = await import("../data/constants");
const { tillCheckFor } = await import("../server/till");
const { snapshotFor } = await import("../server/snapshot");
const { userById, outletById } = await import("../data/catalog");
const { can } = await import("../domain/access");
const { activeItem } = await import("../nav");
const { shiftOf } = await import("../domain/pour");
const { DEMO_TODAY, addDays, rel } = await import("../util");
type Order = import("../types").Order;
type OrderLine = import("../types").OrderLine;
type MixEvidence = import("../types").MixEvidence;

const line = (itemId: string, qty: number, unitPrice: number, extra: Partial<OrderLine> = {}): OrderLine => ({ itemId, qty, unitPrice, state: "kept", enteredMin: 20 * 60, sentMin: 20 * 60 + 1, ...extra });
const bill = (lines: OrderLine[], extra: Partial<Order> = {}): Order => ({
  id: "MER-T-001", outletId: "lis-terrace", date: DEMO_TODAY, openMin: 19 * 60 + 50, closeMin: 21 * 60, covers: 2, staffId: "MER-S3", table: "Table 1", lines, discountPct: 0, payment: "card", ...extra,
});
const d0 = getDataset();
const fnb = userById["u-fnb"];

describe("bill reopened after payment", () => {
  const paidLines = () => [line("lambchops", 2, 34), line("salmon", 1, 29)];
  const reopenedLower = (extra: Partial<NonNullable<Order["reopened"]>> = {}, removed: Partial<OrderLine> = {}) => {
    const ls = paidLines();
    Object.assign(ls[0], { state: "removed_post", removedMin: 21 * 60 + 31, removedBy: "MER-S3", ...removed });
    return bill(ls, { payment: "cash", reopened: { min: 21 * 60 + 30, closedMin: 21 * 60 + 32, by: "MER-S3", paid: 97, ...extra } });
  };

  it("flags a paid bill reopened and closed lower with no manager's approval, valued at the drop", () => {
    const e = detectOrderException(reopenedLower())!;
    expect(e.type).toBe("bill_reopened");
    expect(e.exposure).toBe(68);
    expect(e.min).toBe(21 * 60 + 30);
    expect(e.headline).toBe("Bill reopened 30 min after payment and closed €68 lower");
    expect(e.comparedWith).toContain("paid €97 by cash at 9:00 PM, reopened at 9:30 PM, closed again at €29");
  });

  it("does not flag a reopen a manager approved, a tip added, a total that went up, or a drop within rounding", () => {
    expect(detectOrderException(reopenedLower({ approvedBy: "MER-S7", reason: "Dish sent back" }, { approvedBy: "MER-S7", reason: "Dish sent back" }))).toBeNull();
    expect(detectOrderException(bill(paidLines(), { reopened: { min: 21 * 60 + 20, closedMin: 21 * 60 + 21, by: "MER-S3", paid: 97, change: "Tip added to the card payment" } }))).toBeNull();
    const more = [...paidLines(), line("fondant", 1, 11, { enteredMin: 21 * 60 + 25 })];
    expect(detectOrderException(bill(more, { reopened: { min: 21 * 60 + 24, closedMin: 21 * 60 + 26, by: "MER-S3", paid: 97 } }))).toBeNull();
    expect(detectOrderException(bill(paidLines(), { reopened: { min: 21 * 60 + 20, closedMin: 21 * 60 + 21, by: "MER-S3", paid: 97.4 } }))).toBeNull();
  });

  it("is checked before the removal rule, and a void still comes first", () => {
    expect(detectOrderException(reopenedLower())!.type).toBe("bill_reopened");
    const voided = reopenedLower();
    voided.voided = { min: 21 * 60 + 40 };
    expect(detectOrderException(voided)?.type).toBe("unexplained_void");
  });

  it("shows the reopen, what came off and the second close in the order history", () => {
    const ev = orderTimeline(reopenedLower());
    expect(ev.find((x) => x.kind === "reopened")).toMatchObject({ title: "Bill reopened after payment", flagged: true });
    expect(ev.find((x) => x.kind === "removed")?.title).toBe("2 × Lamb chops taken off the paid bill");
    expect(ev.find((x) => x.title === "Bill closed again")?.detail).toBe("Total 29, 68 less than paid");
    // An approved reopen is shown but not marked.
    const ok = orderTimeline(reopenedLower({ approvedBy: "MER-S7" }, { approvedBy: "MER-S7" }));
    expect(ok.find((x) => x.kind === "reopened")?.flagged).toBe(false);
  });
});

describe("open item, misc button and prices set by hand", () => {
  const priced = (unitPrice: number, till: Partial<NonNullable<OrderLine["till"]>> = {}) => bill([line("lobster", 1, unitPrice, { till: { kind: "open_item", menuPrice: 39, ...till } }), line("caesar", 1, 16)]);

  it("flags a price more than 10% below the menu price of the item on the ticket, for each way of setting it", () => {
    for (const kind of ["open_item", "misc", "override"] as const) {
      const e = detectOrderException(priced(20, { kind }))!;
      expect(e.type).toBe("price_override");
      expect(e.exposure).toBe(19);
    }
    expect(detectOrderException(priced(20))!.headline).toBe("Lobster linguine rung as an open item at €20, menu price €39");
    expect(detectOrderException(priced(20, { kind: "misc" }))!.headline).toBe("Lobster linguine rung on the misc button at €20, menu price €39");
  });

  it("values every line below the menu, times the quantity", () => {
    const o = bill([line("salmon", 2, 18, { till: { kind: "override", menuPrice: 33 } }), line("caesar", 1, 12, { till: { kind: "misc", menuPrice: 16 } })]);
    expect(detectOrderException(o)!.exposure).toBe(2 * 15 + 4);
  });

  it("does not flag a price a manager approved, one within 10% of the menu, or a price raised for an extra", () => {
    expect(detectOrderException(priced(20, { approvedBy: "MER-S6", reason: "Half portion" }))).toBeNull();
    expect(detectOrderException(priced(36))).toBeNull();
    expect(detectOrderException(priced(39 * (1 - POLICY.priceBelowShare)))).toBeNull();
    expect(detectOrderException(priced(42, { kind: "override", reason: "Extra side" }))).toBeNull();
  });
});

describe("rung twice or an unusual quantity", () => {
  const at = (min: number, sec: number) => ({ enteredMin: min, enteredSec: sec });

  it("flags the same item entered twice within seconds when the bill has more of it than guests", () => {
    const o = bill([line("salmon", 1, 29, at(20 * 60, 10)), line("salmon", 1, 29, at(20 * 60, 15)), line("still", 1, 4.5)], { covers: 1 });
    const e = detectOrderException(o)!;
    expect(e.type).toBe("duplicate_ring");
    expect(e.exposure).toBe(29);
    expect(e.headline).toBe("Grilled salmon rung twice 5 seconds apart, 2 on the bill for 1 guest");
    expect(e.comparedWith).toContain("8:00:10 PM and 8:00:15 PM");
    // Across a minute boundary it is still seconds apart.
    expect(ringFinding(bill([line("beer", 1, 6.5, at(20 * 60, 57)), line("beer", 1, 6.5, at(20 * 60 + 1, 2))], { covers: 1 }))).toMatchObject({ kind: "twice", seconds: 5 });
  });

  it("does not flag two coffees for two guests rung one by one, a second round, an entry taken off, or entries with no seconds", () => {
    expect(detectOrderException(bill([line("cappuccino", 1, 4.5, at(20 * 60, 10)), line("cappuccino", 1, 4.5, at(20 * 60, 14))], { covers: 2 }))).toBeNull();
    expect(detectOrderException(bill([line("beer", 1, 6.5, at(20 * 60, 10)), line("beer", 1, 6.5, at(20 * 60, 10 + POLICY.duplicateSeconds + 5))], { covers: 1 }))).toBeNull();
    expect(detectOrderException(bill([line("beer", 1, 6.5, at(20 * 60, 10)), line("beer", 1, 6.5, { ...at(20 * 60, 13), state: "removed_pre", removedMin: 20 * 60 })], { covers: 1 }))).toBeNull();
    expect(detectOrderException(bill([line("beer", 1, 6.5), line("beer", 1, 6.5)], { covers: 1 }))).toBeNull();
  });

  it("flags a quantity far above normal, valued beyond one a guest, and not a large but plausible round", () => {
    const e = detectOrderException(bill([line("cappuccino", 12, 4.5)], { covers: 2 }))!;
    expect(e.type).toBe("duplicate_ring");
    expect(e.exposure).toBe(45);
    expect(e.headline).toBe("12 × Cappuccino on one bill for 2 guests");
    // Eight beers for four guests is two each; five espressos for one guest is below the minimum.
    expect(detectOrderException(bill([line("beer", 8, 6.5)], { covers: 4 }))).toBeNull();
    expect(detectOrderException(bill([line("cappuccino", 5, 4.5)], { covers: 1 }))).toBeNull();
    expect(detectOrderException(bill([line("beer", POLICY.quantityMin, 6.5)], { covers: 2 }))).toBeNull();
  });
});

describe("cheaper item rung up", () => {
  const week = (over: Partial<MixEvidence> = {}): MixEvidence => ({
    from: rel(-7), to: rel(-1), rule: "premium", labelId: "reserve", premiumItemId: "reserve", cheapItemId: "wine", perBottle: 5,
    bottles: 11, billed: 33, gap: 22, cheapBilled: 300, priceGap: 7, before: { bottles: 6.25, billed: 31, cheapBilled: 300 }, ...over,
  });

  it("flags premium bottles going out two bottles and a quarter beyond the premium sales, with the cheaper serve billed", () => {
    expect(mixFlagged(week())).toBe(true);
    expect(mixValue(week())).toBe(154);
  });

  it("does not flag one open bottle, a gap under a quarter, or a gap the cheaper serve cannot account for", () => {
    expect(mixFlagged(week({ bottles: 8, gap: 7 }))).toBe(false);
    expect(mixFlagged(week({ bottles: 50, billed: 240, gap: 10 }))).toBe(false);
    expect(mixFlagged(week({ bottles: 50, billed: 195, gap: 55 }))).toBe(false);
    // The drinks were not rung up at all: Over pouring's question, not this rule's.
    expect(mixFlagged(week({ cheapBilled: 12 }))).toBe(false);
  });

  it("counts a double as two measures, and values the gap as doubles rung as singles", () => {
    const day = (itemId: string, units: number) => ({ outletId: "lis-lobby", date: rel(-1), itemId, late: false, units, gross: 0, comps: 0, discounts: 0, refunds: 0 });
    const issue = (bottles: number) => [{ outletId: "lis-lobby", date: rel(-1), labelId: "gin", bottles }];
    const m = mixWeek([day("gintonic", 40), day("gintonic2", 5)], issue(6), "lis-lobby", "gin", rel(-1));
    expect(m).toMatchObject({ perBottle: 14, billed: 50, cheapBilled: 40, gap: 34, priceGap: 6 });
    expect(mixFlagged(m)).toBe(true);
    expect(mixValue(m)).toBe(204);
    // Five bottles give 70 measures: 20 beyond the bills is under two bottles.
    expect(mixFlagged(mixWeek([day("gintonic", 40), day("gintonic2", 5)], issue(5), "lis-lobby", "gin", rel(-1)))).toBe(false);
  });

  it("raises one flag per week and bottle at the bar, dated the morning after, an estimate", () => {
    const flags = detectMix(d0.dayItems, d0.bottleIssues, DEMO_TODAY);
    const story = flags.find((e) => e.id === MIX_STORY_EXCEPTION_ID)!;
    expect(story).toMatchObject({ type: "cheaper_item_rung", outletId: "lis-lobby", date: DEMO_TODAY, min: 6 * 60, basis: "estimate" });
    expect(story.exposure).toBe(mixValue(story.mix!));
    expect(new Set(flags.map((e) => e.id)).size).toBe(flags.length);
    // Outside the story weeks the bottles follow the sales: only the story and the closed gin week of five weeks ago.
    expect(flags.map((e) => e.mix!.labelId).sort()).toEqual(["gin", "reserve"]);
  });
});

describe("the planted stories", () => {
  it("last night's Mercado bill: paid cash, reopened 24 minutes later, two lamb chops off with no approval", () => {
    const o = d0.ordersById.get(TILL_STORY_ORDER_ID)!;
    const e = d0.exceptions.find((x) => x.id === TILL_STORY_EXCEPTION_ID)!;
    expect(o.date).toBe(rel(-1));
    expect(o.payment).toBe("cash");
    expect(o.reopened!.paid).toBe(124);
    expect(orderTotals(o).net).toBe(56);
    expect(e).toMatchObject({ type: "bill_reopened", exposure: 68, staffId: "MER-S3" });
    expect(d0.seedInvestigations[e.id].status).toBe("new");
    const x = explain(e, d0, d0.counts, []);
    expect(x.facts.join(" ")).toContain("The kitchen display marked Lamb chops ready at 9:34 PM, before the guests paid.");
    expect(x.message).toContain("2 × Lamb chops came off");
    // The lamb count at close agrees: Mercado's lamb use above the recipes includes this bill.
    const lamb = d0.exceptions.find((v) => v.type === "usage_variance" && v.ingredientId === "lamb" && v.outletId === "lis-terrace");
    expect(lamb?.period?.removals.some((r) => r.orderId === TILL_STORY_ORDER_ID)).toBe(true);
  });

  it("two checked examples from two days ago: a price changed by hand at In-Room Dining and twelve cappuccinos at Bar Azulejo", () => {
    const price = d0.exceptions.find((e) => e.orderId === TILL_PRICE_ORDER_ID)!;
    const ring = d0.exceptions.find((e) => e.orderId === TILL_RING_ORDER_ID)!;
    expect(price.date).toBe(rel(-2));
    expect(d0.seedInvestigations[price.id]).toMatchObject({ status: "closed", outcome: "confirmed_loss", confirmedLoss: 30 });
    expect(d0.seedInvestigations[ring.id]).toMatchObject({ status: "closed", outcome: "legitimate", recovered: 0 });
    // The public demo keeps both, so each rule has a case to show in the default seven days.
    const kept = new Set(demoCases(d0.exceptions, d0.seedInvestigations).map((e) => e.id));
    expect(kept.has(price.id) && kept.has(ring.id)).toBe(true);
    expect(d0.exceptions.find((e) => e.orderId === TILL_PRICE_ORDER_ID)).toMatchObject({ type: "price_override", exposure: 30, headline: "Grilled salmon price changed by hand at €18, menu price €33" });
    expect(d0.exceptions.find((e) => e.orderId === TILL_RING_ORDER_ID)).toMatchObject({ type: "duplicate_ring", exposure: 50, headline: "12 × Cappuccino on one bill for 2 guests" });
  });

  it("the reserve red story is flagged on every business day of a week, the largest till flag", async () => {
    for (let i = 0; i < 7; i++) {
      vi.resetModules();
      process.env.TYLL_DEMO_DATE = addDays("2026-11-16", i);
      const g = await import("../data/generate");
      const c = await import("../data/constants");
      const d = g.getDataset();
      const e = d.exceptions.find((x) => x.id === c.MIX_STORY_EXCEPTION_ID);
      expect(e, c.MIX_STORY_EXCEPTION_ID).toBeDefined();
      expect(e!.exposure).toBeGreaterThan(120);
      expect(e!.exposure).toBeLessThan(220);
      // Premium bottles rose from about six a week.
      expect(e!.mix!.before.bottles).toBeLessThan(8);
      expect(e!.mix!.bottles).toBeGreaterThanOrEqual(10);
      expect(d.exceptions.find((x) => x.id === c.TILL_STORY_EXCEPTION_ID)?.exposure).toBe(68);
    }
    vi.resetModules();
    process.env.TYLL_DEMO_DATE = "2026-10-13";
  });
});

describe("simulated till events", () => {
  const till = d0.exceptions.filter((e) => TILL_TYPES.includes(e.type));

  it("never touch Mercado's evening bills, so the drinks per guest story is as it was", () => {
    for (const o of d0.orders) {
      if (o.outletId !== WAITER_STORY.outletId || shiftOf(o.openMin) !== WAITER_STORY.shift || o.id === TILL_STORY_ORDER_ID) continue;
      expect(o.reopened, o.id).toBeUndefined();
      expect(o.lines.some((l) => l.till || l.enteredSec !== undefined), o.id).toBe(false);
    }
  });

  it("include ordinary cases that are never flagged: tips after payment, prices raised, two of the same for two guests", () => {
    const reopenedNotFlagged = d0.orders.filter((o) => o.reopened && !till.some((e) => e.orderId === o.id));
    expect(reopenedNotFlagged.length).toBeGreaterThan(0);
    expect(d0.orders.some((o) => o.lines.some((l) => l.till && l.unitPrice > l.till.menuPrice))).toBe(true);
    const pairs = d0.orders.filter((o) => o.lines.filter((l) => l.enteredSec !== undefined).length >= 2 && !ringFinding(o));
    expect(pairs.length).toBeGreaterThan(10);
    for (const o of pairs) expect(detectOrderException(o)?.type).not.toBe("duplicate_ring");
  });

  it("stay rare: a handful of each rule a month, under 1% of bills", () => {
    const from = addDays(DEMO_TODAY, -29);
    const month = till.filter((e) => e.date >= from);
    const bills = d0.orders.filter((o) => o.date >= from).length;
    expect(month.length / bills).toBeLessThan(0.01);
    for (const type of TILL_TYPES) expect(month.filter((e) => e.type === type).length, type).toBeGreaterThan(0);
    expect(TILL_RATES.reopen).toBeLessThan(0.005);
  });

  it("give every till case a seeded state, older ones closed with a note that fits the rule", () => {
    for (const e of till) {
      const s = d0.seedInvestigations[e.id];
      expect(s, e.id).toBeDefined();
      if (s.status === "closed") expect(s.notes[0].text.length, e.id).toBeGreaterThan(10);
    }
  });
});

describe("the till rule check", () => {
  it("lists the same flags as the flags page, and its totals add up", () => {
    const r = tillCheckFor(fnb, { from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY });
    if (!r.ok) throw new Error(r.error);
    const flags = snapshotFor(fnb).exceptions.filter((e) => TILL_TYPES.includes(e.type) && e.date >= r.from && e.date <= r.to);
    expect(r.rows.map((x) => x.caseId).sort()).toEqual(flags.map((e) => e.id).sort());
    for (const rule of r.rules) {
      const of = flags.filter((e) => e.type === rule.type);
      expect(rule.flagged, rule.type).toBe(of.length);
      expect(rule.value, rule.type).toBeCloseTo(of.reduce((s, e) => s + e.exposure, 0), 2);
      expect(rule.seen, rule.type).toBeGreaterThanOrEqual(rule.flagged);
    }
    expect(r.rules.reduce((s, x) => s + x.value, 0)).toBeCloseTo(r.rows.reduce((s, x) => s + x.atStake, 0), 2);
    // The 30 day trend adds up to the 30 day list.
    expect(r.days.reduce((s, x) => s + x.value, 0)).toBeCloseTo(r.rows.reduce((s, x) => s + x.atStake, 0), 2);
    expect(r.bills).toBe(d0.orders.filter((o) => o.date >= r.from).length);
    expect(r.story?.caseId).toBe(TILL_STORY_EXCEPTION_ID);
    expect(r.bottles.find((b) => b.labelId === "reserve")?.flagged).toBe(true);
    expect(r.bottles.find((b) => b.labelId === "gin")?.flagged).toBe(false);
  });

  it("agrees with the flags in the public demo too, with every row's case kept and the stories in", () => {
    const was = process.env.TYLL_PUBLIC_DEMO;
    process.env.TYLL_PUBLIC_DEMO = "on";
    try {
      const kept = new Set(demoCases(d0.exceptions, d0.seedInvestigations).map((e) => e.id));
      expect(kept.has(TILL_STORY_EXCEPTION_ID)).toBe(true);
      expect(kept.has(MIX_STORY_EXCEPTION_ID)).toBe(true);
      const r = tillCheckFor(fnb, { from: addDays(DEMO_TODAY, -6), to: DEMO_TODAY });
      if (!r.ok) throw new Error(r.error);
      const sent = new Set(snapshotFor(fnb).exceptions.map((e) => e.id));
      for (const row of r.rows) expect(sent.has(row.caseId), row.caseId).toBe(true);
      expect(r.rows.length).toBe(snapshotFor(fnb).exceptions.filter((e) => TILL_TYPES.includes(e.type) && e.date >= r.from).length);
      const open = demoCases(d0.exceptions, d0.seedInvestigations).filter((e) => d0.seedInvestigations[e.id]?.status !== "closed");
      expect(open.length).toBeLessThanOrEqual(12);
    } finally {
      if (was === undefined) delete process.env.TYLL_PUBLIC_DEMO;
      else process.env.TYLL_PUBLIC_DEMO = was;
    }
  });

  it("counts each flagged bill once in flags per 1,000 orders, and the weekly bottle check once", async () => {
    const { NO_ADJUSTMENTS } = await import("../domain/variance");
    type Ctx = Parameters<typeof computeTotals>[0];
    type Sel = Parameters<typeof computeTotals>[1];
    const sel: Sel = { outletIds: ["lis-terrace", "lis-lobby", "lis-banquets", "lis-ird"], wholeProperties: ["lis"], range: { from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY }, currency: "EUR", dept: "all" };
    const ctx = (data: typeof d0): Ctx => ({ data, waste: data.wasteLogs, counts: data.counts, overrides: [], investigations: {}, adjust: NO_ADJUSTMENTS });
    const others = d0.exceptions.filter((e) => !TILL_TYPES.includes(e.type));
    const before = computeTotals(ctx({ ...d0, exceptions: others }), sel).adjustments;
    const after = computeTotals(ctx(d0), sel).adjustments;
    const till = d0.exceptions.filter((e) => TILL_TYPES.includes(e.type) && e.date >= sel.range.from);
    const otherOrders = new Set(others.filter((e) => e.date >= sel.range.from && e.orderId).map((e) => e.orderId));
    // A till flag adds its bill unless another flag already counts it; the bottle check has no bill and adds one a week.
    const expected = new Set(till.filter((e) => e.orderId && !otherOrders.has(e.orderId)).map((e) => e.orderId)).size + till.filter((e) => !e.orderId).length;
    expect(after - before).toBe(expected);
    expect(expected).toBeGreaterThan(5);
  });

  it("is open to the managers who see flags, for their own outlets only, and refused to everyone else", () => {
    for (const id of ["u-fnb", "u-gm", "u-fc", "u-owner", "u-rm", "u-lby"]) expect(can(userById[id], "till.view"), id).toBe(true);
    for (const id of ["u-chef", "u-buy", "u-emp", "u-events", "u-fo"]) {
      if (!userById[id]) continue;
      expect(can(userById[id], "till.view"), id).toBe(false);
      expect(tillCheckFor(userById[id], {}), id).toMatchObject({ ok: false, status: 403 });
    }
    const bar = tillCheckFor(userById["u-lby"], { outlets: "lis-lobby,lis-terrace" });
    if (!bar.ok) throw new Error(bar.error);
    expect(bar.rows.every((r) => r.outletId === "lis-lobby")).toBe(true);
    expect(bar.story).toBeNull();
    expect(bar.bottles.length).toBe(2);
    const mercado = tillCheckFor(userById["u-rm"], {});
    if (!mercado.ok) throw new Error(mercado.error);
    expect(mercado.rows.every((r) => r.outletId === "lis-terrace")).toBe(true);
    expect(mercado.bottles).toHaveLength(0);
  });

  it("is reached from Flagged transactions, and every rule has a label and an explanation without dashes", () => {
    expect(activeItem("/money", "till")?.label).toBe("Flagged transactions");
    for (const type of TILL_TYPES) expect(TYPE_LABEL[type]).toBeTruthy();
    const samples = TILL_TYPES.map((t) => d0.exceptions.find((e) => e.type === t)!);
    for (const e of samples) {
      const x = explain(e, d0, d0.counts, []);
      expect(x.facts.length, e.type).toBeGreaterThan(2);
      expect(x.possibleCauses.length, e.type).toBeGreaterThan(1);
      for (const text of [e.headline, e.comparedWith ?? "", x.message, ...x.facts, ...x.possibleCauses, ...x.recommended]) expect(text, text).not.toMatch(/ [-–—] |—|–/);
    }
    expect(outletById["lis-lobby"].sells).toContain("reserve");
    expect(MIX_RULES.minGapBottles).toBe(2);
  });
});

describe("alerts", () => {
  it("brings the reserve red flag to Alerts and the Overview as an estimate from bottles, ranked by money", async () => {
    const { buildIssues } = await import("../domain/issues");
    const { NO_ADJUSTMENTS } = await import("../domain/variance");
    const mix = d0.exceptions.find((e) => e.id === MIX_STORY_EXCEPTION_ID)!;
    const reopen = d0.exceptions.find((e) => e.id === TILL_STORY_EXCEPTION_ID)!;
    const inv = [mix, reopen].map((e) => ({ ...e, ...d0.seedInvestigations[e.id] }));
    const ctx = { data: d0, waste: d0.wasteLogs, counts: d0.counts, overrides: [], investigations: {}, adjust: NO_ADJUSTMENTS };
    const sel = { outletIds: ["lis-terrace", "lis-lobby", "lis-banquets", "lis-ird"], wholeProperties: ["lis"], dept: "all" as const, range: { from: addDays(DEMO_TODAY, -6), to: DEMO_TODAY }, currency: "EUR" as const };
    const issues = buildIssues(ctx as never, sel, inv as never, [], { includeStock: false }).filter((i) => i.kind === "investigation");
    expect(issues.map((i) => i.id)).toEqual([MIX_STORY_EXCEPTION_ID, TILL_STORY_EXCEPTION_ID]);
    expect(issues[0]).toMatchObject({ estimate: true, estimateFrom: "bottles", priority: "high" });
    expect(issues[1].estimate).toBeUndefined();
  });
});

describe("translations", () => {
  it("has German, Italian and Arabic for every till rule text: flags, explanations and the order history", async () => {
    const { Translator } = await import("../i18n/translate");
    const messages = (await import("../i18n/messages.json")).default as unknown as import("../i18n/translate").Messages;
    const { INGREDIENTS, MENU_ITEMS, OUTLETS, PROPERTIES, STAFF, SUPPLIERS, USERS } = await import("../data/catalog");
    const { POUR_SKUS } = await import("../domain/pour");
    const { MIX_LABELS } = await import("../domain/till-rules");
    const entities = { items: [...INGREDIENTS, ...MENU_ITEMS, ...POUR_SKUS, ...MIX_LABELS].map((x) => x.name), names: [...OUTLETS, ...PROPERTIES, ...SUPPLIERS, ...STAFF, ...USERS].map((x) => x.name) };
    const texts = new Set<string>(TILL_TYPES.map((t) => TYPE_LABEL[t]));
    for (const e of d0.exceptions.filter((x) => TILL_TYPES.includes(x.type))) {
      const x = explain(e, d0, d0.counts, []);
      for (const t of [e.headline, e.comparedWith ?? "", (e.comparedWith ?? "").replace(/^Compared with /, ""), x.whatHappened, x.message, ...x.facts, ...x.possibleCauses, ...x.recommended]) texts.add(t);
      const o = e.orderId ? d0.ordersById.get(e.orderId) : undefined;
      if (o) for (const ev of orderTimeline(o)) { texts.add(ev.title); if (ev.detail) texts.add(ev.detail); }
    }
    for (const o of d0.orders.filter((x) => x.reopened || x.lines.some((l) => l.till || l.enteredSec !== undefined))) for (const ev of orderTimeline(o)) { texts.add(ev.title); if (ev.detail) texts.add(ev.detail); }
    const gaps = new Set<string>();
    for (const lang of ["de", "it", "ar"] as const) {
      const tr = new Translator(lang, messages, entities);
      for (const t of texts) {
        if (!t) continue;
        tr.translate(t);
        if (!tr.missing.size) continue;
        // Report the pieces that have no entry, as the screen translates a long line piece by piece.
        for (const piece of t.split(/(?<=[.?!:]) | · |; /)) {
          const one = new Translator(lang, messages, entities);
          one.translate(piece);
          for (const m of one.missing) gaps.add(m);
        }
        tr.missing.clear();
      }
    }
    if (process.env.TILL_GAPS) fs.writeFileSync(process.env.TILL_GAPS, [...gaps].join("\n"));
    expect([...gaps]).toEqual([]);
  });
});
