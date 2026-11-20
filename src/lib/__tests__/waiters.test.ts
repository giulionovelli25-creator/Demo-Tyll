// Drinks per guest by waiter: the rule and its must not flag cases, the planted story, the totals and who may see names.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-waiters-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { WAITER_RULES, billFacts, compareWaiters, noDrinkTables, teamByDay, waiterStatus } = await import("../domain/waiters");
const { getDataset, waiterStory } = await import("../data/generate");
const { WAITER_STORY, HERO_ORDER_ID, ROOM_STORY_ORDER_ID } = await import("../data/constants");
const { waitersFor, recordCoaching, clearCoaching, mayNameWaiters } = await import("../server/waiters");
const { resetDemo } = await import("../server/demo");
const { loadStore } = await import("../server/purchasing-store");
const { STAFF, userById } = await import("../data/catalog");
const { can } = await import("../domain/access");
const { activeItem } = await import("../nav");
const { shiftOf } = await import("../domain/pour");
const { DEMO_TODAY, addDays, eachDay } = await import("../util");
type Order = import("../types").Order;
type OrderLine = import("../types").OrderLine;

const U = (id: string) => userById[id];
const line = (itemId: string, qty = 1, state: OrderLine["state"] = "kept"): OrderLine => ({ itemId, qty, unitPrice: itemId === "burger" ? 22 : 5, state, enteredMin: 0 });
let seq = 0;
/** A bill at Mercado. Evening unless an opening time is given. */
const bill = (staffId: string, guests: number, drinks: number, o: Partial<Order> = {}): Order => ({
  id: `T-${++seq}`, outletId: "lis-terrace", date: DEMO_TODAY, openMin: 20 * 60, closeMin: 21 * 60, covers: guests, staffId, table: "Table 1",
  lines: [line("burger", guests), ...(drinks ? [line("coke", drinks)] : [])], discountPct: 0, payment: "card", ...o,
});
/** Many bills over several evenings: `rate` drinks per guest for two guests a table. */
function evenings(staffId: string, tables: number, drinksPerTable: (i: number) => number, days = 10, o: Partial<Order> = {}): Order[] {
  const out: Order[] = [];
  for (let d = 0; d < days; d++) for (let i = 0; i < tables; i++) out.push(bill(staffId, 2, drinksPerTable(i), { date: addDays(DEMO_TODAY, -d), ...o }));
  return out;
}
const q = { outletIds: ["lis-terrace"], from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY };
const row = (orders: Order[], staffId: string) => compareWaiters(orders, q)[0].waiters.find((w) => w.staffId === staffId)!;

describe("what a bill tells about drinks", () => {
  it("counts drinks billed only, and food other than the breakfast buffet", () => {
    const f = billFacts(bill("MER-S1", 2, 0, { lines: [line("burger"), line("coke", 2, "comped"), line("beer", 1, "removed_post")] }))!;
    expect(f).toMatchObject({ guests: 2, drinks: 0, food: true, noDrink: true, shift: "evening" });
    const g = billFacts(bill("MER-S1", 2, 0, { lines: [line("burger"), line("coke", 2), line("cappuccino")] }))!;
    expect(g).toMatchObject({ drinks: 3, noDrink: false, drinkValue: 15 });
    // The breakfast buffet includes coffee and juice: never a table without drinks.
    expect(billFacts(bill("MER-S1", 2, 0, { openMin: 8 * 60, lines: [line("breakfast", 2)] }))).toMatchObject({ food: false, noDrink: false, shift: "day" });
  });

  it("leaves out voided bills and banquet bills", () => {
    expect(billFacts(bill("MER-S1", 2, 0, { voided: { min: 1200 } }))).toBeNull();
    expect(billFacts(bill("BQT-S1", 20, 0, { outletId: "lis-banquets" }))).toBeNull();
    expect(compareWaiters([bill("BQT-S1", 20, 0, { outletId: "lis-banquets" })], { ...q, outletIds: ["lis-banquets"] })).toEqual([]);
  });
});

