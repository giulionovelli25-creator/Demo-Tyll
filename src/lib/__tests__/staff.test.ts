import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-staff-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { loadStore, resetPurchasingStore } = await import("../server/purchasing-store");
const L = await import("../server/stock-log");
const P = await import("../server/purchasing");
const G = await import("../server/guest");
const { stockFor, cleanEntries } = await import("../server/stock");
const { userById } = await import("../data/catalog");
const { staffActions } = await import("../../components/staff/staff-app");

const U = (id: string) => userById[id];
const omar = U("u-emp"), sara = U("u-rm"), karim = U("u-lby"), ravi = U("u-cook"), chef = U("u-chef"), store = U("u-store"), maria = U("u-maid"), yusuf = U("u-bell"), owner = U("u-owner"), fo = U("u-fo"), hk = U("u-hk");
const ok = <T,>(r: ({ ok: true } & T) | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r; };
const status = (r: { ok: boolean }) => (r.ok ? 200 : (r as unknown as { status: number }).status);
const stockOf = (u: typeof sara, id: string) => stockFor(u, "dxb", cleanEntries(u, {})).find((r) => r.ingredientId === id)!.estimated;

beforeEach(() => resetPurchasingStore());

describe("Scenario C: waste logged on a phone reaches the manager", () => {
  it("saves once on the server, lowers stock for the manager, and records who and when", () => {
    const before = stockOf(sara, "wineglass");
    const e = ok(L.logWasteShared(omar, { outletId: "dxb-terrace", ingredientId: "wineglass", qty: 3, reason: "breakage", note: "Dropped tray", clientId: "W-USER-7" })).entry;
    expect(e.byUser).toBe("u-emp");
    expect(e.at).toMatch(/T/);
    // The same entry sent again (a retry, or the browser's own copy) is not counted twice.
    ok(L.logWasteShared(omar, { outletId: "dxb-terrace", ingredientId: "wineglass", qty: 3, reason: "breakage", clientId: "W-USER-7" }));
    expect(loadStore().stockLog.waste).toHaveLength(1);
    const local = { id: "W-USER-7", outletId: "dxb-terrace", ingredientId: "wineglass", qty: 3, reason: "breakage", date: "2026-10-13", by: "TRC-S9", synced: true, seq: 7 };
    expect(cleanEntries(omar, { waste: [local] }).waste).toHaveLength(0);
    expect(stockOf(sara, "wineglass")).toBeCloseTo(before - 3, 6);
    expect(L.sharedFor(sara).waste.map((w) => w.id)).toContain(e.id);
    expect(L.sharedFor(karim).waste).toHaveLength(0); // another outlet's manager
    // Corrected, never deleted.
    ok(L.correctWasteShared(sara, e.id, { qty: 2, reason: "Two glasses, not three" }));
    expect(stockOf(sara, "wineglass")).toBeCloseTo(before - 2, 6);
    expect(loadStore().stockLog.waste[0].qty).toBe(3);
  });

  it("refuses waste for outlets and roles that may not log it", () => {
    expect(status(L.logWasteShared(omar, { outletId: "dxb-lobby", ingredientId: "coke", qty: 1, reason: "waste" }))).toBe(403);
    expect(status(L.logWasteShared(store, { outletId: "dxb-terrace", ingredientId: "coke", qty: 1, reason: "waste" }))).toBe(403);
    expect(status(L.logWasteShared(omar, { outletId: "dxb-terrace", ingredientId: "coke", qty: 0, reason: "waste" }))).toBe(400);
    const e = ok(L.logWasteShared(sara, { outletId: "dxb-terrace", ingredientId: "coke", qty: 2, reason: "waste" })).entry;
    expect(status(L.correctWasteShared(omar, e.id, { qty: 0, reason: "not mine" }))).toBe(403);
  });
});

