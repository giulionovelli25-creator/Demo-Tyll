import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-late-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const D = await import("../domain/late-delivery");
const L = await import("../server/late-delivery");
const P = await import("../server/purchasing");
const { resetPurchasingStore, loadStore } = await import("../server/purchasing-store");
const { userById } = await import("../data/catalog");
const { deliveryHistory } = await import("../data/delivery-history");
const { DEMO_TODAY, addDays, weekday } = await import("../util");
type Timing = import("../domain/late-delivery").DeliveryTiming;

const U = (id: string) => userById[id];
const tomorrow = addDays(DEMO_TODAY, 1);

/** A delivery record: `late` minutes after a 07:00 to 08:00 window, or on time at 07:40. */
function rec(supplierId: string, date: string, late: number | null, value = 400): Timing {
  return { id: `${supplierId}-${date}`, propertyId: "lis", supplierId, date, orderedAt: `${addDays(date, -1)}T12:00`, window: { from: "07:00", to: "08:00" }, arrivedAt: late === null ? `${date}T07:40` : D.stamp(date, 8 * 60 + late), complete: true, value, items: [], source: "simulated" };
}
/** Daily deliveries for `days` days before today. */
const daily = (supplierId: string, days: number, late: (date: string, i: number) => number | null, value: (date: string) => number = () => 400) =>
  Array.from({ length: days }, (_, i) => addDays(DEMO_TODAY, -1 - i)).map((date, i) => rec(supplierId, date, late(date, i), value(date)));
const coming = (supplierId: string, date = tomorrow, value = 400) => ({ supplierId, date, window: { from: "07:00", to: "08:00" }, value });

/** A day of use: 1 kg at breakfast, 2 kg at lunch, 3 kg at dinner. */
const use = { breakfast: 1, lunch: 2, dinner: 3 };

