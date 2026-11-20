// Booked against billed covers (overnight feature 6): the matching rule with the cases it must not flag, the reservation
// book against the figure Predictions uses, the planted stories, the totals across the check, the flags page and the
// Money Back List, and who may see it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-covers-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { COVER_RULES, detectSeatedNoBill, matchBookings, serviceOf, spendPerGuest, totalsOf } = await import("../domain/covers");
const { TYPE_LABEL, inBillsLedger, hasOwnDay } = await import("../domain/detect");
const { explain } = await import("../domain/explain");
const { orderTotals } = await import("../domain/orders");
const { computeTotals } = await import("../domain/metrics");
const { getDataset } = await import("../data/generate");
const { demoCases } = await import("../data/demo-cases");
const { COVERS_EXAMPLE_EXCEPTION_ID, COVERS_STORY, COVERS_STORY_EXCEPTION_ID } = await import("../data/constants");
const { coversCheckFor } = await import("../server/covers");
const { snapshotFor } = await import("../server/snapshot");
const { OUTLETS, userById } = await import("../data/catalog");
const { can } = await import("../domain/access");
const { activeItem } = await import("../nav");
const { DATA_START, DEMO_TODAY, addDays, eachDay, rel } = await import("../util");
type Booking = import("../types").Booking;
type Order = import("../types").Order;

const d0 = getDataset();
const fnb = userById["u-fnb"];
const T = (h: number, m = 0) => h * 60 + m;
const DAY = "2026-10-10";
const book = (extra: Partial<Booking> = {}): Booking => ({
  id: "BK-MER-T-01", outletId: "lis-terrace", date: DAY, service: "dinner", party: 4, table: "Table 7", bookedFor: T(20), status: "seated", seatedMin: T(20, 5), leftMin: T(21, 50), via: "phone", ...extra,
});
const bill = (extra: Partial<Order> = {}): Order => ({
  id: "MER-T-001", outletId: "lis-terrace", date: DAY, openMin: T(20, 8), closeMin: T(21, 40), covers: 4, staffId: "MER-S3", table: "Table 7", discountPct: 0, payment: "card",
  lines: [{ itemId: "salmon", qty: 4, unitPrice: 29, state: "kept", enteredMin: T(20, 10), sentMin: T(20, 11) }], ...extra,
});
const kindOf = (bookings: Booking[], bills: Order[], id = "BK-MER-T-01") => matchBookings(bookings, bills).get(id)?.kind;

