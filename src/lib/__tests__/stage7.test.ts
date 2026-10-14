import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-s7-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { loadStore, resetPurchasingStore } = await import("../server/purchasing-store");
const N = await import("../server/notify");
const P = await import("../server/purchasing");
const S = await import("../server/search");
const D = await import("../server/demo");
const GS = await import("../server/guest-service");
const L = await import("../server/stock-log");
const O = await import("../server/ops");
const { userById } = await import("../data/catalog");

const U = (id: string) => userById[id];
const sara = U("u-rm"), nadia = U("u-buy"), priya = U("u-fc"), elena = U("u-acc-doh"), omar = U("u-emp"), owner = U("u-owner"), gm = U("u-gm"), fo = U("u-fo"), mariam = U("u-sales-doh"), noor = U("u-sales");
const ok = <T,>(r: ({ ok: true } & T) | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r; };
const inbox = (u: typeof sara) => N.noticesFor(u).notices.filter((n) => !n.resolved);

beforeEach(() => resetPurchasingStore());

describe("notifications follow the purchase request", () => {
  it("tells purchasing, then accounting, then the requester, and resolves each step", () => {
    const r = ok(P.saveRequest(sara, { propertyId: "dxb", period: "tomorrow", lines: [{ ingredientId: "chicken", qty: 10 }] })).request;
    expect(inbox(nadia)).toHaveLength(0); // drafts are private
    ok(P.actOnRequest(sara, r.id, { action: "submit" }));
    const n1 = inbox(nadia).find((n) => n.ref === r.id)!;
    expect(n1.title).toMatch(/purchasing review/);
    expect(n1.href).toContain(r.id);
    expect(inbox(priya).some((n) => n.ref === r.id)).toBe(false);
    ok(P.actOnRequest(nadia, r.id, { action: "purchasing", decision: "approve" }));
    expect(inbox(nadia).some((n) => n.ref === r.id)).toBe(false);
    expect(inbox(priya).find((n) => n.ref === r.id)!.href).toContain("/finance");
    expect(inbox(elena).some((n) => n.ref === r.id)).toBe(false); // Doha accountant: another hotel
    ok(P.actOnRequest(priya, r.id, { action: "accounting", decision: "approve" }));
    const done = inbox(sara).find((n) => n.ref === r.id)!;
    expect(done.title).toMatch(/approved as PO-/);
    expect(inbox(owner).length).toBe(0); // the owner is not sent routine handoffs
    // Emails are prepared, never claimed as sent without a provider; one per handoff.
    const emails = loadStore().notify.emails.filter((e) => e.text.includes(r.id));
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((e) => e.status === "logged")).toBe(true);
    expect(new Set(emails.map((e) => e.key)).size).toBe(emails.length);
    N.markRead(sara, {});
    expect(N.noticesFor(sara).unread).toBe(0);
  });

  it("tells the venue about a table request and the front desk about its answer", () => {
    const g = ok(GS.createGc(fo, { venueId: "dxb-terrace", party: 2, timeMin: 22 * 60 + 30, room: loadStore().guest.rooms[0].number })).request;
    expect(inbox(sara).some((n) => n.ref === g.id && n.type === "gc-request")).toBe(true);
    expect(inbox(U("u-lby")).some((n) => n.ref === g.id)).toBe(false);
    ok(GS.gcAction(sara, g.id, { action: "accept" }));
    expect(inbox(sara).some((n) => n.ref === g.id)).toBe(false);
    expect(inbox(fo).some((n) => n.ref === g.id && n.type === "gc-answer")).toBe(true);
  });

  it("tells reviewers about a staff count and lending managers about a support request", () => {
    ok(L.submitCount(U("u-store"), { propertyId: "dxb", ingredientId: "coke", counted: 3 }, () => 5));
    expect(inbox(sara).some((n) => n.type === "count-review") || inbox(nadia).some((n) => n.type === "count-review")).toBe(true);
    const found = ok(O.findCandidates(U("u-hk"), { propertyId: "dxb", skill: "cleaning", date: "2026-10-13", start: 21 * 60, end: 23 * 60, toDeptId: "dxb-hk" }));
    const req = ok(O.createSupport(U("u-hk"), { propertyId: "dxb", toDeptId: "dxb-hk", skill: "cleaning", count: 1, employeeIds: [found.candidates[0].employeeId], reason: "Arrivals", date: "2026-10-13", start: 21 * 60, end: 23 * 60 })).request;
    const lenders = Object.values(userById).filter((u) => inbox(u).some((n) => n.ref === req.id && n.type === "support-ask"));
    expect(lenders.length).toBeGreaterThan(0);
    ok(O.decideItem(lenders[0], req.id, req.items[0].id, { decision: "approve" }));
    expect(inbox(U("u-hk")).some((n) => n.ref === req.id && n.type === "support-answer")).toBe(true);
  });
});

