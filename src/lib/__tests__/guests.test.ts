// Hotel guests against outlet charges (overnight feature 7): the breakfast rule with the cases it must not flag (rates with
// breakfast, charges to the room, breakfasts paid at the table), the in-house list against the occupancy Predictions uses,
// the planted stories, the totals across the check, the flags page and the Money Back List, outlet sales against the
// guests in house, and who may see it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-guests-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const G = await import("../domain/guests");
const { TYPE_LABEL, inBillsLedger, hasOwnDay } = await import("../domain/detect");
const { explain } = await import("../domain/explain");
const { computeTotals } = await import("../domain/metrics");
const { getDataset } = await import("../data/generate");
const { demoCases } = await import("../data/demo-cases");
const { BREAKFAST_EXAMPLE_EXCEPTION_ID, BREAKFAST_STORY, BREAKFAST_STORY_EXCEPTION_ID } = await import("../data/constants");
const { guestsCheckFor } = await import("../server/guests");
const { snapshotFor } = await import("../server/snapshot");
const { OUTLETS, PROPERTIES, userById } = await import("../data/catalog");
const { can } = await import("../domain/access");
const { activeItem } = await import("../nav");
const { DEMO_TODAY, addDays, eachDay, rel } = await import("../util");
type Order = import("../types").Order;
type InHouseRoom = import("../types").InHouseRoom;
type BreakfastVisit = import("../types").BreakfastVisit;

const d0 = getDataset();
const fnb = userById["u-fnb"];
const T = (h: number, m = 0) => h * 60 + m;
const DAY = "2026-10-10";
const NIGHT = addDays(DAY, -1);
const PRICE = G.breakfastPrice(DAY);
const stay = (extra: Partial<InHouseRoom> = {}): InHouseRoom => ({ propertyId: "lis", date: NIGHT, room: "1517", guests: 2, rate: "BAR-RO", ...extra });
const visit = (extra: Partial<BreakfastVisit> = {}): BreakfastVisit => ({ id: "BF-MER-T-001", propertyId: "lis", outletId: "lis-terrace", date: DAY, room: "1517", guests: 2, min: T(8), ...extra });
const bill = (extra: Partial<Order> & { units?: number } = {}): Order => {
  const { units = 2, ...rest } = extra;
  return {
    id: "MER-T-001", outletId: "lis-terrace", date: DAY, openMin: T(8, 3), closeMin: T(8, 50), covers: units, staffId: "MER-S3", table: "Table 7", discountPct: 0, payment: "room", room: "1517",
    lines: [{ itemId: "breakfast", qty: units, unitPrice: PRICE, state: "kept", enteredMin: T(8, 4), sentMin: T(8, 5) }], ...rest,
  };
};
const match = (v: BreakfastVisit[], s: InHouseRoom[], o: Order[], id = "BF-MER-T-001") => G.matchBreakfast(v, s, o).get(id)!;

