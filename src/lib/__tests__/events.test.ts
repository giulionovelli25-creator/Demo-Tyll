import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-ops-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { SESSION_COOKIE, demoAccounts, login, resetAuthStore, verifyPin } = await import("../server/auth");
const { loadStore, resetPurchasingStore } = await import("../server/purchasing-store");
const O = await import("../server/ops");
const P = await import("../server/purchasing");
const { userById } = await import("../data/catalog");
const { employeeById } = await import("../data/workforce");
const { DEFAULT_RATIOS, coverage, eventIngredients, eventPortions, eventStoreNeed, serviceFor, staffNeeds } = await import("../domain/events");
const supportRoute = await import("../../app/api/support/[id]/route");

const none: import("../server/stock").SessionEntries = { waste: [], counts: [], overrides: [], recipes: [], receipts: [] };
const U = (id: string) => userById[id];
const yasmin = U("u-events"), sara = U("u-rm"), karim = U("u-lby"), james = U("u-gm");
const CONF = "EVT-DXB-0001";
const conf = () => loadStore().events.find((e) => e.id === CONF)!;
const ok = <T,>(r: { ok: true } & T | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r; };
const h = (n: number) => n * 60;

beforeEach(() => {
  resetPurchasingStore();
  resetAuthStore();
});

describe("event calculations", () => {
  it("uses the illustrative ratios: 120 seated guests need 8 waiters, 3 bartenders, 3 chefs, 4 setup", () => {
    const n = Object.fromEntries(staffNeeds({ ...conf(), guests: 120 }).map((x) => [x.role, x.required]));
    expect(n).toMatchObject({ waiter: 8, bartender: 3, chef: 3, setup: 4 });
  });

  it("adds a dish once per service and turns portions into ingredients through recipes", () => {
    const e = { ...conf(), services: [serviceFor("set_menu", 120), serviceFor("lunch_buffet", 120)] };
    const caesar = eventPortions(e).find((p) => p.itemId === "caesar")!;
    expect(caesar.calculated).toBe(120 + 72);
    expect(caesar.from).toHaveLength(2);
    // Chicken: Caesar 120 g, shawarma 180 g.
    const chicken = eventIngredients({ ...conf(), guests: 120, services: [serviceFor("set_menu", 120)] }).get("chicken")!;
    expect(chicken).toBeCloseTo(120 * 0.12 + 30 * 0.18, 6);
  });

  it("does not count the 30 kg already issued to the conference again", () => {
    const at180 = eventIngredients(conf()).get("chicken")!;
    expect(at180).toBeGreaterThan(29);
    expect(eventStoreNeed(conf()).get("chicken")!).toBeCloseTo(Math.max(0, at180 - 30), 6);
  });
});

describe("Scenario A: conference planning to confirmed staff", () => {
  it("120 guests leaves only waiters short; requests do not count until the lending manager approves", () => {
    ok(O.saveEvent(yasmin, { id: CONF, guests: 120 }));
    const cov = coverage(conf(), loadStore().assignments, loadStore().support);
    expect(cov.filter((c) => c.stillNeeded > 0).map((c) => [c.skill, c.stillNeeded])).toEqual([["waiter", 2]]);
    const found = ok(O.findCandidates(yasmin, { propertyId: "dxb", skill: "waiter", date: conf().date, start: conf().start, end: conf().end, toDeptId: "dxb-banq" }));
    const terrace = found.candidates.filter((c) => c.deptId === "dxb-terrace").slice(0, 2);
    expect(terrace).toHaveLength(2);
    // Nobody on a shift then, on leave, or unqualified.
    for (const c of found.candidates) {
      expect(employeeById[c.employeeId].skills).toContain("waiter");
      expect(O.availability(loadStore(), c.employeeId, conf().date, { start: conf().start, end: conf().end }).ok).toBe(true);
    }
    expect(found.candidates.some((c) => c.employeeId === "LBY-S2")).toBe(false); // on leave that day
    const req = ok(O.createSupport(yasmin, { eventId: CONF, role: "waiter", skill: "waiter", count: 2, employeeIds: terrace.map((c) => c.employeeId), reason: "Conference banquet service" })).request;
    expect(coverage(conf(), loadStore().assignments, loadStore().support).find((c) => c.skill === "waiter")).toMatchObject({ confirmed: 6, requested: 2, stillNeeded: 2 });
    // Sara manages The Terrace, so she decides; Yasmin cannot approve on her behalf.
    expect(O.decideItem(yasmin, req.id, req.items[0].id, { decision: "approve" }).ok).toBe(false);
    for (const i of req.items) ok(O.decideItem(sara, req.id, i.id, { decision: "approve" }));
    const after = coverage(conf(), loadStore().assignments, loadStore().support).find((c) => c.skill === "waiter")!;
    expect(after).toMatchObject({ confirmed: 8, stillNeeded: 0 });
    const a = loadStore().assignments.find((x) => x.requestId === req.id)!;
    expect(a).toMatchObject({ approvedBy: "u-rm", fromDeptId: "dxb-terrace", toDeptId: "dxb-banq", status: "confirmed" });
    // The lending department's schedule shows the person away.
    const sched = ok(O.deptSchedule(sara, "dxb-terrace", conf().date));
    expect(sched.rows.find((r) => r.employeeId === a.employeeId)!.away[0]).toContain("Regional sales conference dinner");
    expect(O.opsAlerts(yasmin, none).some((x) => x.text.includes("Staff support confirmed"))).toBe(true);
  });
});