describe("the prediction", () => {
  it("a reliable supplier is predicted on time and gives no alert", () => {
    const record = daily("bev", 60, (_, i) => (i === 17 ? 20 : null));
    const p = D.predict(record, coming("bev"), DEMO_TODAY);
    expect(p.verdict).toBe("on_time");
    expect(p.chance!).toBeLessThan(D.LATE_RULES.maybe);
    expect(p.likelyArrival).toBe(`${tomorrow}T08:00`);
    // Even with almost nothing in stock, an on time delivery is not a late delivery problem.
    expect(D.lateShortfall(tomorrow, 0.5, use, { to: "08:00" }, p.likelyArrival)).toBeNull();
  });

  it("finds a weekday pattern and explains it in one sentence a chef understands", () => {
    const wd = weekday(tomorrow);
    const record = daily("meat", 84, (date) => (weekday(date) === wd ? 120 : null));
    const p = D.predict(record, coming("meat"), DEMO_TODAY);
    expect(p.verdict).toBe("likely");
    expect(p.driver).toBe("weekday");
    expect(p.sentence).toBe(`Late on 10 of the last 10 ${D.WEEKDAYS[wd]}s, 2 hours on average.`);
    expect(p.likelyArrival).toBe(`${tomorrow}T10:00`);
    expect(p.confidence).toBe("high");
    // The same supplier on another weekday is on time.
    expect(D.predict(record, coming("meat", addDays(tomorrow, 1)), DEMO_TODAY).verdict).toBe("on_time");
  });

  it("weighs recent deliveries more", () => {
    const wd = weekday(tomorrow);
    // Late on this weekday only in the last four weeks: recent, so it counts for more than the eight on time weeks before.
    const recent = daily("meat", 84, (date, i) => (weekday(date) === wd && i < 28 ? 120 : null));
    const old = daily("meat", 84, (date, i) => (weekday(date) === wd && i >= 56 ? 120 : null));
    expect(D.predict(recent, coming("meat"), DEMO_TODAY).chance!).toBeGreaterThan(D.predict(old, coming("meat"), DEMO_TODAY).chance!);
  });

  it("fewer than 8 deliveries shows the supplier as learning, with no prediction", () => {
    const record = daily("ware", 7, () => 90);
    const p = D.predict(record, coming("ware"), DEMO_TODAY);
    expect(p.verdict).toBe("learning");
    expect(p.chance).toBeNull();
    expect(p.confidence).toBe("learning");
    expect(p.sentence).toMatch(/^Learning this supplier: 7 deliveries so far/);
    expect(D.confidenceOf(8)).toBe("low");
    expect(D.CONFIDENCE_WORD.learning).toBe("Learning this supplier");
  });

  it("the holiday effect: late after a public holiday, on time otherwise", () => {
    expect(D.isHoliday("2026-10-05")).toBe(true);
    expect(D.isHoliday("2026-04-03")).toBe(true); // Good Friday 2026
    expect(D.holidayBefore("2026-10-06")).toBe("2026-10-05");
    expect(D.holidayBefore("2026-10-07")).toBe("2026-10-05");
    expect(D.holidayBefore("2026-10-08")).toBeNull();
    expect(D.holidayBefore("2026-10-05")).toBeNull();
    // A year of fish deliveries before an "after the holiday" date, late only after holidays.
    const today = "2026-12-09"; // 8 December is a holiday, so tomorrow (the 10th) comes after one
    const record = Array.from({ length: 300 }, (_, i) => addDays(today, -1 - i)).map((date) => rec("sea", date, D.holidayBefore(date) ? 100 : null));
    const after = D.predict(record, { supplierId: "sea", date: "2026-12-10", window: { from: "07:00", to: "08:00" }, value: 400 }, today);
    expect(after.driver).toBe("holiday");
    expect(after.verdict).toBe("likely");
    expect(after.sentence).toMatch(/^Late on \d+ of the last \d+ deliveries after a public holiday, 1 hour 40 minutes on average\.$/);
    const plain = D.predict(record, { supplierId: "sea", date: "2026-12-12", window: { from: "07:00", to: "08:00" }, value: 400 }, today);
    expect(plain.verdict).toBe("on_time");
  });

  it("a large order is its own pattern", () => {
    const record = daily("sea", 84, (_, i) => (i % 6 === 0 ? 70 : null), (date) => (Number(date.slice(8)) % 6 === 0 ? 900 : 400));
    const fixed = daily("sea", 84, (date) => (Number(date.slice(8)) % 6 === 0 ? 70 : null), (date) => (Number(date.slice(8)) % 6 === 0 ? 900 : 400));
    const p = D.predict(fixed, coming("sea", tomorrow, 900), DEMO_TODAY);
    expect(p.driver).toBe("size");
    expect(p.verdict).toBe("likely");
    expect(D.predict(fixed, coming("sea", tomorrow, 400), DEMO_TODAY).verdict).toBe("on_time");
    expect(record.length).toBe(84);
  });
});

describe("only alert when it matters", () => {
  it("a late supplier with enough stock gives no alert", () => {
    expect(D.lateShortfall(tomorrow, 10, use, { to: "08:00" }, `${tomorrow}T11:00`)).toBeNull();
  });

  it("a late supplier with stock running out before lunch prep gives an alert", () => {
    const s = D.lateShortfall(tomorrow, 2.5, use, { to: "08:00" }, `${tomorrow}T10:20`);
    expect(s).toMatchObject({ service: "lunch", have: 1.5, need: 2, neededBy: `${tomorrow}T09:30` });
    expect(s!.short).toBeCloseTo(0.5);
    // 0.5 of 2 kg is a quarter of lunch: red.
    expect(D.severityOf(s!)).toBe("red");
    expect(D.severityOf({ ...s!, short: 0.2 })).toBe("amber");
  });

  it("a delivery that arrives before lunch prep covers lunch, however late it was", () => {
    expect(D.lateShortfall(tomorrow, 1.2, use, { to: "08:00" }, `${tomorrow}T09:15`)).toBeNull();
  });

  it("a shortage there would be anyway is a stock problem, not a delivery one", () => {
    // Breakfast prep starts at 06:00, before the window: it relies on stock whatever the delivery does.
    expect(D.lateShortfall(tomorrow, 0.5, use, { to: "08:00" }, `${tomorrow}T12:00`)).toBeNull();
  });
});