describe("search stays inside each person's access", () => {
  it("finds records with partial words and small typos, only where the person may open them", () => {
    const r = ok(P.saveRequest(sara, { propertyId: "dxb", period: "tomorrow", lines: [{ ingredientId: "chicken", qty: 10 }] })).request;
    ok(P.actOnRequest(sara, r.id, { action: "submit" }));
    expect(S.searchFor(nadia, r.id).some((h) => h.href.includes(r.id))).toBe(true);
    expect(S.searchFor(sara, "coca").some((h) => h.group === "Stock checks")).toBe(true);
    expect(S.searchFor(sara, "Coca-Colla").some((h) => h.group === "Stock checks")).toBe(true); // typo
    expect(S.searchFor(fo, "1211").some((h) => h.group === "Rooms")).toBe(true);
    expect(S.searchFor(omar, r.id)).toHaveLength(0); // staff cannot open purchasing
    expect(S.searchFor(omar, "invoice").some((h) => h.group === "Invoices")).toBe(false);
    expect(S.searchFor(elena, "MEAT-1011").some((h) => h.href.includes("DXB"))).toBe(false); // Dubai invoice, Doha accountant
    expect(S.searchFor(elena, "MEAT-1011").some((h) => h.href.includes("DOH"))).toBe(true);
    expect(S.searchFor(priya, "MEAT-1011").some((h) => h.group === "Invoices")).toBe(true);
    expect(S.searchFor(mariam, "Atlas").some((h) => h.group === "Sales")).toBe(false); // Dubai opportunity
    expect(S.searchFor(noor, "Atlas").some((h) => h.group === "Sales")).toBe(true);
    expect(S.searchFor(sara, "guest connect").some((h) => h.group === "Features")).toBe(false); // not her job
    expect(S.searchFor(fo, "guest connect").some((h) => h.group === "Features")).toBe(true);
  });
});

describe("demo reset", () => {
  it("is limited to the owner and general manager, and puts one story back without touching others", () => {
    const r = ok(P.saveRequest(sara, { propertyId: "dxb", period: "tomorrow", lines: [{ ingredientId: "chicken", qty: 10 }] })).request;
    ok(L.logWasteShared(omar, { outletId: "dxb-terrace", ingredientId: "coke", qty: 2, reason: "waste" }));
    for (const u of [sara, nadia, priya, omar]) expect(D.resetDemo(u, "purchasing").ok).toBe(false);
    expect(D.resetDemo(gm, "nonsense").ok).toBe(false);
    ok(D.resetDemo(gm, "purchasing"));
    expect(loadStore().requests.find((x) => x.id === r.id)).toBeUndefined();
    expect(loadStore().stockLog.waste).toHaveLength(1); // stock story untouched
    ok(D.resetDemo(owner, "stock"));
    expect(loadStore().stockLog.waste).toHaveLength(0);
    // A fresh request after reset starts cleanly and is not a duplicate.
    const again = ok(P.saveRequest(sara, { propertyId: "dxb", period: "tomorrow", lines: [{ ingredientId: "chicken", qty: 10 }] })).request;
    expect(loadStore().requests).toHaveLength(1);
    expect(again.id).toBe(r.id);
  });
});