describe("the matching rule", () => {
  it("matches a seated booking with the bill opened at its table, from 15 minutes before seating to the finish", () => {
    expect(kindOf([book()], [bill()])).toBe("billed");
    expect(kindOf([book()], [bill({ openMin: T(19, 52) })])).toBe("billed");
    expect(kindOf([book()], [bill({ openMin: T(21, 30) })])).toBe("billed");
    // A voided bill is still a bill: the void rule looks at it.
    expect(kindOf([book()], [bill({ voided: { min: T(21) } })])).toBe("billed");
  });

  it("flags a seated table with no bill, valued at the party times the spend per guest, an estimate", () => {
    const before = [bill({ id: "MER-T-090", date: addDays(DAY, -3), table: "Table 9" })];
    const flags = detectSeatedNoBill([book()], before);
    expect(flags).toHaveLength(1);
    const e = flags[0];
    expect(e).toMatchObject({ id: "EX-BK-MER-T-01", type: "seated_no_bill", outletId: "lis-terrace", date: DAY, min: T(20, 5), basis: "estimate" });
    expect(e.headline).toBe("Booking for 4 seated at Table 7, no bill found");
    // One bill of 4 guests at €116 is €29 a guest, so 4 guests are €116.
    expect(e.booking!.spendPerGuest).toBe(29);
    expect(e.exposure).toBe(116);
    expect(e.comparedWith).toContain("no bill at Table 7 opened between 7:50 PM and 9:50 PM, and no bill for 3 to 5 guests opened elsewhere at Mercado within 20 minutes of seating");
    expect(e.booking!.atTable).toHaveLength(0);
  });

  it("does not flag a bill outside the window as the table's, but lists it", () => {
    const late = bill({ openMin: T(22, 10), closeMin: T(23) });
    expect(kindOf([book()], [late])).toBe("no_bill");
    const e = detectSeatedNoBill([book()], [late])[0];
    expect(e.booking!.atTable.map((o) => o.orderId)).toEqual(["MER-T-001"]);
  });

  it("does not flag a party that left before ordering, and does flag one that stayed 20 minutes or more", () => {
    expect(kindOf([book({ leftMin: T(20, 5 + COVER_RULES.leftEarly - 1) })], [])).toBe("left_early");
    expect(kindOf([book({ leftMin: T(20, 5 + COVER_RULES.leftEarly) })], [])).toBe("no_bill");
  });

  it("does not flag a party seated at another table when a bill for the same party, give or take one, opened within 20 minutes", () => {
    expect(kindOf([book()], [bill({ table: "Table 30", covers: 3, openMin: T(20, 20) })])).toBe("moved");
    expect(kindOf([book()], [bill({ table: "Table 30", covers: 5, openMin: T(19, 55) })])).toBe("moved");
    // A bill for 2 is not this party, nor a bill opened 30 minutes later.
    expect(kindOf([book()], [bill({ table: "Table 30", covers: 2 })])).toBe("no_bill");
    expect(kindOf([book()], [bill({ table: "Table 30", openMin: T(20, 35) })])).toBe("no_bill");
  });

  it("does not flag a booking that joined another at its table on a bill with room for both, and flags one with no room", () => {
    const a = book({ id: "BK-A", party: 2 });
    const b = book({ id: "BK-B", party: 2, seatedMin: T(20, 12) });
    expect(kindOf([a, b], [bill({ covers: 4 })], "BK-B")).toBe("joined");
    expect(kindOf([a, b], [bill({ covers: 3 })], "BK-B")).toBe("joined");
    expect(kindOf([a, b], [bill({ covers: 1 })], "BK-B")).toBe("no_bill");
    // More than 15 minutes apart is two parties.
    expect(kindOf([a, book({ id: "BK-C", party: 2, seatedMin: T(20, 25) })], [bill({ covers: 4 })], "BK-C")).not.toBe("joined");
  });

  it("gives each bill to one booking only, the one seated nearest its opening", () => {
    const early = book({ id: "BK-E", party: 4, seatedMin: T(19), leftMin: T(21) });
    const m = matchBookings([early, book()], [bill()]);
    expect(m.get("BK-MER-T-01")?.kind).toBe("billed");
    expect(m.get("BK-E")?.kind).toBe("no_bill");
  });

  it("never flags or counts no-shows and cancellations as booked", () => {
    const list = [book({ id: "BK-N", status: "no_show", seatedMin: undefined, leftMin: undefined }), book({ id: "BK-X", status: "cancelled", seatedMin: undefined, leftMin: undefined })];
    expect(detectSeatedNoBill(list, [])).toHaveLength(0);
    const t = totalsOf(list, matchBookings(list, []));
    expect(t).toMatchObject({ booked: 0, tables: 0, noShows: 1, noShowGuests: 4, cancelled: 1 });
  });

  it("splits the day into breakfast, lunch and dinner by the time a meal starts", () => {
    expect(serviceOf(T(10, 59))).toBe("breakfast");
    expect(serviceOf(T(11))).toBe("lunch");
    expect(serviceOf(T(16, 59))).toBe("lunch");
    expect(serviceOf(T(17))).toBe("dinner");
  });

  it("values a guest at the outlet's spend at that service over the 28 days before, voided bills and other services left out", () => {
    const date = rel(-1);
    const from = addDays(date, -COVER_RULES.spendDays);
    const bills = d0.orders.filter((o) => o.outletId === "lis-terrace" && !o.voided && o.date >= from && o.date < date && serviceOf(o.openMin) === "dinner");
    const expected = bills.reduce((s, o) => s + orderTotals(o).net, 0) / bills.reduce((s, o) => s + o.covers, 0);
    expect(spendPerGuest(d0.orders, "lis-terrace", "dinner", date)).toBeCloseTo(expected, 1);
    expect(expected).toBeGreaterThan(20);
    expect(expected).toBeLessThan(60);
  });
});