describe("hotel time and midnight", () => {
  it("reads the hotel's own date and time, not the server's", () => {
    // 23:30 UTC in summer is 00:30 the next day in Lisbon; in winter it is still 23:30.
    expect(D.localNow("Europe/Lisbon", new Date("2026-07-14T23:30:00Z"))).toEqual({ date: "2026-07-15", min: 30 });
    expect(D.localNow("Europe/Lisbon", new Date("2026-11-19T23:30:00Z"))).toEqual({ date: "2026-11-19", min: 23 * 60 + 30 });
    // The same instant is already the next afternoon in Dubai.
    expect(D.localNow("Asia/Dubai", new Date("2026-11-19T23:30:00Z"))).toEqual({ date: "2026-11-20", min: 3 * 60 + 30 });
  });

  it("an arrival past midnight rolls into the next day", () => {
    expect(D.stamp("2026-11-20", 23 * 60 + 50 + 30)).toBe("2026-11-21T00:20");
    expect(D.minutesFrom("2026-11-20", "2026-11-21T00:20")).toBe(24 * 60 + 20);
    expect(D.minutesLate({ date: "2026-11-20", window: { from: "22:00", to: "23:30" }, arrivedAt: "2026-11-21T00:20" })).toBe(50);
  });

  it("warns the evening before and before prep on the day, around midnight", () => {
    const due = "2026-11-21", by = "2026-11-21T09:30";
    expect(D.warnPhase({ date: "2026-11-20", min: 17 * 60 + 59 }, due, by)).toBeNull();
    expect(D.warnPhase({ date: "2026-11-20", min: 20 * 60 + 55 }, due, by)).toBe("evening");
    expect(D.warnPhase({ date: "2026-11-20", min: 23 * 60 + 59 }, due, by)).toBe("evening");
    // Just after midnight nobody is woken up; from 05:00 the morning warning goes until prep starts.
    expect(D.warnPhase({ date: "2026-11-21", min: 1 }, due, by)).toBeNull();
    expect(D.warnPhase({ date: "2026-11-21", min: 5 * 60 }, due, by)).toBe("morning");
    expect(D.warnPhase({ date: "2026-11-21", min: 9 * 60 + 30 }, due, by)).toBeNull();
  });
});

// ---- On the demo data and the server --------------------------------------------------------------------------------

const none = () => ({ waste: [], counts: [], overrides: [], recipes: [], receipts: loadStore().records!.receiptCorrections });
const planFor = (id: string) => {
  const r = P.monthPlanFor(U(id), "lis", none() as never);
  if (!r.ok) throw new Error(r.error);
  return r.plan;
};
const meatKey = `meat|${tomorrow}`;

beforeEach(() => {
  resetPurchasingStore();
  L.ensureDeliveryStory();
});