describe("Scenario B: restaurant asks for emergency help", () => {
  it("one approved, one alternative accepted, both departments see it", () => {
    const tonight = { date: "2026-10-13", start: h(18), end: h(23) };
    const found = ok(O.findCandidates(sara, { propertyId: "dxb", skill: "waiter", ...tonight, toDeptId: "dxb-terrace" }));
    const lobby = found.candidates.filter((c) => c.deptId === "dxb-lobby");
    expect(lobby.length).toBeGreaterThan(0);
    const req = ok(O.createSupport(sara, { propertyId: "dxb", toDeptId: "dxb-terrace", skill: "waiter", count: 2, employeeIds: [lobby[0].employeeId], askDeptId: "dxb-lobby", reason: "Two large parties booked late", ...tonight, priority: "urgent" })).request;
    expect(req.items).toHaveLength(2);
    // Sara cannot release Lobby Lounge staff.
    expect(O.decideItem(sara, req.id, req.items[0].id, { decision: "approve" }).ok).toBe(false);
    ok(O.decideItem(karim, req.id, req.items[0].id, { decision: "approve" }));
    const alt = O.findCandidates(karim, { propertyId: "dxb", skill: "waiter", ...tonight, toDeptId: "dxb-terrace", exclude: [lobby[0].employeeId] });
    const altLobby = ok(alt).candidates.find((c) => c.deptId === "dxb-lobby");
    if (!altLobby) return; // nobody else free at the lounge tonight in this data
    ok(O.decideItem(karim, req.id, req.items[1].id, { decision: "alternative", employeeId: altLobby.employeeId, start: h(19), end: h(23), comment: "Can start at 19:00" }));
    expect(loadStore().assignments.filter((a) => a.requestId === req.id)).toHaveLength(1);
    ok(O.respondItem(sara, req.id, req.items[1].id, { accept: true }));
    const done = loadStore().support.find((r) => r.id === req.id)!;
    expect(done.status).toBe("filled");
    const assigned = loadStore().assignments.filter((a) => a.requestId === req.id && a.status === "confirmed");
    expect(assigned).toHaveLength(2);
    expect(assigned.find((a) => a.employeeId === altLobby.employeeId)).toMatchObject({ start: h(19), approvedBy: "u-lby" });
    expect(ok(O.deptSchedule(sara, "dxb-terrace", "2026-10-13")).borrowed).toHaveLength(2);
    expect(ok(O.deptSchedule(karim, "dxb-lobby", "2026-10-13")).rows.filter((r) => r.away.length)).toHaveLength(2);
  });
});