describe("the coaching rule", () => {
  // Four colleagues at one drink a guest, every evening.
  const team = ["MER-S2", "MER-S3", "MER-S4", "MER-S5"].flatMap((id) => evenings(id, 6, () => 2));

  it("marks a waiter well below colleagues on the same shifts, with the drinks not sold as an estimate", () => {
    // Half a drink a guest across 120 guests.
    const low = evenings("MER-S1", 6, (i) => (i % 2 ? 2 : 0));
    const r = row([...team, ...low], "MER-S1");
    expect(r.status).toBe("coach");
    const ev = r.shifts.find((s) => s.shift === "evening")!;
    expect(ev).toMatchObject({ status: "coach", rate: 0.5, peerRate: 1, comparedGuests: 120 });
    expect(ev.z).toBeLessThanOrEqual(-WAITER_RULES.z);
    // At colleagues' pace 120 guests would have had 120 drinks; 60 were sold.
    expect(ev.shortfall).toBe(60);
    const out = compareWaiters([...team, ...low], q)[0];
    expect(ev.shortfallValue).toBe(Math.round(60 * out.drinkPrice));
    expect(r.shortfallValue).toBe(ev.shortfallValue);
    // Colleagues' share of tables with food and no drink is none; this waiter has 30.
    expect(ev.noDrink).toBe(30);
    expect(ev.expectedNoDrink).toBe(0);
    expect(out.waiters[0].staffId).toBe("MER-S1");
  });

  it("does not mark a busy night against the waiter who worked it", () => {
    // One busy Saturday night everyone sells half a drink a guest. On the weeknights the others sell one a guest. The waiter
    // who only worked the Saturday is set against the Saturday team, so is in line, though below the outlet's average.
    const saturday = addDays(DEMO_TODAY, -3);
    const busy = ["MER-S1", "MER-S2", "MER-S3"].flatMap((id) => evenings(id, 10, (i) => (i % 2 ? 2 : 0), 1, { date: saturday }));
    const weeknights = ["MER-S2", "MER-S3"].flatMap((id) => evenings(id, 6, () => 2, 10).map((o) => ({ ...o, date: addDays(o.date, -4) })));
    const orders = [...busy, ...weeknights];
    const r = row(orders, "MER-S1");
    expect(r.rate).toBe(0.5);
    expect(r.peerRate).toBe(0.5);
    expect(compareWaiters(orders, q)[0].rate).toBeGreaterThan(0.8);
    expect(r.status).toBe("too_few");
    expect(r.shifts[0].status).not.toBe("coach");
    // With more Saturdays, enough guests to judge, and still in line.
    const more = [0, 7, 14].flatMap((k) => busy.map((o) => ({ ...o, id: `${o.id}-${k}`, date: addDays(saturday, -k) })));
    expect(row([...more, ...weeknights], "MER-S1").status).toBe("in_line");
  });

  it("does not mark a gap that chance alone could produce, or a waiter with too few guests", () => {
    // 10% below colleagues: under the 15% rule, however many guests.
    const slightly = evenings("MER-S1", 6, (i) => (i < 5 ? 2 : 1), 10);
    expect(row([...team, ...slightly], "MER-S1").status).toBe("in_line");
    // Far below, but on 20 guests only.
    const few = evenings("MER-S1", 2, () => 0, 5);
    const r = row([...team, ...few], "MER-S1");
    expect(r.shifts[0].comparedGuests).toBeLessThan(WAITER_RULES.minGuests);
    expect(r.status).toBe("too_few");
    // A wide, noisy gap with few guests is not beyond chance.
    expect(waiterStatus({ comparedGuests: 60, rate: 0.6, peerRate: 0.8, z: -2.4 })).toBe("in_line");
    expect(waiterStatus({ comparedGuests: 60, rate: 0.6, peerRate: 0.8, z: -3.1 })).toBe("coach");
    expect(waiterStatus({ comparedGuests: 49, rate: 0.1, peerRate: 0.8, z: -9 })).toBe("too_few");
    // Nobody to compare with on the shift: not judged.
    const alone = evenings("MER-S1", 6, () => 0, 10, { openMin: 23 * 60 });
    expect(row([...team, ...alone], "MER-S1").shifts.find((s) => s.shift === "late")).toMatchObject({ status: "too_few", comparedGuests: 0, peerRate: null });
  });

  it("marks a waiter well above colleagues as above the team, never to coach", () => {
    const high = evenings("MER-S1", 6, () => 4);
    expect(row([...team, ...high], "MER-S1").status).toBe("above");
  });

  it("lists one waiter's tables with food and no drink, valued at colleagues' pace", () => {
    const low = evenings("MER-S1", 6, (i) => (i % 2 ? 2 : 0), 2);
    const orders = [...team, ...low];
    const price = compareWaiters(orders, q)[0].drinkPrice;
    const t = noDrinkTables(orders, { outletId: "lis-terrace", staffId: "MER-S1", ...q }, price);
    expect(t).toHaveLength(6);
    expect(t.every((x) => x.guests === 2 && x.estValue === Math.round(2 * 1 * price * 100) / 100)).toBe(true);
    expect(noDrinkTables(orders, { outletId: "lis-terrace", staffId: "MER-S2", ...q }, price)).toEqual([]);
  });
});