describe("the demo story", () => {
  it("tomorrow's meat delivery is likely late and leaves lunch short of Wagyu, with the backup butcher offered", () => {
    const plan = planFor("u-buy");
    const top = plan.risk!.rows[0];
    expect(top).toMatchObject({ key: meatKey, supplier: "Carnes Ribeiro & Filhos", status: "alert", severity: "red", phase: "evening" });
    expect(top.prediction.sentence).toMatch(new RegExp(`^Late on 7 of the last 10 ${D.WEEKDAYS[weekday(tomorrow)]}s, 2 hours( \\d+ minutes)? on average\\.$`));
    const wagyu = top.items[0];
    expect(wagyu).toMatchObject({ ingredientId: "wagyu", onDelivery: 10 });
    expect(wagyu.shortfall).toMatchObject({ service: "lunch", neededBy: `${tomorrow}T09:30` });
    expect(wagyu.stockAtStart).toBeCloseTo(2.4, 0);
    expect(wagyu.dishes.map((d) => d.name)).toContain("Wagyu beef burger");
    expect(wagyu.outletIds).toContain("lis-terrace");
    expect(top.valueAtRisk).toBeGreaterThan(40);
    expect(top.backup).toMatchObject({ supplierId: "meat-alt", name: "Talho Central", arrives: tomorrow });
    // The story's records are ordinary saved records with person and role.
    const s = loadStore();
    expect(s.records!.receiptCorrections.find((r) => r.id.startsWith(L.STORY_RECEIPT_PREFIX))).toMatchObject({ received: 0, by: "u-store", role: "storekeeper" });
    expect(s.stockLog.waste.find((w) => w.id.startsWith(L.STORY_WASTE_PREFIX))).toMatchObject({ ingredientId: "wagyu", reason: "spoilage", byUser: "u-chef" });
  });

  it("the story's goods in record passes the server's check of what a browser sends", async () => {
    const { cleanEntries } = await import("../server/stock");
    const kept = cleanEntries(U("u-fnb"), { receipts: loadStore().records!.receiptCorrections });
    expect(kept.receipts.map((r) => r.id)).toEqual([`${L.STORY_RECEIPT_PREFIX}${DEMO_TODAY.replace(/-/g, "")}`]);
  });

  it("setting up the story twice changes nothing", () => {
    const before = JSON.stringify([loadStore().records!.receiptCorrections, loadStore().stockLog.waste]);
    L.ensureDeliveryStory();
    expect(JSON.stringify([loadStore().records!.receiptCorrections, loadStore().stockLog.waste])).toBe(before);
  });

  it("the other suppliers have their own patterns: fish after holidays, drinks on time, glassware still learning", () => {
    const r = L.reliabilityFor(U("u-buy"), "lis", 12);
    if (!r.ok) throw new Error(r.error);
    const by = Object.fromEntries(r.rows.map((x) => [x.supplierId, x]));
    expect(by.bev.onTimeRate!).toBeGreaterThanOrEqual(0.9);
    expect(by.ware.confidence).toBe("learning");
    expect(by.meat.pattern).toMatch(new RegExp(`${D.WEEKDAYS[weekday(tomorrow)]}s`));
    expect(by.meat.byWeekday[weekday(tomorrow)].late).toBeGreaterThanOrEqual(8);
    expect(by.sea.confidence).toBe("high");
    expect(r.rows.at(-1)!.supplierId).toBe("ware");
    // Twelve weeks of history for every supplier that has deliveries.
    expect(deliveryHistory().filter((d) => d.supplierId === "meat" && d.arrivedAt).length).toBeGreaterThanOrEqual(80);
  });

  it("warns Purchasing, the head chef and Mercado's manager once, with an email prepared and not sent", () => {
    L.warnFromPlan("lis", planFor("u-buy").items);
    L.warnFromPlan("lis", planFor("u-buy").items);
    const notices = loadStore().notify.notices.filter((n) => n.type === "late-delivery");
    expect(new Set(notices.map((n) => n.to))).toEqual(new Set(["u-buy", "u-chef", "u-rm"]));
    expect(notices).toHaveLength(3);
    expect(notices[0].title).toMatch(/^Carnes Ribeiro & Filhos delivery tomorrow 07:00 likely late: Wagyu beef mince runs short before lunch$/);
    expect(notices[0].body).toContain("This is a prediction");
    const emails = loadStore().notify.emails.filter((e) => e.subject.includes("likely late"));
    expect(emails.length).toBe(3);
    expect(emails.every((e) => e.status === "logged")).toBe(true);
  });

  it("orders for an often late weekday go a day early, with the reason", () => {
    const record = deliveryHistory();
    const nextWeek = addDays(tomorrow, 7);
    const b = D.leadBuffer(record, { supplierId: "meat", date: nextWeek, window: { from: "07:00", to: "08:00" }, value: 400 }, DEMO_TODAY, "Carnes Ribeiro & Filhos");
    expect(b?.why).toBe(`Ordered a day early: Carnes Ribeiro & Filhos is often late on ${D.WEEKDAYS[weekday(tomorrow)]}s.`);
    expect(D.leadBuffer(record, { supplierId: "bev", date: nextWeek, window: { from: "08:00", to: "09:00" }, value: 400 }, DEMO_TODAY, "Fonte Clara Bebidas")).toBeNull();
  });
});

