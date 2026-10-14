import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-buy-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { SESSION_COOKIE, demoAccounts, login, resetAuthStore, verifyPin } = await import("../server/auth");
const { resetPurchasingStore } = await import("../server/purchasing-store");
const P = await import("../server/purchasing");
const { stockFor } = await import("../server/stock");
const { userById } = await import("../data/catalog");
const { getDataset } = await import("../data/generate");
const { baselineFor, demandFor, periodOf } = await import("../domain/planning");
const buyRoute = await import("../../app/api/plan/buy/route");
const reqRoute = await import("../../app/api/purchasing/[id]/route");

const none: import("../server/stock").SessionEntries = { waste: [], counts: [], overrides: [], recipes: [], receipts: [] };
const U = (id: string) => userById[id];
const sara = U("u-rm");
const tomorrow = { propertyId: "dxb", period: "tomorrow" };
const lineOf = (user: typeof sara, body: Record<string, unknown>, g: string, entries = none) => {
  const r = P.buyPlan(user, body, entries);
  if (!r.ok) throw new Error(r.error);
  return r.plan.lines.find((l) => l.ingredientId === g);
};

beforeEach(() => {
  resetPurchasingStore();
  resetAuthStore();
});

describe("forecast engine", () => {
  it("counts each guest once: occupancy moves walk-ins, never booked covers", () => {
    const data = getDataset();
    const period = periodOf("3");
    const base = baselineFor(data, ["dxb-terrace"], period);
    const d0 = demandFor(data, ["dxb-terrace"], period, base.values, base);
    expect(d0.guests.reservations).toBeCloseTo(base.values.reservations, 6);
    const busy = demandFor(data, ["dxb-terrace"], period, { ...base.values, occupancy: Math.min(1, base.values.occupancy + 0.1) }, base);
    expect(busy.guests.reservations).toBeCloseTo(d0.guests.reservations, 6);
    expect(busy.guests.walkIns).toBeGreaterThan(d0.guests.walkIns);
    // Event guests are added separately, not inside the booked covers.
    const event = demandFor(data, ["dxb-terrace"], period, { ...base.values, eventGuests: base.values.eventGuests + 100 }, base);
    expect(event.guests.reservations).toBeCloseTo(d0.guests.reservations, 6);
  });

  it("follows the formula: requirement + safety − available − incoming, rounded up to packs", () => {
    const r = P.buyPlan(sara, { ...tomorrow, period: "3" }, none);
    if (!r.ok) throw new Error(r.error);
    for (const l of r.plan.lines) {
      const raw = l.requirement + l.safety - l.available - l.incoming - l.requested;
      if (raw <= 1e-9) expect(l.suggested).toBe(0);
      else {
        expect(l.suggested).toBeGreaterThanOrEqual(raw - 1e-6);
        expect(l.suggested - raw).toBeLessThan(l.pack + 1e-6);
      }
    }
  });
});