describe("the demo story", () => {
  it("only moves whole, untouched bills between logins on the same evening", () => {
    const before = getDataset().orders.map((o) => structuredClone(o));
    const after = before.map((o) => structuredClone(o));
    waiterStory(after);
    let moved = 0;
    const count = (orders: Order[]) => {
      const m = new Map<string, number>();
      for (const o of orders) if (o.outletId === WAITER_STORY.outletId && shiftOf(o.openMin) === WAITER_STORY.shift) m.set(`${o.date}|${o.staffId}`, (m.get(`${o.date}|${o.staffId}`) ?? 0) + 1);
      return m;
    };
    before.forEach((o, i) => {
      const a = after[i];
      expect({ ...a, staffId: o.staffId }).toEqual(o);
      if (a.staffId !== o.staffId) {
        moved++;
        expect(o.outletId).toBe(WAITER_STORY.outletId);
        expect(shiftOf(o.openMin)).toBe(WAITER_STORY.shift);
        expect(o.lines.every((l) => l.state === "kept") && !o.voided && !o.refund && !o.discountPct).toBe(true);
        expect([HERO_ORDER_ID, ROOM_STORY_ORDER_ID]).not.toContain(o.id);
      }
    });
    expect(moved).toBeGreaterThan(20);
    // Every login rings as many bills each evening as before.
    expect(count(after)).toEqual(count(before));
  });

  it("shows Rahul Okafor at Mercado on evening shifts, and nobody else, to coach over 30 days", () => {
    const outlets = compareWaiters(getDataset().orders, { outletIds: ["lis-terrace", "lis-lobby", "lis-ird"], from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY });
    const coach = outlets.flatMap((o) => o.waiters.filter((w) => w.status === "coach"));
    expect(coach.map((w) => w.staffId)).toEqual([WAITER_STORY.staffId]);
    const r = coach[0];
    expect(STAFF.find((s) => s.id === r.staffId)?.name).toBe("Rahul Okafor");
    expect(r.shifts.filter((s) => s.status === "coach").map((s) => s.shift)).toEqual(["evening"]);
    expect(r.shifts.find((s) => s.shift === "day")?.status).toBe("in_line");
    const ev = r.shifts.find((s) => s.shift === "evening")!;
    expect(ev.rate!).toBeLessThan(ev.peerRate! * 0.75);
    expect(ev.noDrink).toBeGreaterThan(ev.expectedNoDrink * 1.6);
    expect(ev.shortfallValue).toBeGreaterThan(300);
    expect(ev.shortfallValue).toBeLessThan(700);
  });

  it("holds on every business day of a week", async () => {
    for (let i = 0; i < 7; i++) {
      vi.resetModules();
      process.env.TYLL_DEMO_DATE = addDays("2026-11-16", i);
      const g = await import("../data/generate");
      const w = await import("../domain/waiters");
      const u = await import("../util");
      const outlets = w.compareWaiters(g.getDataset().orders, { outletIds: ["lis-terrace", "lis-lobby", "lis-ird"], from: u.addDays(u.DEMO_TODAY, -29), to: u.DEMO_TODAY });
      const coach = outlets.flatMap((o) => o.waiters.filter((x) => x.status === "coach").map((x) => x.staffId));
      expect(coach, u.DEMO_TODAY).toEqual([WAITER_STORY.staffId]);
    }
    vi.resetModules();
    process.env.TYLL_DEMO_DATE = "2026-10-13";
  });
});