describe("the breakfast rule", () => {
  it("never flags guests whose rate includes breakfast, with nothing charged", () => {
    for (const rate of ["BAR-BB", "CORP-BB", "PKG-CITY"]) {
      const m = match([visit()], [stay({ rate })], []);
      expect(m, rate).toMatchObject({ included: 2, charged: 0, paid: 0, notCharged: 0 });
      expect(G.detectBreakfastNotCharged([visit()], [stay({ rate })], []), rate).toEqual([]);
    }
    // Fewer guests than registered came down: still all in the rate.
    expect(match([visit({ guests: 1 })], [stay({ rate: "BAR-BB" })], [])).toMatchObject({ included: 1, notCharged: 0 });
  });

  it("flags a room only room ticked in with nothing charged, at the breakfast price", () => {
    const flags = G.detectBreakfastNotCharged([visit()], [stay()], []);
    expect(flags).toHaveLength(1);
    const e = flags[0];
    expect(e).toMatchObject({ id: "EX-BF-MER-T-001", type: "breakfast_not_charged", outletId: "lis-terrace", date: DAY, min: T(8), exposure: 2 * PRICE });
    expect(e.basis).toBeUndefined();
    expect(e.headline).toBe("Room 1517: 2 breakfasts not charged");
    expect(e.breakfast).toMatchObject({ room: "1517", rate: "BAR-RO", included: 0, toCharge: 2, notCharged: 2, registered: 2, price: PRICE, from: T(7, 50), to: T(8, 30) });
  });

  it("does not flag breakfasts charged to the room, and flags only what is missing", () => {
    expect(match([visit()], [stay()], [bill()])).toMatchObject({ charged: 2, notCharged: 0, bills: ["MER-T-001"] });
    expect(match([visit()], [stay()], [bill({ units: 1 })])).toMatchObject({ charged: 1, notCharged: 1 });
    // A bill charged to another room, a voided bill and a breakfast taken off the bill are not this room's breakfast.
    expect(match([visit()], [stay()], [bill({ room: "1518" })]).notCharged).toBe(2);
    expect(match([visit()], [stay()], [bill({ voided: { min: T(8, 40) } })]).notCharged).toBe(2);
    const removed = bill();
    removed.lines[0].state = "removed_post";
    expect(match([visit()], [stay()], [removed]).notCharged).toBe(2);
    // A bill from the afternoon is not breakfast.
    expect(match([visit()], [stay()], [bill({ openMin: T(12) })]).notCharged).toBe(2);
  });

  it("accepts a breakfast bill paid at the table from 10 minutes before the tick to 30 minutes after, one bill per room", () => {
    const paid = (openMin: number) => match([visit()], [stay()], [bill({ payment: "card", room: undefined, openMin })]);
    expect(paid(T(7, 50)).paid).toBe(2);
    expect(paid(T(8, 30)).paid).toBe(2);
    expect(paid(T(7, 49)).notCharged).toBe(2);
    expect(paid(T(8, 31)).notCharged).toBe(2);
    // One bill, two rooms: the room ticked in nearest the bill gets it, the other is flagged.
    const two = G.matchBreakfast([visit(), visit({ id: "BF-MER-T-002", room: "1610", min: T(8, 20) })], [stay(), stay({ room: "1610" })], [bill({ payment: "cash", room: undefined, openMin: T(8, 4) })]);
    expect(two.get("BF-MER-T-001")).toMatchObject({ paid: 2, notCharged: 0 });
    expect(two.get("BF-MER-T-002")).toMatchObject({ paid: 0, notCharged: 2 });
  });

  it("gives a bill for exactly the breakfasts left before a nearer one for a different number", () => {
    const rooms = [visit({ guests: 1 }), visit({ id: "BF-MER-T-002", room: "1610", guests: 2, min: T(8, 2) })];
    const bills = [bill({ id: "MER-T-001", payment: "card", room: undefined, openMin: T(8, 3), units: 2 }), bill({ id: "MER-T-002", payment: "card", room: undefined, openMin: T(8, 9), units: 1 })];
    const m = G.matchBreakfast(rooms, [stay({ guests: 1 }), stay({ room: "1610" })], bills);
    expect(m.get("BF-MER-T-001")).toMatchObject({ paid: 1, notCharged: 0, bills: ["MER-T-002"] });
    expect(m.get("BF-MER-T-002")).toMatchObject({ paid: 2, notCharged: 0, bills: ["MER-T-001"] });
  });

  it("charges a guest beyond those a rate with breakfast covers, and flags it only when nothing covers it", () => {
    const three = visit({ guests: 3 });
    expect(match([three], [stay({ rate: "BAR-BB" })], [])).toMatchObject({ included: 2, notCharged: 1 });
    expect(match([three], [stay({ rate: "BAR-BB" })], [bill({ units: 1 })])).toMatchObject({ included: 2, charged: 1, notCharged: 0 });
    const e = G.detectBreakfastNotCharged([three], [stay({ rate: "BAR-BB" })], [])[0];
    expect(e.headline).toBe("Room 1517: 1 breakfast beyond the rate not charged");
    expect(e.exposure).toBe(PRICE);
  });

  it("treats a room that is not on last night's in-house list as having no rate", () => {
    expect(match([visit()], [stay({ room: "1999" })], [])).toMatchObject({ rate: null, included: 0, notCharged: 2 });
    // Tonight's list is not last night's.
    expect(match([visit()], [stay({ date: DAY, rate: "BAR-BB" })], [])).toMatchObject({ rate: null, notCharged: 2 });
  });

  it("adds up: guests at breakfast are in the rate, charged, paid or not charged", () => {
    const m = G.matchBreakfast(d0.breakfasts, d0.stays, d0.orders);
    const t = G.breakfastTotalsOf(d0.breakfasts.filter((v) => v.date >= addDays(DEMO_TODAY, -29)), m);
    expect(t.guests).toBe(t.included + t.charged + t.paid + t.notCharged);
    expect(t.included / t.guests).toBeGreaterThan(0.8);
    expect(t.charged + t.paid).toBeGreaterThan(100);
  });
});