describe("the simulated reservation book", () => {
  it("adds up each closed day to the reservation book figure Predictions uses: seated plus no-shows", () => {
    let days = 0;
    for (const r of d0.reservations) {
      if (r.date >= DEMO_TODAY) continue;
      const booked = d0.bookings.filter((b) => b.outletId === r.outletId && b.date === r.date && b.status !== "cancelled").reduce((s, b) => s + b.party, 0);
      expect(booked, `${r.outletId} ${r.date}`).toBe(r.covers);
      days += 1;
    }
    expect(days).toBe(eachDay({ from: DATA_START, to: rel(-1) }).length);
  });

  it("holds bookings only for outlets that take them, lunch and dinner, closed days only", () => {
    const reservable = new Set(OUTLETS.filter((o) => o.reservable).map((o) => o.id));
    for (const b of d0.bookings) {
      expect(reservable.has(b.outletId)).toBe(true);
      expect(b.service).not.toBe("breakfast");
      expect(b.date < DEMO_TODAY).toBe(true);
      if (b.status === "seated") expect(b.seatedMin).toBeDefined();
    }
  });

  it("keeps the gap small and every total adding up: booked is billed plus left before ordering plus no bill", () => {
    const m = matchBookings(d0.bookings, d0.orders);
    const t = totalsOf(d0.bookings.filter((b) => b.date >= addDays(DEMO_TODAY, -30)), m);
    expect(t.booked).toBe(t.billed + t.leftEarly + t.noBill);
    expect(t.gap).toBe(t.leftEarly + t.noBill);
    expect(t.billed / t.booked).toBeGreaterThan(0.97);
    expect(t.moved + t.joined + t.leftEarlyTables).toBeGreaterThan(20);
    expect(t.sizeChanged).toBeGreaterThan(50);
  });

  it("stays rare: a few seated tables with no bill a month, each with a seeded state, recovered only on a guest's room", () => {
    const flags = d0.exceptions.filter((e) => e.type === "seated_no_bill");
    expect(flags.filter((e) => e.date >= addDays(DEMO_TODAY, -29)).length).toBeLessThanOrEqual(6);
    for (const e of flags) {
      const s = d0.seedInvestigations[e.id];
      expect(s, e.id).toBeDefined();
      if (s.status === "closed") expect(s.notes.length, e.id).toBeGreaterThan(0);
      if (s.outcome === "recovered") expect(e.booking?.room, e.id).toBeTruthy();
    }
  });
});