describe("totals reconcile", () => {
  it("adds every waiter and shift up to the outlet, and the outlet up to Revenue's guests", () => {
    const d = getDataset();
    const from = addDays(DEMO_TODAY, -29);
    for (const o of compareWaiters(d.orders, { outletIds: ["lis-terrace", "lis-lobby", "lis-ird"], from, to: DEMO_TODAY })) {
      expect(o.waiters.reduce((n, w) => n + w.guests, 0)).toBe(o.guests);
      expect(o.waiters.reduce((n, w) => n + w.drinks, 0)).toBe(o.drinks);
      expect(o.waiters.reduce((n, w) => n + w.noDrink, 0)).toBe(o.noDrink);
      expect(o.shifts.reduce((n, s) => n + s.guests, 0)).toBe(o.guests);
      for (const w of o.waiters) {
        expect(w.shifts.reduce((n, s) => n + s.guests, 0)).toBe(w.guests);
        expect(w.shortfallValue).toBe(w.shifts.filter((s) => s.status === "coach").reduce((n, s) => n + s.shortfallValue, 0));
      }
      // Revenue counts every bill's guests; this page leaves voided bills out, and nothing else.
      const voided = d.orders.filter((x) => x.outletId === o.outletId && x.date >= from && x.voided).reduce((n, x) => n + x.covers, 0);
      const revenue = d.dayOutlets.filter((x) => x.outletId === o.outletId && x.date >= from && x.date <= DEMO_TODAY).reduce((n, x) => n + x.covers, 0);
      expect(o.guests + voided).toBe(revenue);
    }
  });

  it("gives the trend the same guests and drinks as the comparison, day by day", () => {
    const d = getDataset();
    const days = eachDay({ from: addDays(DEMO_TODAY, -6), to: DEMO_TODAY });
    const trend = teamByDay(d.orders, ["lis-terrace", "lis-ird"], days);
    const cmp = compareWaiters(d.orders, { outletIds: ["lis-terrace", "lis-ird"], from: days[0], to: DEMO_TODAY });
    expect(trend.reduce((n, x) => n + x.guests, 0)).toBe(cmp.reduce((n, o) => n + o.guests, 0));
    expect(trend.reduce((n, x) => n + x.drinks, 0)).toBe(cmp.reduce((n, o) => n + o.drinks, 0));
  });

  it("is a page of Revenue, not a new menu item", () => {
    expect(activeItem("/money", "waiters")?.id).toBe("revenue");
  });
});