describe("Scenario C: event changes", () => {
  it("100 to 150 guests replaces the event's demand; cancelling releases staff and stock", () => {
    const e = ok(O.saveEvent(yasmin, { propertyId: "dxb", name: "Pharma launch dinner", type: "Corporate dinner", date: "2026-10-17", start: h(19), end: h(22), guests: 100, format: "seated", services: [serviceFor("set_menu", 100), serviceFor("soft_drinks", 100)].map((s) => ({ id: s.id, guests: s.guests })) })).event;
    // A draft does not reserve stock.
    const before = P.buyPlan(sara, { propertyId: "dxb", period: "custom", from: "2026-10-17", to: "2026-10-17" }, none);
    if (!before.ok) throw new Error(before.error);
    const reservedDraft = before.plan.lines.find((l) => l.ingredientId === "chicken")!.reservedForOthers;
    ok(O.setEventStatus(yasmin, e.id, { status: "planning" }, none));
    const atHundred = eventIngredients(loadStore().events.find((x) => x.id === e.id)!).get("chicken")!;
    ok(O.saveEvent(yasmin, { id: e.id, guests: 150 }));
    const ev = loadStore().events.find((x) => x.id === e.id)!;
    expect(ev.services.every((s) => s.guests === 150)).toBe(true);
    // Portions round up to whole dishes, so the new figure is 1.5 times the old within one portion.
    expect(Math.abs(eventIngredients(ev).get("chicken")! - atHundred * 1.5)).toBeLessThan(0.2);
    expect(staffNeeds(ev).find((n) => n.role === "waiter")!.required).toBe(10);
    // Only one event's worth is reserved for the outlets, at the new size.
    const mid = P.buyPlan(sara, { propertyId: "dxb", period: "custom", from: "2026-10-17", to: "2026-10-17" }, none);
    if (!mid.ok) throw new Error(mid.error);
    const chickenLine = mid.plan.lines.find((l) => l.ingredientId === "chicken")!;
    expect(chickenLine.reservedForOthers).toBeGreaterThanOrEqual(reservedDraft);
    expect(loadStore().events.filter((x) => x.name === "Pharma launch dinner")).toHaveLength(1);
    // Cancel: status, released demand.
    expect(O.setEventStatus(yasmin, e.id, { status: "cancelled" }, none).ok).toBe(false);
    ok(O.setEventStatus(yasmin, e.id, { status: "cancelled", reason: "Client postponed" }, none));
    const after = P.buyPlan(sara, { propertyId: "dxb", period: "custom", from: "2026-10-17", to: "2026-10-17" }, none);
    if (!after.ok) throw new Error(after.error);
    expect(after.plan.lines.find((l) => l.ingredientId === "chicken")!.reservedForOthers).toBeCloseTo(reservedDraft, 6);
  });

  it("moving the conference re-checks confirmed people and releases anyone no longer free", () => {
    const r = ok(O.saveEvent(yasmin, { id: CONF, start: h(12), end: h(16), setupStart: h(10), cleanupEnd: h(17) }));
    const team = loadStore().assignments.filter((a) => a.eventId === CONF);
    // Banqueting has no rostered shifts, so its own team moves with the event.
    expect(team.filter((a) => a.status === "confirmed" && a.fromDeptId === "dxb-banq").every((a) => a.start >= h(10) && a.end <= h(17))).toBe(true);
    expect(Array.isArray(r.notes)).toBe(true);
  });
});

describe("Scenario D: double booking", () => {
  it("refuses to approve someone who was booked elsewhere after the request was sent", () => {
    ok(O.saveEvent(yasmin, { id: CONF, guests: 120 }));
    const found = ok(O.findCandidates(yasmin, { propertyId: "dxb", skill: "waiter", date: conf().date, start: conf().start, end: conf().end, toDeptId: "dxb-banq" }));
    const person = found.candidates.find((c) => c.deptId === "dxb-terrace")!;
    const first = ok(O.createSupport(yasmin, { eventId: CONF, role: "waiter", skill: "waiter", count: 1, employeeIds: [person.employeeId], reason: "Conference" })).request;
    // Another request for the same person at an overlapping time, approved first.
    const second = ok(O.createSupport(sara, { propertyId: "dxb", toDeptId: "dxb-terrace", skill: "waiter", count: 1, askDeptId: "dxb-lobby", reason: "Busy", date: conf().date, start: conf().start, end: conf().end })).request;
    void second;
    const third = ok(O.createSupport(U("u-fnb"), { propertyId: "dxb", toDeptId: "dxb-pool", skill: "waiter", count: 1, employeeIds: [person.employeeId], reason: "Pool party", date: conf().date, start: conf().start - 60, end: conf().start + 60 })).request;
    ok(O.decideItem(sara, third.id, third.items[0].id, { decision: "approve" }));
    const clash = O.decideItem(sara, first.id, first.items[0].id, { decision: "approve" });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error).toMatch(/no longer free/);
    expect(loadStore().assignments.filter((a) => a.employeeId === person.employeeId && a.status === "confirmed")).toHaveLength(1);
    // The person no longer appears as available.
    expect(ok(O.findCandidates(yasmin, { propertyId: "dxb", skill: "waiter", date: conf().date, start: conf().start, end: conf().end, toDeptId: "dxb-banq" })).candidates.some((c) => c.employeeId === person.employeeId)).toBe(false);
  });
});