describe("counts from staff wait for a manager", () => {
  it("does not change stock until accepted, keeps both figures, and blocks self-review", () => {
    const before = stockOf(sara, "coke");
    const c = ok(L.submitCount(store, { propertyId: "dxb", ingredientId: "coke", counted: 10 }, () => before)).count;
    expect(c.status).toBe("submitted");
    expect(stockOf(sara, "coke")).toBeCloseTo(before, 6);
    expect(status(L.reviewCount(store, c.id, { decision: "accept" }))).toBe(403);
    expect(status(L.reviewCount(omar, c.id, { decision: "accept" }))).toBe(403);
    expect(status(L.reviewCount(sara, c.id, { decision: "reject" }))).toBe(400);
    ok(L.reviewCount(sara, c.id, { decision: "accept" }));
    expect(stockOf(sara, "coke")).toBeCloseTo(10, 6);
    const saved = loadStore().stockLog.counts[0];
    expect(saved.expected).toBeCloseTo(before, 2);
    expect(saved.reviewedBy).toBe("u-rm");
    expect(status(L.reviewCount(sara, c.id, { decision: "accept" }))).toBe(409);
    expect(status(L.submitCount(omar, { propertyId: "doh", ingredientId: "coke", counted: 1 }, () => 1))).toBe(403);
  });
});

describe("Scenario D: kitchen task from chef to phone and back", () => {
  it("lets only the assigned cook start, report and complete it, and the chef sees each step", () => {
    const plan = ok(P.savePrepPlan(chef, { outletId: "dxb-terrace", propertyId: "dxb", period: "tomorrow", meal: "all", portions: { burger: 45 } })).plan;
    const task = plan.tasks.find((t) => t.itemId === "burger")!;
    expect(status(P.updatePrepTask(ravi, { planId: plan.id, taskId: task.id, op: "complete" }))).toBe(403); // not assigned yet
    expect(status(P.updatePrepTask(ravi, { planId: plan.id, taskId: task.id, op: "assign", assigneeId: "u-cook" }))).toBe(403);
    ok(P.updatePrepTask(chef, { planId: plan.id, taskId: task.id, op: "assign", assigneeId: "u-cook" }));
    expect(status(P.updatePrepTask(omar, { planId: plan.id, taskId: task.id, op: "complete" }))).toBe(403);
    ok(P.updatePrepTask(ravi, { planId: plan.id, taskId: task.id, op: "start" }));
    ok(P.updatePrepTask(ravi, { planId: plan.id, taskId: task.id, op: "report", note: "Only 30 buns in the store" }));
    ok(P.updatePrepTask(ravi, { planId: plan.id, taskId: task.id, op: "complete", done: true }));
    const seen = P.plansFor(chef).find((p) => p.id === plan.id)!.tasks.find((t) => t.id === task.id)!;
    expect(seen.done).toBe(true);
    expect(seen.doneBy).toBe("u-cook");
    expect(seen.startedAt).toBeTruthy();
    expect(seen.issue?.note).toMatch(/30 buns/);
  });
});

describe("Scenario E: room cleaned from a phone, seen by the front office", () => {
  it("goes to inspection, then ready, on the same record", () => {
    const room = ok(G.roomsBoard(maria)).board.rooms.find((r) => ["vacant_dirty", "cleaning"].includes(r.status) && r.housekeeperId === "HK-01")!;
    expect(room).toBeTruthy();
    if (room.status === "vacant_dirty") ok(G.roomAction(maria, room.roomId, { action: "start" }));
    ok(G.roomAction(maria, room.roomId, { action: "cleaned" }));
    expect(ok(G.roomsBoard(fo)).board.rooms.find((r) => r.roomId === room.roomId)!.status).toBe("inspection");
    ok(G.roomAction(hk, room.roomId, { action: "inspect", pass: true }));
    expect(ok(G.roomsBoard(fo)).board.rooms.find((r) => r.roomId === room.roomId)!.status).toBe("ready");
  });
});

describe("staff quick actions follow the job", () => {
  it("gives each role only its own actions", () => {
    const ids = (u: typeof omar) => staffActions(u).map((a) => a.id);
    expect(ids(maria)).toEqual(["rooms"]);
    expect(ids(yusuf)).toEqual(["bell"]);
    expect(ids(store)).toEqual(["count", "receive"]);
    expect(ids(ravi)).toEqual(expect.arrayContaining(["waste", "breakage", "prep"]));
    expect(ids(ravi)).not.toContain("receive");
    expect(ids(owner)).not.toContain("rooms");
  });
});
