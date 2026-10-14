import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-guest-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { loadStore, resetPurchasingStore } = await import("../server/purchasing-store");
const G = await import("../server/guest");
const O = await import("../server/ops");
const { userById } = await import("../data/catalog");
const { estimateReady, HK_RULES } = await import("../domain/guest");

const U = (id: string) => userById[id];
const fo = U("u-fo"), hk = U("u-hk"), maria = U("u-maid"), owner = U("u-owner"), cap = U("u-bellcap"), yusuf = U("u-bell"), omar = U("u-emp");
const ok = <T,>(r: ({ ok: true } & T) | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r; };
const board = () => ok(G.roomsBoard(fo)).board;
const hero = () => board().rooms.find((r) => r.arrival?.vip && r.status === "cleaning" && r.type.toLowerCase().includes("suite"))!;

beforeEach(() => resetPurchasingStore());

describe("room readiness", () => {
  it("predicts the VIP suite late: 50 minutes of cleaning from 6 minutes ago, then inspection, after a 35-minute arrival", () => {
    const r = hero();
    expect(r.estimate.readyAt).toBe(r.startedMin! + HK_RULES.cleanMinutes.suite + HK_RULES.inspectMinutes);
    expect(r.arrival!.risk).toBe("late");
    expect(r.arrival!.delay).toBe(r.estimate.readyAt! - r.arrival!.etaMin);
    expect(r.estimate.steps.join(" ")).toMatch(/Inspection/);
  });

  it("orders a housekeeper's rooms: the one in progress, then priority rooms", () => {
    const s = loadStore().guest;
    const rooms = s.rooms.map((r) => ({ ...r }));
    const [a, b] = rooms.filter((r) => r.status === "vacant_dirty").slice(0, 2);
    a.housekeeperId = b.housekeeperId = "HK-01";
    const before = estimateReady(b, rooms, ["HK-01"], 1260).readyAt!;
    b.priority = true;
    expect(estimateReady(b, rooms, ["HK-01"], 1260).readyAt!).toBeLessThan(before);
  });
});