describe("the simulated in-house list and breakfast list", () => {
  it("fills the rooms the occupancy says, with 1.6 guests a room, as Predictions counts them (304 to 366 a night)", () => {
    for (const night of eachDay({ from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY })) {
      const occ = d0.occupancy.find((o) => o.date === night)!.occupancy;
      const rooms = Math.round(PROPERTIES[0].rooms * occ);
      const list = d0.stays.filter((s) => s.date === night);
      expect(list.length, night).toBe(rooms);
      expect(G.guestsOn(d0.stays, night), night).toBe(Math.round(rooms * G.GUEST_RULES.guestsPerRoom));
      expect(new Set(list.map((s) => s.room)).size, night).toBe(list.length);
    }
  });

  it("has every room charged that night in house, so the records agree", () => {
    const inHouse = new Set(d0.stays.map((s) => `${s.date}|${s.room}`));
    for (const c of d0.roomCharges.filter((x) => x.date >= addDays(DEMO_TODAY, -29))) {
      const night = c.min < G.GUEST_RULES.breakfastEnds ? addDays(c.date, -1) : c.date;
      expect(inHouse.has(`${night}|${c.room}`), c.id).toBe(true);
    }
  });

  it("matches every breakfast bill of a hotel guest, and leaves no bill charged to a room for a breakfast the rate includes", () => {
    const m = G.matchBreakfast(d0.breakfasts, d0.stays, d0.orders);
    const owners = G.billRooms(d0.breakfasts, m);
    for (const date of eachDay({ from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY })) {
      for (const o of G.breakfastBills(d0.orders, date).filter((x) => x.payment === "room")) expect(owners.has(o.id), o.id).toBe(true);
    }
    // Only the planted rooms are not charged: a few a month, each with a seeded state.
    const flags = d0.exceptions.filter((e) => e.type === "breakfast_not_charged");
    expect(flags.filter((e) => e.date >= addDays(DEMO_TODAY, -29)).length).toBeLessThanOrEqual(8);
    for (const e of flags) {
      const s = d0.seedInvestigations[e.id];
      expect(s, e.id).toBeDefined();
      if (s.status === "closed") expect(s.notes.length, e.id).toBeGreaterThan(0);
      // Nothing paid at the table near a planted room is free: the rule would have matched it.
      expect(e.breakfast!.nearby.filter((b) => !b.matchedTo && b.units >= e.breakfast!.notCharged), e.id).toEqual([]);
    }
  });

  it("keeps this morning to the worked example, and settles the older ones with the front office", () => {
    const flags = d0.exceptions.filter((e) => e.type === "breakfast_not_charged");
    expect(flags.filter((e) => e.date === DEMO_TODAY).map((e) => e.id)).toEqual([BREAKFAST_STORY_EXCEPTION_ID]);
    for (const e of flags.filter((x) => x.date < DEMO_TODAY)) expect(d0.seedInvestigations[e.id].status, e.id).toBe("closed");
  });
});