describe("Scenario A: forecast to approved request", () => {
  it("moves one request through purchasing and accounting, and the author sees it approved", () => {
    // Higher demand than booked.
    const plan = P.buyPlan(sara, { ...tomorrow, assumptions: { walkIns: 400 } }, none);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.plan.sources.walkIns).toBe("manual");
    const short = plan.plan.lines.filter((l) => l.suggested > 0).slice(0, 3);
    expect(short.length).toBeGreaterThan(0);
    const draft = P.saveRequest(sara, { propertyId: "dxb", period: "tomorrow", lines: short.map((l) => ({ ingredientId: l.ingredientId, qty: l.suggested, supplierId: l.supplierId, suggested: l.suggested })), comment: "Busy Wednesday" });
    if (!draft.ok) throw new Error(draft.error);
    const id = draft.request.id;
    expect(id).toMatch(/^PR-DXB-\d{4}$/);
    // Submitting does not raise stock.
    const before = stockFor(sara, "dxb", none).find((s) => s.ingredientId === short[0].ingredientId)!.estimated;
    expect(P.actOnRequest(sara, id, { action: "submit" }).ok).toBe(true);

    const buyer = U("u-buy");
    expect(P.requestsFor(buyer).some((r) => r.id === id)).toBe(true);
    expect(P.actOnRequest(buyer, id, { action: "purchasing", decision: "approve", changes: [{ ingredientId: short[0].ingredientId, qty: short[0].suggested + 1 }] }).ok).toBe(false);
    expect(P.actOnRequest(buyer, id, { action: "purchasing", decision: "approve", changes: [{ ingredientId: short[0].ingredientId, qty: short[0].suggested + 1, reason: "Round up to the case" }], comment: "Checked supplier" }).ok).toBe(true);
    const afterBuy = P.requestsFor(sara).find((r) => r.id === id)!;
    expect(afterBuy.status).toBe("accounting");
    expect(afterBuy.history.at(-1)!.changes![0].reason).toBe("Round up to the case");

    const fc = U("u-fc");
    expect(P.actOnRequest(fc, id, { action: "accounting", decision: "approve" }).ok).toBe(true);
    const done = P.requestsFor(sara).find((r) => r.id === id)!;
    expect(["approved", "manager"]).toContain(done.status);
    if (done.status === "manager") expect(P.actOnRequest(U("u-gm"), id, { action: "manager", decision: "approve" }).ok).toBe(true);
    const final = P.requestsFor(sara).find((r) => r.id === id)!;
    expect(final.status).toBe("approved");
    expect(final.poNumber).toBe(`PO-${id.slice(3)}`);
    expect(final.history.map((h) => h.by)).toEqual(expect.arrayContaining(["u-rm", "u-buy", "u-fc"]));
    expect(stockFor(sara, "dxb", none).find((s) => s.ingredientId === short[0].ingredientId)!.estimated).toBeCloseTo(before, 6);
    expect(P.alertsFor(sara, none).some((a) => a.id === `mine-${id}-approved`)).toBe(true);

    // Stock rises only when the delivery is received.
    expect(P.actOnRequest(buyer, id, { action: "receive", received: [] }).ok).toBe(true);
    expect(stockFor(sara, "dxb", none).find((s) => s.ingredientId === short[0].ingredientId)!.estimated).toBeGreaterThan(before);
  });

  it("does not suggest the same quantity again while a request is open", () => {
    const first = lineOf(sara, tomorrow, "wagyu")!;
    if (first.suggested <= 0) return;
    const d = P.saveRequest(sara, { ...tomorrow, lines: [{ ingredientId: "wagyu", qty: first.suggested }] });
    if (!d.ok) throw new Error(d.error);
    P.actOnRequest(sara, d.request.id, { action: "submit" });
    expect(lineOf(sara, tomorrow, "wagyu")!.suggested).toBeLessThan(first.suggested);
  });
});

describe("Scenario B: prep plan to purchasing", () => {
  it("raising burgers from the forecast to 15 more adds 2.7 kg of beef to the buy calculation", () => {
    const chef = U("u-chef");
    const sug = P.prepPlanFor(chef, { outletId: "dxb-terrace", period: "tomorrow", meal: "all" }, none);
    if (!sug.ok) throw new Error(sug.error);
    const burgers = sug.prep.suggested.burger;
    expect(burgers).toBeGreaterThan(0);
    const saved = P.savePrepPlan(chef, { outletId: "dxb-terrace", period: "tomorrow", meal: "all", portions: { ...sug.prep.suggested, burger: burgers + 15 }, suggested: sug.prep.suggested });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.plan.tasks.find((t) => t.itemId === "burger")!.portions).toBe(burgers + 15);
    const without = lineOf(sara, tomorrow, "wagyu")!;
    const withPlan = lineOf(sara, { ...tomorrow, prepPlanId: saved.plan.id }, "wagyu")!;
    // The plan rounds the forecast up to whole portions, so the difference is at least 15 burgers' worth.
    expect(withPlan.requirement - without.requirement).toBeGreaterThanOrEqual(15 * 0.18 - 1e-6);
    expect(withPlan.requirement - without.requirement).toBeLessThan(16 * 0.18);
    expect(withPlan.suggested).toBeGreaterThanOrEqual(without.suggested);
  });

  it("lets staff tick off their own tasks only, and refuses plan changes from staff", () => {
    const chef = U("u-chef");
    const saved = P.savePrepPlan(chef, { outletId: "dxb-terrace", period: "tomorrow", meal: "all", portions: { burger: 30, caesar: 20 } });
    if (!saved.ok) throw new Error(saved.error);
    const task = saved.plan.tasks[0];
    expect(P.updatePrepTask(chef, { planId: saved.plan.id, taskId: task.id, op: "assign", assigneeId: "u-emp" }).ok).toBe(true);
    const omar = U("u-emp");
    expect(P.savePrepPlan(omar, { outletId: "dxb-terrace", period: "tomorrow", meal: "all", portions: { burger: 1 } }).ok).toBe(false);
    expect(P.updatePrepTask(omar, { planId: saved.plan.id, taskId: task.id, op: "complete" }).ok).toBe(true);
    expect(P.plansFor(chef)[0].tasks[0]).toMatchObject({ done: true, doneBy: "u-emp" });
  });
});