describe("Scenario A: late room to ready room", () => {
  it("front desk prioritises; housekeeping adds help; cleaning ends in inspection, not ready; inspection releases it", () => {
    const r = hero();
    ok(G.roomAction(fo, r.roomId, { action: "priority", expect: "cleaning" }));
    expect(G.roomAction(fo, r.roomId, { action: "priority" }).ok).toBe(false);
    const late = board().rooms.find((x) => x.roomId === r.roomId)!.estimate.readyAt!;
    const helper = board().housekeepers.find((h) => h.id !== r.housekeeperId)!.id;
    ok(G.roomAction(hk, r.roomId, { action: "helper", housekeeperId: helper }));
    expect(board().rooms.find((x) => x.roomId === r.roomId)!.estimate.readyAt!).toBeLessThan(late);
    // Maria is the assigned housekeeper in the seed; the owner has no frontline actions.
    expect(G.roomAction(owner, r.roomId, { action: "cleaned" }).ok).toBe(false);
    ok(G.roomAction(maria, r.roomId, { action: "cleaned", expect: "cleaning" }));
    expect(board().rooms.find((x) => x.roomId === r.roomId)!.status).toBe("inspection");
    expect(G.roomAction(maria, r.roomId, { action: "inspect" }).ok).toBe(false);
    ok(G.roomAction(hk, r.roomId, { action: "inspect", pass: true }));
    const done = board().rooms.find((x) => x.roomId === r.roomId)!;
    expect(done.status).toBe("ready");
    expect(done.arrival!.risk).toBe("ready");
    expect(done.priority).toBe(false);
    expect(loadStore().guest.log.some((e) => e.ref === r.number && e.kind === "room" && !e.seeded)).toBe(true);
  });

  it("refuses a step on a room someone else already changed", () => {
    const r = hero();
    ok(G.roomAction(maria, r.roomId, { action: "cleaned", expect: "cleaning" }));
    const again = G.roomAction(hk, r.roomId, { action: "cleaned", expect: "cleaning" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.status).toBe(409);
  });

  it("a housekeeper sees and works only their own rooms", () => {
    const mine = ok(G.roomsBoard(maria)).board;
    expect(mine.mine).toBe(true);
    expect(mine.rooms.every((r) => r.housekeeperId === "HK-01" || r.helperId === "HK-01")).toBe(true);
    const other = board().rooms.find((r) => r.status === "vacant_dirty" && r.housekeeperId && r.housekeeperId !== "HK-01")!;
    expect(G.roomAction(maria, other.roomId, { action: "start" }).ok).toBe(false);
    expect(G.roomsBoard(omar).ok).toBe(true); // staff may open, but see nothing that is not theirs
    expect(ok(G.roomsBoard(omar)).board.rooms).toHaveLength(0);
  });

  it("counts staff borrowed through Staff Support only once approved", () => {
    const now = G.demoNow();
    const before = board().housekeepers.length;
    const found = ok(O.findCandidates(hk, { propertyId: "dxb", skill: "cleaning", date: "2026-10-13", start: now, end: 23 * 60, toDeptId: "dxb-hk" }));
    const req = ok(O.createSupport(hk, { propertyId: "dxb", toDeptId: "dxb-hk", skill: "cleaning", count: 1, employeeIds: [found.candidates[0].employeeId], reason: "Arrivals tonight", date: "2026-10-13", start: now, end: 23 * 60 })).request;
    expect(board().housekeepers.length).toBe(before);
    const lender = Object.values(userById).find((u) => O.managesDept(u, req.items[0].deptId) && u.role !== "owner")!;
    ok(O.decideItem(lender, req.id, req.items[0].id, { decision: "approve" }));
    expect(board().housekeepers.some((h) => h.borrowed)).toBe(true);
  });
});

describe("Scenario C: luggage delivery", () => {
  it("runs requested to completed in order, records the handover, and measures the time", () => {
    const room = board().rooms.find((r) => r.occupancy === "occupied")!.number;
    const t = ok(G.createBell(fo, { kind: "delivery", room, bags: 2 })).task;
    expect(G.createBell(fo, { kind: "delivery", room, bags: 2 }).ok).toBe(false); // double tap
    expect(G.bellAction(yusuf, t.id, { action: "on_the_way" }).ok).toBe(false); // not assigned yet
    ok(G.bellAction(cap, t.id, { action: "assign", assigneeId: "BELL-01" }));
    expect(G.bellAction(U("u-maid"), t.id, { action: "on_the_way" }).ok).toBe(false);
    expect(G.bellAction(yusuf, t.id, { action: "collected" }).ok).toBe(false); // out of order
    ok(G.bellAction(yusuf, t.id, { action: "on_the_way" }));
    ok(G.bellAction(yusuf, t.id, { action: "collected" }));
    expect(G.bellAction(cap, t.id, { action: "assign", assigneeId: "BELL-02" }).ok).toBe(false); // bags already with Yusuf
    expect(G.bellAction(yusuf, t.id, { action: "delivered" }).ok).toBe(false); // handover needed
    ok(G.bellAction(yusuf, t.id, { action: "delivered", handover: "Handed to the guest in the lobby" }));
    ok(G.bellAction(yusuf, t.id, { action: "complete" }));
    const seen = ok(G.bellBoard(fo)).tasks.find((x) => x.id === t.id)!;
    expect(seen.status).toBe("completed");
    expect(seen.handover).toBe("Handed to the guest in the lobby");
    expect(loadStore().guest.log.some((e) => e.ref === t.id && e.kind === "bell")).toBe(true);
    // Yusuf sees only his own tasks.
    expect(ok(G.bellBoard(yusuf)).tasks.every((x) => x.assigneeId === "BELL-01")).toBe(true);
  });
});