describe("the planted stories", () => {
  it("this morning at Mercado: room 1517, one guest on a room only rate, no breakfast charged, still in house", () => {
    const e = d0.exceptions.find((x) => x.id === BREAKFAST_STORY_EXCEPTION_ID)!;
    expect(e).toMatchObject({ date: DEMO_TODAY, outletId: "lis-terrace", exposure: G.breakfastPrice(DEMO_TODAY) });
    expect(e.breakfast).toMatchObject({ room: "1517", guests: 1, rate: "ADV-RO", included: 0, notCharged: 1, charged: [], staysOn: true, registered: 1 });
    expect(BREAKFAST_STORY.times).toContain(e.min);
    expect(d0.seedInvestigations[e.id].status).toBe("new");
    const x = explain(e, d0, d0.counts, []);
    expect(x.recommended.join(" ")).toContain("post 1 breakfast to room 1517 before check-out");
  });

  it("two days ago: a third guest at a room with breakfast for two, posted to the room before check-out", () => {
    const e = d0.exceptions.find((x) => x.id === BREAKFAST_EXAMPLE_EXCEPTION_ID)!;
    expect(e).toMatchObject({ date: rel(-2), outletId: "lis-terrace" });
    expect(e.breakfast).toMatchObject({ guests: 3, registered: 2, rate: "BAR-BB", included: 2, notCharged: 1 });
    const s = d0.seedInvestigations[e.id];
    expect(s).toMatchObject({ status: "closed", outcome: "recovered", closedBy: "MER-S7", recovered: e.exposure, confirmedLoss: 0 });
    expect(s.notes[0].text).toContain(`room ${e.breakfast!.room}`);
  });

  it("is flagged on every business day of a week, open, and kept in the public demo within twelve open", async () => {
    for (let i = 0; i < 7; i++) {
      vi.resetModules();
      process.env.TYLL_DEMO_DATE = addDays("2026-11-16", i);
      const g = await import("../data/generate");
      const c = await import("../data/constants");
      const dc = await import("../data/demo-cases");
      const d = g.getDataset();
      const e = d.exceptions.find((x) => x.id === c.BREAKFAST_STORY_EXCEPTION_ID);
      expect(e, process.env.TYLL_DEMO_DATE).toBeDefined();
      expect(e!.breakfast).toMatchObject({ guests: 1, rate: "ADV-RO", notCharged: 1, staysOn: true });
      expect(d.exceptions.find((x) => x.id === c.BREAKFAST_EXAMPLE_EXCEPTION_ID), process.env.TYLL_DEMO_DATE).toBeDefined();
      const kept = dc.demoCases(d.exceptions, d.seedInvestigations);
      expect(kept.some((x) => x.id === c.BREAKFAST_STORY_EXCEPTION_ID), process.env.TYLL_DEMO_DATE).toBe(true);
      expect(kept.filter((x) => d.seedInvestigations[x.id]?.status !== "closed").length, process.env.TYLL_DEMO_DATE).toBeLessThanOrEqual(12);
    }
    vi.resetModules();
    process.env.TYLL_DEMO_DATE = "2026-10-13";
  });

  it("keeps the public demo's usage above sales from today's counts and the one linked to the reopened bill", () => {
    const kept = new Set(demoCases(d0.exceptions, d0.seedInvestigations).map((e) => e.id));
    const open = d0.exceptions.filter((e) => e.type === "usage_variance" && d0.seedInvestigations[e.id].status !== "closed");
    for (const e of open.filter((x) => x.date === DEMO_TODAY)) expect(kept.has(e.id), e.id).toBe(true);
    for (const e of open.filter((x) => x.period?.removals.some((r) => kept.has(`EX-${r.orderId}`)))) expect(kept.has(e.id), e.id).toBe(true);
  });
});