describe("acting on it", () => {
  it("ordering from the backup supplier creates a draft that needs approval and is never sent", () => {
    const items = planFor("u-buy").items;
    const r = L.handleRisk(U("u-buy"), "lis", { key: meatKey, how: "backup" }, items);
    if (!r.ok) throw new Error(r.error);
    const po = loadStore().requests.find((x) => x.id === r.requestId)!;
    expect(po).toMatchObject({ status: "draft", supplierId: "meat-alt", deliveryDate: tomorrow });
    expect(po.lines[0]).toMatchObject({ ingredientId: "wagyu" });
    expect(po.lines[0].qty).toBeGreaterThan(0);
    expect(po.comment).toMatch(/needed by 09:30 for lunch/);
    expect(po.sentAt).toBeUndefined();
    expect(loadStore().procurement!.outbox).toHaveLength(0);
    expect(planFor("u-buy").risk!.rows.find((x) => x.key === meatKey)).toMatchObject({ status: "handled", handled: { how: "backup", by: "u-buy", role: "purchasing", label: "Ordered from the backup supplier" } });
  });

  it("handled stays handled after a refresh, for everyone, and the warnings close", () => {
    L.warnFromPlan("lis", planFor("u-buy").items);
    const r = L.handleRisk(U("u-chef"), "lis", { key: meatKey, how: "prep", note: "Burger off the lunch menu until the delivery is in." }, planFor("u-chef").items);
    expect(r.ok).toBe(true);
    // A new request reads the store again, as a page refresh does.
    for (const id of ["u-chef", "u-buy", "u-fnb"]) {
      expect(planFor(id).risk!.rows.find((x) => x.key === meatKey)).toMatchObject({ status: "handled", handled: { how: "prep", byName: "Rafael Costa", role: "chef", note: "Burger off the lunch menu until the delivery is in." } });
    }
    expect(loadStore().notify.notices.filter((n) => n.type === "late-delivery").every((n) => n.resolved)).toBe(true);
    // Taking it back puts the delivery at risk again.
    expect(L.reopenRisk(U("u-chef"), { key: meatKey }).ok).toBe(true);
    expect(planFor("u-chef").risk!.rows.find((x) => x.key === meatKey)!.status).toBe("alert");
  });

  it("a delivery that arrives clears the alert", () => {
    expect(planFor("u-buy").risk!.rows.find((x) => x.key === meatKey)!.status).toBe("alert");
    const goods = L.goodsInFor(U("u-store"));
    if (!goods.ok) throw new Error(goods.error);
    expect(goods.rows.map((x) => x.key)).toContain(meatKey);
    const a = L.recordArrival(U("u-store"), { key: meatKey, complete: false, missing: "2 kg of Wagyu" });
    expect(a.ok).toBe(true);
    const row = planFor("u-buy").risk!.rows.find((x) => x.key === meatKey)!;
    expect(row.status).toBe("arrived");
    expect(row.arrival).toMatchObject({ complete: false, missing: "2 kg of Wagyu", byName: "Ahmed Karimi" });
    expect(L.recordArrival(U("u-store"), { key: meatKey }).ok).toBe(false);
    // Short needs a word on what is missing.
    expect(L.recordArrival(U("u-store"), { key: `sea|${tomorrow}`, complete: false }).ok).toBe(false);
  });
});

describe("roles", () => {
  it("only the right roles see deliveries at risk, act on them and record arrivals", () => {
    expect(planFor("u-fc").risk!.rows.length).toBeGreaterThan(0);
    expect(L.handleRisk(U("u-fc"), "lis", { key: meatKey, how: "called" }, planFor("u-fc").items)).toMatchObject({ ok: false, status: 403 });
    expect(L.handleRisk(U("u-chef"), "lis", { key: meatKey, how: "called" }, planFor("u-chef").items).ok).toBe(true);
    expect(L.recordArrival(U("u-chef"), { key: meatKey })).toMatchObject({ ok: false, status: 403 });
    expect(L.goodsInFor(U("u-chef")).ok).toBe(false);
    expect(L.reliabilityFor(U("u-store"), "lis", 12)).toMatchObject({ ok: false, status: 403 });
    expect(L.deliveryRiskFor(U("u-store"), "lis", planFor("u-buy").items).rows).toHaveLength(0);
    // The controller sees the list; a role that cannot create orders cannot use the backup action.
    expect(L.handleRisk(U("u-events"), "lis", { key: meatKey, how: "backup" }, planFor("u-buy").items)).toMatchObject({ ok: false, status: 403 });
    expect(L.handleRisk(U("u-buy"), "lis", { key: meatKey, how: "other" }, planFor("u-buy").items)).toMatchObject({ ok: false, status: 400 });
  });

  it("a restaurant manager is warned only about the outlets they run", () => {
    // Karim runs Bar Azulejo, which serves no Wagyu: the delivery is context for him, not his alert.
    const karim = planFor("u-lby").risk!.rows.find((x) => x.key === meatKey)!;
    expect(karim.status).not.toBe("alert");
    expect(planFor("u-rm").risk!.rows.find((x) => x.key === meatKey)!.status).toBe("alert");
  });
});