describe("who sees what", () => {
  const json = (r: unknown) => JSON.stringify(r);

  it("opens for managers and the controller, not for chef, purchasing or staff", () => {
    for (const id of ["u-owner", "u-gm", "u-fnb", "u-fc", "u-rm"]) expect(waitersFor(U(id), {}).ok, id).toBe(true);
    for (const id of ["u-chef", "u-buy", "u-emp", "u-events", "u-fo"]) {
      const r = waitersFor(U(id), {});
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    }
  });

  it("names waiters only for the roles that coach them", () => {
    expect(["u-owner", "u-gm", "u-fnb", "u-rm"].every((id) => mayNameWaiters(U(id)))).toBe(true);
    expect(mayNameWaiters(U("u-fc"))).toBe(false);
    const fnb = waitersFor(U("u-fnb"), {});
    const fc = waitersFor(U("u-fc"), {});
    if (!fnb.ok || !fc.ok) throw new Error("expected both to load");
    expect(fnb.outlets[0].waiters[0]).toMatchObject({ key: "MER-S1", name: "Rahul Okafor", status: "coach" });
    // The controller sees the same figures under a label, with no name and no till login anywhere in the answer.
    expect(fc.outlets[0].waiters[0]).toMatchObject({ name: "Server 1", status: "coach", shortfallValue: fnb.outlets[0].waiters[0].shortfallValue });
    const text = json(fc);
    expect(text).not.toMatch(/\b[A-Z]{3}-S\d\b/);
    for (const s of STAFF.filter((x) => ["lis-terrace", "lis-lobby", "lis-ird"].includes(x.outletId))) expect(text, s.name).not.toContain(s.name);
    expect(fc.mayCoach).toBe(false);
  });

  it("keeps a restaurant manager to their own outlet and leaves banquets out", () => {
    const rm = waitersFor(U("u-rm"), { outlets: "lis-terrace,lis-lobby" });
    if (!rm.ok) throw new Error("expected to load");
    expect(rm.outlets.map((o) => o.outletId)).toEqual(["lis-terrace"]);
    const fnb = waitersFor(U("u-fnb"), {});
    if (!fnb.ok) throw new Error("expected to load");
    expect(fnb.outlets.map((o) => o.outletId).sort()).toEqual(["lis-ird", "lis-lobby", "lis-terrace"]);
    expect(fnb.left).toEqual(["lis-banquets"]);
    // Seven days are offered too.
    const week = waitersFor(U("u-fnb"), { days: "7" });
    if (!week.ok) throw new Error("expected to load");
    expect(week.from).toBe(addDays(DEMO_TODAY, -6));
  });

  it("saves coaching on the server with who did it, and lets it be taken back", () => {
    expect(can(U("u-fc"), "waiters.coach")).toBe(false);
    expect(recordCoaching(U("u-fc"), { outletId: "lis-terrace", staffId: "MER-S1", outcome: "coached" })).toMatchObject({ ok: false, status: 403 });
    expect(recordCoaching(U("u-rm"), { outletId: "lis-lobby", staffId: "AZU-S1", outcome: "coached" })).toMatchObject({ ok: false, status: 403 });
    expect(recordCoaching(U("u-fnb"), { outletId: "lis-terrace", staffId: "AZU-S1", outcome: "coached" })).toMatchObject({ ok: false, status: 400 });
    expect(recordCoaching(U("u-fnb"), { outletId: "lis-terrace", staffId: "MER-S1", outcome: "fired" })).toMatchObject({ ok: false, status: 400 });
    expect(recordCoaching(U("u-fnb"), { outletId: "lis-banquets", staffId: "BQT-S1", outcome: "coached" })).toMatchObject({ ok: false, status: 400 });
    const r = recordCoaching(U("u-rm"), { outletId: "lis-terrace", staffId: "MER-S1", outcome: "coached", note: "  Suggest a drink with the order  " });
    if (!r.ok) throw new Error(r.error);
    expect(r.coaching).toMatchObject({ by: "u-rm", role: "restaurant_manager", shift: "evening", note: "Suggest a drink with the order", date: DEMO_TODAY, days: 30 });
    expect(r.coaching.rate!).toBeLessThan(r.coaching.peerRate!);
    // Everyone who sees the waiter sees the note, the controller under the label.
    const fnb = waitersFor(U("u-fnb"), {});
    const fc = waitersFor(U("u-fc"), {});
    if (!fnb.ok || !fc.ok) throw new Error("expected both to load");
    expect(fnb.outlets[0].waiters[0].coaching).toMatchObject({ id: r.coaching.id, outcome: "coached", by: "u-rm" });
    expect(fc.outlets[0].waiters[0].coaching?.id).toBe(r.coaching.id);
    expect(clearCoaching(U("u-fc"), { id: r.coaching.id })).toMatchObject({ ok: false, status: 403 });
    expect(clearCoaching(U("u-fnb"), { id: r.coaching.id })).toMatchObject({ ok: true });
    expect(loadStore().waiterCoaching).toEqual([]);
  });

  it("clears coaching notes with the stock reset", () => {
    const r = recordCoaching(U("u-fnb"), { outletId: "lis-lobby", staffId: "AZU-S2", outcome: "no_change" });
    expect(r.ok).toBe(true);
    expect(loadStore().waiterCoaching).toHaveLength(1);
    expect(resetDemo(U("u-gm"), "stock").ok).toBe(true);
    expect(loadStore().waiterCoaching).toEqual([]);
  });
});