describe("the hotel guests check", () => {
  const check = (user = fnb, q: { days?: string; outlets?: string } = {}) => {
    const r = guestsCheckFor(user, q);
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("lists the same rooms as the flags page, and its totals add up", () => {
    const r = check();
    const flags = snapshotFor(fnb).exceptions.filter((e) => e.type === "breakfast_not_charged" && e.date >= r.from && e.date <= r.to);
    expect(r.cases.map((x) => x.caseId).sort()).toEqual(flags.map((e) => e.id).sort());
    expect(r.to).toBe(DEMO_TODAY);
    expect(r.outletTo).toBe(rel(-1));
    expect(r.total.notChargedRooms).toBe(r.cases.length);
    expect(r.total.notCharged).toBe(r.cases.reduce((s, x) => s + x.notCharged, 0));
    expect(r.total.value).toBeCloseTo(r.cases.reduce((s, x) => s + x.atStake, 0), 2);
    expect(r.total.guests).toBe(r.total.included + r.total.charged + r.total.paid + r.total.notCharged);
    // The trend covers the same 30 mornings, the rates the same guests at breakfast.
    expect(r.trend.reduce((s, x) => s + x.notCharged, 0)).toBe(r.total.notCharged);
    expect(r.trend.reduce((s, x) => s + x.guests, 0)).toBe(r.total.guests);
    expect(r.rates.reduce((s, x) => s + x.atBreakfast, 0)).toBe(r.total.guests);
    expect(r.rates.reduce((s, x) => s + x.notCharged, 0)).toBe(r.total.notCharged);
    expect(r.lastNight.guests).toBe(G.guestsOn(d0.stays, rel(-1)));
    expect(r.story?.caseId).toBe(BREAKFAST_STORY_EXCEPTION_ID);
    expect(r.unlisted).toEqual({ period: 0, before: 0, trend: 0 });
  });

  it("agrees with the flags in the public demo too, with every counted room's case in the list", () => {
    const was = process.env.TYLL_PUBLIC_DEMO;
    process.env.TYLL_PUBLIC_DEMO = "on";
    try {
      for (const days of ["7", "30"]) {
        const r = check(fnb, { days });
        const sent = new Set(snapshotFor(fnb).exceptions.map((e) => e.id));
        for (const row of r.cases) expect(sent.has(row.caseId), row.caseId).toBe(true);
        expect(r.total.notChargedRooms, days).toBe(r.cases.length);
        expect(r.cases.map((x) => x.caseId)).toContain(BREAKFAST_STORY_EXCEPTION_ID);
        const left = d0.exceptions.filter((e) => e.type === "breakfast_not_charged" && !sent.has(e.id));
        expect(r.unlisted.period, days).toBe(left.filter((e) => e.date >= r.from && e.date <= r.to).length);
        expect(r.before === null, days).toBe(r.unlisted.before > 0);
        expect(r.total.guests).toBe(r.total.included + r.total.charged + r.total.paid + r.total.notCharged);
      }
    } finally {
      if (was === undefined) delete process.env.TYLL_PUBLIC_DEMO;
      else process.env.TYLL_PUBLIC_DEMO = was;
    }
  });

  it("counts each breakfast flag once in flags per 1,000 orders, by its own day, and in the Overview's flagged bills", async () => {
    const { NO_ADJUSTMENTS } = await import("../domain/variance");
    type Ctx = Parameters<typeof computeTotals>[0];
    type Sel = Parameters<typeof computeTotals>[1];
    const sel: Sel = { outletIds: OUTLETS.map((o) => o.id), wholeProperties: ["lis"], range: { from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY }, currency: "EUR", dept: "all" };
    const ctx = (data: typeof d0): Ctx => ({ data, waste: data.wasteLogs, counts: data.counts, overrides: [], investigations: {}, adjust: NO_ADJUSTMENTS });
    const others = d0.exceptions.filter((e) => e.type !== "breakfast_not_charged");
    const flags = d0.exceptions.filter((e) => e.type === "breakfast_not_charged" && e.date >= sel.range.from);
    expect(computeTotals(ctx(d0), sel).adjustments - computeTotals(ctx({ ...d0, exceptions: others }), sel).adjustments).toBe(flags.length);
    for (const e of flags) {
      expect(e.orderId).toBeUndefined();
      expect(hasOwnDay(e)).toBe(true);
      expect(inBillsLedger(e)).toBe(true);
    }
  });

  it("is open to the managers who see flags, for their own outlets only, and refused to everyone else", () => {
    for (const id of ["u-fnb", "u-gm", "u-fc", "u-owner", "u-rm", "u-lby"]) expect(can(userById[id], "guests.view"), id).toBe(true);
    for (const id of ["u-chef", "u-buy", "u-emp", "u-events", "u-fo"]) {
      expect(can(userById[id], "guests.view"), id).toBe(false);
      expect(guestsCheckFor(userById[id], {}), id).toMatchObject({ ok: false, status: 403 });
    }
    // The bar manager: no breakfast, only the bar's sales, even when asking for Mercado.
    const bar = check(userById["u-lby"], { outlets: "lis-lobby,lis-terrace" });
    expect(bar.breakfastOutlet).toBeNull();
    expect(bar.cases).toHaveLength(0);
    expect(bar.story).toBeNull();
    expect(bar.outlets.map((o) => o.outletId)).toEqual(["lis-lobby"]);
    expect(bar.outletTrend.every((x) => x.outletId === "lis-lobby")).toBe(true);
    const mercado = check(userById["u-rm"]);
    expect(mercado.breakfastOutlet).toBe("lis-terrace");
    expect(mercado.story?.caseId).toBe(BREAKFAST_STORY_EXCEPTION_ID);
    // The in-house list never leaves the server: only flagged rooms are named.
    expect(JSON.stringify(check()).match(/"room":/g)?.length ?? 0).toBeLessThanOrEqual(check().cases.length + 1);
  });

  it("is reached from Flagged transactions, and its flag has a label and an explanation without dashes", () => {
    expect(activeItem("/money", "guests")?.label).toBe("Flagged transactions");
    expect(TYPE_LABEL.breakfast_not_charged).toBe("Breakfast not charged");
    for (const e of d0.exceptions.filter((x) => x.type === "breakfast_not_charged")) {
      const x = explain(e, d0, d0.counts, []);
      expect(x.facts.length, e.id).toBeGreaterThan(4);
      for (const text of [e.headline, e.comparedWith ?? "", x.whatHappened, x.message, ...x.facts, ...x.possibleCauses, ...x.recommended]) expect(text, text).not.toMatch(/ [-–—] |—|–/);
    }
  });
});

describe("outlet sales against the guests in house", () => {
  const stays = (date: string, guests: number): InHouseRoom[] => Array.from({ length: guests }, (_, i) => ({ propertyId: "lis", date, room: String(300 + i), guests: 1, rate: "BAR-RO" }));
  const sale = (date: string, net: number, payment: Order["payment"] = "card"): Order => ({
    id: `AZU-${date}-${net}`, outletId: "lis-lobby", date, openMin: T(20), closeMin: T(21), covers: 1, staffId: "AZU-S1", table: "Table 1", discountPct: 0, payment,
    lines: [{ itemId: "beer", qty: 1, unitPrice: net, state: "kept", enteredMin: T(20), sentMin: T(20, 1) }],
  });
  const weeks = (day: string, perGuest: number, guests = 100) => [1, 2, 3, 4].flatMap((w) => { const d = addDays(day, -7 * w); return { d, s: stays(d, guests), o: sale(d, perGuest * guests) }; });

  it("expects what the guests in house usually spend: guests times sales per guest on the same weekday in the 4 weeks before", () => {
    const day = "2026-10-08";
    const hist = weeks(day, 10);
    const [r] = G.outletDays([...hist.map((h) => h.o), sale(day, 1200)], [...hist.flatMap((h) => h.s), ...stays(day, 120)], ["lis-lobby"], [day]);
    expect(r).toMatchObject({ guests: 120, sales: 1200, expected: 1200, below: false });
  });

  it("marks a day to look at only when sales are 20% and EUR 150 below, and never without four weeks of history", () => {
    const day = "2026-10-08";
    const hist = weeks(day, 10);
    const at = (sales: number, guests = 100) => G.outletDays([...hist.map((h) => h.o), sale(day, sales, "room")], [...hist.flatMap((h) => h.s), ...stays(day, guests)], ["lis-lobby"], [day])[0];
    expect(at(790).below).toBe(true);
    expect(at(790).toRooms).toBe(790);
    expect(at(810).below).toBe(false);
    // 25% below, but only EUR 50: a small night is never a finding.
    const small = weeks(day, 2);
    expect(G.outletDays([...small.map((h) => h.o), sale(day, 150)], [...small.flatMap((h) => h.s), ...stays(day, 100)], ["lis-lobby"], [day])[0].below).toBe(false);
    // Three weeks of history are not enough to say what is usual.
    const short = hist.slice(0, 3);
    expect(G.outletDays([...short.map((h) => h.o), sale(day, 100)], [...short.flatMap((h) => h.s), ...stays(day, 100)], ["lis-lobby"], [day])[0]).toMatchObject({ expected: null, below: false });
  });

  it("compares Mercado, Bar Azulejo and In-Room Dining, and its outlet rows add up to the days", () => {
    const r = guestsCheckFor(fnb, { days: "7" });
    if (!r.ok) throw new Error(r.error);
    expect(r.outlets.map((o) => o.outletId)).toEqual(["lis-terrace", "lis-lobby", "lis-ird"]);
    const days = eachDay({ from: r.outletFrom, to: r.outletTo });
    expect(days).toHaveLength(7);
    for (const o of r.outlets) {
      const rows = G.outletDays(d0.orders, d0.stays, [o.outletId], days);
      expect(o.sales).toBeCloseTo(rows.reduce((s, x) => s + x.sales, 0), 2);
      expect(o.below).toBe(rows.filter((x) => x.below).length);
    }
    expect(r.belowDays.every((x) => x.below && x.date >= r.outletFrom)).toBe(true);
  });
});

describe("translations", () => {
  it("has German, Italian and Arabic for every text of a breakfast not charged", async () => {
    const { Translator } = await import("../i18n/translate");
    const messages = (await import("../i18n/messages.json")).default as unknown as import("../i18n/translate").Messages;
    const { INGREDIENTS, MENU_ITEMS, STAFF, SUPPLIERS, USERS } = await import("../data/catalog");
    const { POUR_SKUS } = await import("../domain/pour");
    const { MIX_LABELS } = await import("../domain/till-rules");
    const entities = { items: [...INGREDIENTS, ...MENU_ITEMS, ...POUR_SKUS, ...MIX_LABELS].map((x) => x.name), names: [...OUTLETS, ...PROPERTIES, ...SUPPLIERS, ...STAFF, ...USERS].map((x) => x.name) };
    const texts = new Set<string>([TYPE_LABEL.breakfast_not_charged, ...G.RATE_PLANS.map((p) => p.name)]);
    for (const e of d0.exceptions.filter((x) => x.type === "breakfast_not_charged")) {
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
    if (process.env.GUESTS_GAPS) fs.writeFileSync(process.env.GUESTS_GAPS, [...gaps].join("\n"));
    expect([...gaps]).toEqual([]);
  });
});