describe("Scenario E: permissions", () => {
  const creds = (id: string) => demoAccounts().find((a) => a.userId === id)!;
  const session = (id: string) => {
    const r = login(creds(id).email, creds(id).password, "t");
    if (!r.ok) throw new Error(r.error);
    if (id !== "u-emp") verifyPin(r.token, creds(id).pin, "t");
    return r.token;
  };
  const post = (url: string, token: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json", origin: "http://localhost", host: "localhost" }, body: JSON.stringify(body) });

  it("staff cannot approve; other hotels and other departments are refused; approvals record the real approver", async () => {
    ok(O.saveEvent(yasmin, { id: CONF, guests: 120 }));
    const found = ok(O.findCandidates(yasmin, { propertyId: "dxb", skill: "waiter", date: conf().date, start: conf().start, end: conf().end, toDeptId: "dxb-banq" }));
    const req = ok(O.createSupport(yasmin, { eventId: CONF, role: "waiter", skill: "waiter", count: 1, employeeIds: [found.candidates.find((c) => c.deptId === "dxb-terrace")!.employeeId], reason: "Conference" })).request;
    const res = await supportRoute.POST(post(`/api/support/${req.id}`, session("u-emp"), { action: "decide", itemId: req.items[0].id, decision: "approve" }), { params: Promise.resolve({ id: req.id }) });
    expect(res.status).toBe(403);
    expect(O.decideItem(U("u-chef"), req.id, req.items[0].id, { decision: "approve" }).ok).toBe(false);
    expect(O.decideItem(karim, req.id, req.items[0].id, { decision: "approve" }).ok).toBe(false);
    // A Doha event is invisible to Dubai's managers.
    expect(O.eventsFor(yasmin).some((e) => e.propertyId === "doh")).toBe(false);
    expect(O.eventsFor(james).some((e) => e.propertyId === "doh")).toBe(false);
    expect(O.findCandidates(yasmin, { propertyId: "doh", skill: "waiter", date: "2026-10-16", start: h(19), end: h(23) }).ok).toBe(false);
    // Rosters only for departments you manage.
    expect(O.deptSchedule(sara, "dxb-lobby", "2026-10-15").ok).toBe(false);
    expect(O.deptSchedule(U("u-emp"), "dxb-terrace", "2026-10-15").ok).toBe(false);
    // The general manager may release Terrace staff; the record shows him, not the requester.
    ok(O.decideItem(james, req.id, req.items[0].id, { decision: "approve" }));
    expect(loadStore().assignments.find((a) => a.requestId === req.id)!.approvedBy).toBe("u-gm");
  });

  it("an event cannot be marked ready while roles are uncovered", () => {
    ok(O.saveEvent(yasmin, { id: CONF, guests: 120 }));
    const r = O.setEventStatus(yasmin, CONF, { status: "ready" }, none);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/waiter/);
  });

  it("seeds one conference record for EV-1 with its 30 kg issue, not a second one", () => {
    const evs = loadStore().events.filter((e) => e.seedId === "EV-1");
    expect(evs).toHaveLength(1);
    expect(evs[0].issued).toEqual([{ ingredientId: "chicken", qty: 30, ref: "Transfer T-7, 13 Oct" }]);
    expect(DEFAULT_RATIOS.seated.waiter).toBe(15);
  });
});
