import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-gs-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { loadStore, resetPurchasingStore } = await import("../server/purchasing-store");
const S = await import("../server/guest-service");
const { cleanEntries } = await import("../server/stock");
const P = await import("../server/purchasing");
const { userById } = await import("../data/catalog");
const { venueById, bookedSeats, slotOf } = await import("../domain/guest");
const { roomsTabs } = await import("../../components/guest/tabs");
const { DEMO_TODAY } = await import("../util");

const U = (id: string) => userById[id];
const fo = U("u-fo"), con = U("u-con"), sara = U("u-rm"), karim = U("u-lby"), hk = U("u-hk"), owner = U("u-owner"), gm = U("u-gm"), maria = U("u-maid"), buyer = U("u-buy"), fc = U("u-fc");
const ok = <T,>(r: ({ ok: true } & T) | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r; };
const err = (r: { ok: boolean; status?: number }) => { expect(r.ok).toBe(false); return (r as { status: number }).status; };
const room = () => loadStore().guest.rooms[0].number;
const T2130 = 21 * 60 + 30;

beforeEach(() => resetPurchasingStore());

describe("Scenario B: Guest Connect dinner for two", () => {
  it("is never confirmed before the outlet accepts; accept, then confirm with the guest", () => {
    const venues = ok(S.venuesFor(fo, { kind: "restaurant", party: 2, timeMin: T2130 })).venues;
    expect(venues.map((v) => v.id)).toContain("dxb-terrace");
    const r = ok(S.createGc(fo, { venueId: "dxb-terrace", party: 2, timeMin: T2130, room: room() })).request;
    expect(r.status).toBe("pending");
    expect(err(S.createGc(fo, { venueId: "dxb-terrace", party: 2, timeMin: T2130, room: room() }))).toBe(409); // duplicate
    expect(err(S.gcAction(fo, r.id, { action: "confirm" }))).toBe(409); // not accepted yet
    expect(err(S.gcAction(karim, r.id, { action: "accept" }))).toBe(403); // another outlet's manager
    expect(err(S.gcAction(owner, r.id, { action: "accept" }))).toBe(403);
    ok(S.gcAction(sara, r.id, { action: "accept" }));
    expect(err(S.gcAction(sara, r.id, { action: "accept" }))).toBe(409);
    const done = ok(S.gcAction(fo, r.id, { action: "confirm" })).request;
    expect(done.status).toBe("confirmed");
    expect(loadStore().guest.log.some((e) => e.kind === "gc" && e.ref === r.id && e.confirmed)).toBe(true);
  });

  it("decline needs a reason; an alternative must be accepted by the requester before confirming", () => {
    const r = ok(S.createGc(con, { venueId: "dxb-terrace", party: 2, timeMin: T2130, room: room() })).request;
    expect(err(S.gcAction(sara, r.id, { action: "decline" }))).toBe(400);
    ok(S.gcAction(sara, r.id, { action: "alternative", timeMin: 22 * 60 }));
    expect(err(S.gcAction(con, r.id, { action: "confirm" }))).toBe(409);
    ok(S.gcAction(con, r.id, { action: "accept_alternative" }));
    const c = ok(S.gcAction(con, r.id, { action: "confirm" })).request;
    expect(c.timeMin).toBe(22 * 60);
    const d = ok(S.createGc(con, { venueId: "dxb-terrace", party: 2, timeMin: 22 * 60 + 30, room: room() })).request;
    expect(ok(S.gcAction(sara, d.id, { action: "decline", note: "Private event on the terrace" })).request.status).toBe("declined");
  });

  it("keeps capacity consistent: accepted seats count, pending ones do not; changes and cancellations release seats", () => {
    const v = venueById["dxb-lune"];
    const free = v.capacity! - bookedSeats(v.id, DEMO_TODAY, slotOf(T2130));
    const big = ok(S.createGc(fo, { venueId: v.id, party: free, timeMin: T2130, room: room() })).request;
    const small = ok(S.createGc(con, { venueId: v.id, party: 1, timeMin: T2130, room: loadStore().guest.rooms[1].number })).request;
    ok(S.gcAction(U("u-fnb"), big.id, { action: "accept" }));
    expect(err(S.gcAction(U("u-fnb"), small.id, { action: "accept" }))).toBe(409); // full now
    ok(S.gcAction(fo, big.id, { action: "change", party: free - 1 }));
    expect(loadStore().guest.gc.find((x) => x.id === big.id)!.status).toBe("pending"); // back to the venue
    ok(S.gcAction(U("u-fnb"), small.id, { action: "accept" }));
    expect(err(S.gcAction(fo, big.id, { action: "cancel" }))).toBe(400); // needs a reason
    ok(S.gcAction(fo, big.id, { action: "cancel", note: "Guest changed plans" }));
  });

  it("refuses roles outside the front office and concierge", () => {
    expect(err(S.createGc(maria, { venueId: "dxb-terrace", party: 2, timeMin: T2130, room: room() }))).toBe(403);
    expect(err(S.createGc(hk, { venueId: "dxb-terrace", party: 2, timeMin: T2130, room: room() }))).toBe(403);
    expect(err(S.venuesFor(owner, { kind: "restaurant" }))).toBe(403);
  });
});