describe("Scenario C: shared storeroom", () => {
  it("reserves other outlets' use first, so the hotel total is not counted twice", () => {
    const owner = U("u-owner");
    const all = lineOf(owner, { ...tomorrow, period: "3" }, "coke")!;
    const terrace = lineOf(sara, { ...tomorrow, period: "3" }, "coke")!;
    expect(terrace.reservedForOthers).toBeGreaterThan(0);
    expect(all.reservedForOthers).toBe(0);
    // Terrace's available stock is what is left after the others' share.
    expect(terrace.available + terrace.reservedForOthers).toBeCloseTo(all.usable, 6);
    expect(terrace.requirement).toBeLessThan(all.requirement);
  });

  it("returns no dish-level detail about other outlets to a manager", async () => {
    const r = P.buyPlan(sara, tomorrow, none);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.outletIds).toEqual(["dxb-terrace"]);
    expect(JSON.stringify(r.plan)).not.toContain("dxb-lune");
    expect(P.buyPlan(sara, { ...tomorrow, outletIds: ["dxb-lune"] }, none).ok).toBe(false);
  });
});

describe("Scenario D: Stage 2 corrections reach purchasing", () => {
  it("logged waste lowers usable stock and raises the suggestion; a corrected pour raises wine requirement", () => {
    const before = lineOf(sara, { ...tomorrow, period: "3" }, "chicken")!;
    const waste = [{ id: "W-1", outletId: "dxb-terrace", date: "2026-10-13", ingredientId: "chicken", qty: 5, reason: "spoilage" as const, by: "TRC-S7", synced: true, seq: 1 }];
    const after = lineOf(sara, { ...tomorrow, period: "3" }, "chicken", { ...none, waste })!;
    expect(before.usable - after.usable).toBeCloseTo(5, 6);
    expect(after.suggested).toBeGreaterThanOrEqual(before.suggested);
    const wine = lineOf(U("u-fnb"), { ...tomorrow, period: "3" }, "wine")!;
    const pour = [{ id: "P1", itemId: "wine", ingredientId: "wine", qty: 0.175, from: "2026-10-01", reason: "Menu", by: "u-fnb", seq: 1 }];
    const wine2 = lineOf(U("u-fnb"), { ...tomorrow, period: "3" }, "wine", { ...none, recipes: pour })!;
    expect(wine2.requirement / wine.requirement).toBeGreaterThan(1.05);
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
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("stops staff, purchasing and authors from approving what is not theirs to approve", async () => {
    const d = P.saveRequest(sara, { ...tomorrow, lines: [{ ingredientId: "chicken", qty: 10 }] });
    if (!d.ok) throw new Error(d.error);
    const id = d.request.id;
    P.actOnRequest(sara, id, { action: "submit" });
    // Staff cannot open purchasing at all.
    expect((await reqRoute.POST(post(`/api/purchasing/${id}`, session("u-emp"), { action: "accounting", decision: "approve" }), params(id))).status).toBe(403);
    // Purchasing cannot do accounting's step; accounting cannot jump purchasing's.
    expect(P.actOnRequest(U("u-buy"), id, { action: "accounting", decision: "approve" }).ok).toBe(false);
    expect(P.actOnRequest(U("u-fc"), id, { action: "purchasing", decision: "approve" }).ok).toBe(false);
    // A manager cannot approve, and the chef cannot see another outlet's draft-free requests unless it is theirs.
    expect(P.actOnRequest(sara, id, { action: "purchasing", decision: "approve" }).ok).toBe(false);
    expect((await buyRoute.POST(post("/api/plan/buy", session("u-rm"), { propertyId: "doh", period: "tomorrow" }))).status).toBe(403);
  });

  it("hides another hotel's requests and other people's drafts", () => {
    const owner = U("u-owner");
    const doha = P.saveRequest(owner, { propertyId: "doh", period: "tomorrow", lines: [{ ingredientId: "lamb", qty: 5 }] });
    if (!doha.ok) throw new Error(doha.error);
    P.actOnRequest(owner, doha.request.id, { action: "submit" });
    expect(P.requestsFor(sara).some((r) => r.id === doha.request.id)).toBe(false);
    expect(P.requestsFor(U("u-gm")).some((r) => r.id === doha.request.id)).toBe(false);
    expect(P.actOnRequest(sara, doha.request.id, { action: "comment", comment: "hello" }).ok).toBe(false);
    const draft = P.saveRequest(sara, { ...tomorrow, lines: [{ ingredientId: "chicken", qty: 3 }] });
    if (!draft.ok) throw new Error(draft.error);
    expect(P.requestsFor(U("u-buy")).some((r) => r.id === draft.request.id)).toBe(false);
  });

  it("sets the unit price from the supplier quote, never from the browser", () => {
    const d = P.saveRequest(sara, { ...tomorrow, lines: [{ ingredientId: "chicken", qty: 10, unitPrice: 0.01 }] });
    if (!d.ok) throw new Error(d.error);
    expect(d.request.lines[0].unitPrice).toBeGreaterThan(1);
  });
});