describe("the planted stories", () => {
  it("last night at Mercado: a booking for 4 by the guest in room 1108, seated 8:12 PM to 10:04 PM, no bill", () => {
    const e = d0.exceptions.find((x) => x.id === COVERS_STORY_EXCEPTION_ID)!;
    expect(e).toBeDefined();
    expect(e).toMatchObject({ date: rel(-1), outletId: "lis-terrace", min: COVERS_STORY.seatedMin });
    expect(e.booking).toMatchObject({ party: 4, service: "dinner", room: "1108", seatedMin: T(20, 12), leftMin: T(22, 4), atTable: [] });
    expect(e.booking!.nearby.every((o) => Math.abs(o.covers - 4) > COVER_RULES.partySlack)).toBe(true);
    expect(e.exposure).toBeGreaterThan(100);
    expect(e.exposure).toBeLessThan(220);
    expect(d0.seedInvestigations[e.id].status).toBe("new");
  });

  it("two days ago at lunch: a booking for 4 with no bill, checked by the manager and closed as legitimate", () => {
    const e = d0.exceptions.find((x) => x.id === COVERS_EXAMPLE_EXCEPTION_ID)!;
    expect(e).toMatchObject({ date: rel(-2), outletId: "lis-terrace" });
    expect(e.booking?.service).toBe("lunch");
    const s = d0.seedInvestigations[e.id];
    expect(s).toMatchObject({ status: "closed", outcome: "legitimate", closedBy: "MER-S7", recovered: 0, confirmedLoss: 0 });
    expect(s.notes[0].text).toContain("joined colleagues");
  });

  it("is flagged on every business day of a week, the only open seated table, and survives the public demo's list", async () => {
    for (let i = 0; i < 7; i++) {
      vi.resetModules();
      process.env.TYLL_DEMO_DATE = addDays("2026-11-16", i);
      const g = await import("../data/generate");
      const c = await import("../data/constants");
      const dc = await import("../data/demo-cases");
      const d = g.getDataset();
      const e = d.exceptions.find((x) => x.id === c.COVERS_STORY_EXCEPTION_ID);
      expect(e, process.env.TYLL_DEMO_DATE).toBeDefined();
      expect(e!.booking!.party).toBe(4);
      expect(d.exceptions.find((x) => x.id === c.COVERS_EXAMPLE_EXCEPTION_ID), process.env.TYLL_DEMO_DATE).toBeDefined();
      const kept = new Set(dc.demoCases(d.exceptions, d.seedInvestigations).map((x) => x.id));
      expect(kept.has(c.COVERS_STORY_EXCEPTION_ID)).toBe(true);
      expect(kept.has(c.COVERS_EXAMPLE_EXCEPTION_ID)).toBe(true);
    }
    vi.resetModules();
    process.env.TYLL_DEMO_DATE = "2026-10-13";
  });
});