describe("guest requests", () => {
  it("a taxi is confirmed only with a recorded confirmation, labelled simulated", () => {
    const r = ok(S.createRequest(con, { kind: "taxi", room: room(), details: "Airport, 2 bags" })).request;
    expect(err(S.createRequest(con, { kind: "taxi", room: room(), details: "Airport, 2 bags" }))).toBe(409);
    ok(S.requestAction(con, r.id, { action: "assign" }));
    ok(S.requestAction(con, r.id, { action: "awaiting" }));
    expect(err(S.requestAction(con, r.id, { action: "confirm" }))).toBe(400);
    const c = ok(S.requestAction(con, r.id, { action: "confirm", note: "Dubai Taxi ref 48213" })).request;
    expect(c.status).toBe("confirmed");
    expect(c.confirmation).toMatch(/simulated/);
    expect(ok(S.requestAction(con, r.id, { action: "complete" })).request.status).toBe("completed");
    expect(err(S.requestAction(maria, r.id, { action: "cancel", note: "x" }))).toBe(403);
  });

  it("a restaurant request is confirmed through Guest Connect, not directly", () => {
    const r = ok(S.createRequest(con, { kind: "restaurant", room: room(), details: "Dinner for two" })).request;
    expect(err(S.requestAction(con, r.id, { action: "confirm", note: "said yes" }))).toBe(409);
    const g = ok(S.createGc(con, { venueId: "dxb-terrace", party: 2, timeMin: T2130, room: room(), sourceRequestId: r.id })).request;
    expect(loadStore().guest.requests.find((x) => x.id === r.id)!.status).toBe("awaiting_confirmation");
    ok(S.gcAction(sara, g.id, { action: "accept" }));
    expect(loadStore().guest.requests.find((x) => x.id === r.id)!.status).toBe("awaiting_confirmation");
    ok(S.gcAction(con, g.id, { action: "confirm" }));
    expect(loadStore().guest.requests.find((x) => x.id === r.id)!.status).toBe("confirmed");
  });
});

describe("Scenario D: housekeeping supplies through purchasing", () => {
  it("drafts once, goes through approvals, and receiving raises stock", () => {
    const before = ok(S.suppliesFor(hk, cleanEntries(hk, {}))).supplies;
    const short = before.filter((s) => s.needed > 0);
    expect(short.length).toBeGreaterThan(0);
    const lines = short.map((s) => ({ ingredientId: s.ingredientId, qty: s.needed }));
    const r = ok(P.saveRequest(hk, { propertyId: "dxb", deptId: "dxb-hk", period: "3", lines })).request;
    expect(err(P.saveRequest(hk, { propertyId: "dxb", deptId: "dxb-hk", period: "3", lines }))).toBe(409);
    expect(err(P.saveRequest(fo, { propertyId: "dxb", deptId: "dxb-hk", lines }))).toBe(403);
    expect(ok(S.suppliesFor(hk, cleanEntries(hk, {}))).supplies.find((s) => s.ingredientId === short[0].ingredientId)!.openRequest?.id).toBe(r.id);
    ok(P.actOnRequest(hk, r.id, { action: "submit" }));
    for (let i = 0; i < 4 && !["approved"].includes(loadStore().requests.find((x) => x.id === r.id)!.status); i++) {
      const st = loadStore().requests.find((x) => x.id === r.id)!.status;
      ok(P.actOnRequest(st === "purchasing" ? buyer : st === "accounting" ? fc : gm, r.id, { action: st, decision: "approve" }));
    }
    const approved = loadStore().requests.find((x) => x.id === r.id)!;
    expect(approved.status).toBe("approved");
    expect(approved.poNumber).toBeTruthy();
    ok(P.actOnRequest(buyer, r.id, { action: "receive" }));
    const after = ok(S.suppliesFor(hk, cleanEntries(hk, {}))).supplies.find((s) => s.ingredientId === short[0].ingredientId)!;
    expect(after.onHand).toBeGreaterThan(short[0].onHand);
    expect(after.openRequest).toBeUndefined();
    expect(err(S.suppliesFor(fo, cleanEntries(fo, {})))).toBe(403);
  });
});

describe("navigation and overview", () => {
  it("each role sees its own sections; the owner sees no operational buttons", () => {
    expect(roomsTabs(owner)).toEqual(["readiness", "service"]);
    expect(roomsTabs(sara)).toEqual(["tables"]);
    expect(roomsTabs(fo)).toEqual(expect.arrayContaining(["readiness", "requests", "connect", "bell"]));
    expect(roomsTabs(hk)).toEqual(["readiness", "housekeeping"]);
    expect(roomsTabs(con)).toEqual(expect.arrayContaining(["requests", "connect"]));
    expect(roomsTabs(con)).not.toContain("service");
    expect(S.guestAlerts(owner).length).toBeLessThanOrEqual(1);
  });

  it("the outlet gets a notice for a new table request; service figures come from recorded times", () => {
    ok(S.createGc(fo, { venueId: "dxb-terrace", party: 2, timeMin: T2130, room: room() }));
    expect(S.guestAlerts(sara).some((a) => a.href === "/rooms?tab=tables")).toBe(true);
    expect(S.guestAlerts(karim).some((a) => a.href === "/rooms?tab=tables")).toBe(false);
    const s = ok(S.serviceSummary(owner)).summary;
    expect(s.open.pendingGc).toBe(1);
    expect(err(S.serviceSummary(maria))).toBe(403);
  });
});