describe("the covers check", () => {
  const check = (user = fnb, q: { days?: string; outlets?: string } = {}) => {
    const r = coversCheckFor(user, q);
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("lists the same tables as the flags page, and its totals add up", () => {
    const r = check();
    const flags = snapshotFor(fnb).exceptions.filter((e) => e.type === "seated_no_bill" && e.date >= r.from && e.date <= r.to);
    expect(r.cases.map((x) => x.caseId).sort()).toEqual(flags.map((e) => e.id).sort());
    expect(r.to).toBe(rel(-1));
    expect(r.total.noBillTables).toBe(r.cases.length);
    expect(r.total.value).toBeCloseTo(r.cases.reduce((s, x) => s + x.atStake, 0), 2);
    for (const k of ["tables", "booked", "billed", "gap", "noBill", "noBillTables", "leftEarly", "value"] as const) {
      expect(r.rows.reduce((s, x) => s + x[k], 0), k).toBeCloseTo(r.total[k], 2);
    }
    expect(r.total.booked).toBe(r.total.billed + r.total.gap);
    // The trend covers the same 30 days.
    expect(r.trend.reduce((s, x) => s + x.noBill, 0)).toBe(r.total.noBill);
    expect(r.trend.reduce((s, x) => s + x.booked, 0)).toBe(r.total.booked);
    expect(r.trend.reduce((s, x) => s + x.dinner.gap + x.lunch.gap, 0)).toBe(r.total.gap);
    expect(r.story?.caseId).toBe(COVERS_STORY_EXCEPTION_ID);
    expect(r.walkIn.sort()).toEqual(["lis-banquets", "lis-ird", "lis-lobby"]);
  });

  it("covers the 7 closed days to last night when asked", () => {
    const r = check(fnb, { days: "7" });
    expect(r.from).toBe(rel(-7));
    expect(r.cases.every((x) => x.date >= rel(-7))).toBe(true);
    expect(r.cases.map((x) => x.caseId)).toContain(COVERS_STORY_EXCEPTION_ID);
  });

  it("agrees with the flags in the public demo too, with every counted table's case in the list", () => {
    const was = process.env.TYLL_PUBLIC_DEMO;
    process.env.TYLL_PUBLIC_DEMO = "on";
    try {
      const r = check();
      const sent = new Set(snapshotFor(fnb).exceptions.map((e) => e.id));
      for (const row of r.cases) expect(sent.has(row.caseId), row.caseId).toBe(true);
      expect(r.total.noBillTables).toBe(r.cases.length);
      expect(r.cases.map((x) => x.caseId)).toEqual(expect.arrayContaining([COVERS_STORY_EXCEPTION_ID, COVERS_EXAMPLE_EXCEPTION_ID]));
      expect(r.total.booked).toBe(r.total.billed + r.total.gap);
      const open = demoCases(d0.exceptions, d0.seedInvestigations).filter((e) => d0.seedInvestigations[e.id]?.status !== "closed");
      expect(open.length).toBeLessThanOrEqual(12);
    } finally {
      if (was === undefined) delete process.env.TYLL_PUBLIC_DEMO;
      else process.env.TYLL_PUBLIC_DEMO = was;
    }
  });

  it("counts each table with no bill once in flags per 1,000 orders, by its own day, and in the Overview's flagged bills", async () => {
    const { NO_ADJUSTMENTS } = await import("../domain/variance");
    type Ctx = Parameters<typeof computeTotals>[0];
    type Sel = Parameters<typeof computeTotals>[1];
    const sel: Sel = { outletIds: ["lis-terrace", "lis-lobby", "lis-banquets", "lis-ird"], wholeProperties: ["lis"], range: { from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY }, currency: "EUR", dept: "all" };
    const ctx = (data: typeof d0): Ctx => ({ data, waste: data.wasteLogs, counts: data.counts, overrides: [], investigations: {}, adjust: NO_ADJUSTMENTS });
    const others = d0.exceptions.filter((e) => e.type !== "seated_no_bill");
    const seated = d0.exceptions.filter((e) => e.type === "seated_no_bill" && e.date >= sel.range.from);
    expect(computeTotals(ctx(d0), sel).adjustments - computeTotals(ctx({ ...d0, exceptions: others }), sel).adjustments).toBe(seated.length);
    for (const e of seated) {
      expect(e.orderId).toBeUndefined();
      expect(hasOwnDay(e)).toBe(true);
      expect(inBillsLedger(e)).toBe(true);
    }
  });

  it("is open to the managers who see flags, for their own outlets only, and refused to everyone else", () => {
    for (const id of ["u-fnb", "u-gm", "u-fc", "u-owner", "u-rm", "u-lby"]) expect(can(userById[id], "covers.view"), id).toBe(true);
    for (const id of ["u-chef", "u-buy", "u-emp", "u-events", "u-fo"]) {
      expect(can(userById[id], "covers.view"), id).toBe(false);
      expect(coversCheckFor(userById[id], {}), id).toMatchObject({ ok: false, status: 403 });
    }
    const bar = check(userById["u-lby"], { outlets: "lis-lobby,lis-terrace" });
    expect(bar.bookable).toEqual([]);
    expect(bar.walkIn).toEqual(["lis-lobby"]);
    expect(bar.cases).toHaveLength(0);
    expect(bar.story).toBeNull();
    const mercado = check(userById["u-rm"]);
    expect(mercado.bookable).toEqual(["lis-terrace"]);
    expect(mercado.story?.caseId).toBe(COVERS_STORY_EXCEPTION_ID);
  });

  it("is reached from Revenue, and its flag has a label and an explanation without dashes", () => {
    expect(activeItem("/money", "covers")?.label).toBe("Revenue");
    expect(TYPE_LABEL.seated_no_bill).toBe("Seated table with no bill");
    for (const e of d0.exceptions.filter((x) => x.type === "seated_no_bill")) {
      const x = explain(e, d0, d0.counts, []);
      expect(x.facts.length, e.id).toBeGreaterThan(3);
      expect(x.possibleCauses.length, e.id).toBeGreaterThan(2);
      for (const text of [e.headline, e.comparedWith ?? "", x.whatHappened, x.message, ...x.facts, ...x.possibleCauses, ...x.recommended]) expect(text, text).not.toMatch(/ [-–—] |—|–/);
    }
    const story = explain(d0.exceptions.find((e) => e.id === COVERS_STORY_EXCEPTION_ID)!, d0, d0.counts, []);
    expect(story.recommended.join(" ")).toContain("room 1108");
  });
});

describe("alerts", () => {
  it("brings the open table to Alerts and the Overview as an estimate at the spend per guest", async () => {
    const { buildIssues } = await import("../domain/issues");
    const { NO_ADJUSTMENTS } = await import("../domain/variance");
    const e = d0.exceptions.find((x) => x.id === COVERS_STORY_EXCEPTION_ID)!;
    const ctx = { data: d0, waste: d0.wasteLogs, counts: d0.counts, overrides: [], investigations: {}, adjust: NO_ADJUSTMENTS };
    const sel = { outletIds: ["lis-terrace"], wholeProperties: ["lis"], dept: "all" as const, range: { from: addDays(DEMO_TODAY, -6), to: DEMO_TODAY }, currency: "EUR" as const };
    const issues = buildIssues(ctx as never, sel, [{ ...e, ...d0.seedInvestigations[e.id] }] as never, [], { includeStock: false });
    expect(issues[0]).toMatchObject({ id: COVERS_STORY_EXCEPTION_ID, estimate: true, estimateFrom: "spend", href: `/investigations/${COVERS_STORY_EXCEPTION_ID}` });
  });
});

describe("translations", () => {
  it("has German, Italian and Arabic for every text of a seated table with no bill", async () => {
    const { Translator } = await import("../i18n/translate");
    const messages = (await import("../i18n/messages.json")).default as unknown as import("../i18n/translate").Messages;
    const { INGREDIENTS, MENU_ITEMS, PROPERTIES, STAFF, SUPPLIERS, USERS } = await import("../data/catalog");
    const { POUR_SKUS } = await import("../domain/pour");
    const { MIX_LABELS } = await import("../domain/till-rules");
    const entities = { items: [...INGREDIENTS, ...MENU_ITEMS, ...POUR_SKUS, ...MIX_LABELS].map((x) => x.name), names: [...OUTLETS, ...PROPERTIES, ...SUPPLIERS, ...STAFF, ...USERS].map((x) => x.name) };
    const texts = new Set<string>([TYPE_LABEL.seated_no_bill]);
    for (const e of d0.exceptions.filter((x) => x.type === "seated_no_bill")) {
      const x = explain(e, d0, d0.counts, []);
      for (const t of [e.headline, e.comparedWith ?? "", (e.comparedWith ?? "").replace(/^Compared with /, ""), x.whatHappened, x.message, ...x.facts, ...x.possibleCauses, ...x.recommended]) texts.add(t);
      texts.add(d0.seedInvestigations[e.id].notes[0]?.text ?? "");
    }
    const gaps = new Set<string>();
    for (const lang of ["de", "it", "ar"] as const) {
      const tr = new Translator(lang, messages, entities);
      for (const t of texts) {
        if (!t) continue;
        tr.translate(t);
        if (!tr.missing.size) continue;
        for (const piece of t.split(/(?<=[.?!:]) | · |; /)) {
          const one = new Translator(lang, messages, entities);
          one.translate(piece);
          for (const m of one.missing) gaps.add(m);
        }
        tr.missing.clear();
      }
    }
    if (process.env.COVERS_GAPS) fs.writeFileSync(process.env.COVERS_GAPS, [...gaps].join("\n"));
    expect([...gaps]).toEqual([]);
  });
});
