import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-sales-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { loadStore, resetPurchasingStore } = await import("../server/purchasing-store");
const S = await import("../server/sales");
const O = await import("../server/ops");
const P = await import("../server/purchasing");
const { cleanEntries } = await import("../server/stock");
const { userById } = await import("../data/catalog");
const { isCommitted } = await import("../domain/events");
const { addDays, DEMO_TODAY } = await import("../util");

const U = (id: string) => userById[id];
const noor = U("u-sales"), daniel = U("u-dos"), mariam = U("u-sales-doh"), yasmin = U("u-events"), owner = U("u-owner"), omar = U("u-emp"), gm = U("u-gm"), chef = U("u-chef");
const ok = <T,>(r: ({ ok: true } & T) | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r; };
const status = (r: { ok: boolean }) => (r.ok ? 200 : (r as unknown as { status: number }).status);
const date = addDays(DEMO_TODAY, 21);

beforeEach(() => resetPurchasingStore());

const conference = () => ok(S.saveOpp(noor, { propertyId: "dxb", type: "Conference", customer: "Meridian Pharma", expectedDate: date, guests: 120, value: 90000, nextAction: "Send proposal" })).opp;
const proposal = (oppId: string, extra: Record<string, unknown> = {}) => ok(S.saveProposal(noor, { oppId, date, start: 9 * 60, end: 17 * 60, guests: 120, format: "buffet", services: ["coffee_break", "lunch_buffet", "soft_drinks"], pricePerGuest: 450, ...extra })).proposal;

describe("Scenario B: opportunity to event", () => {
  it("creates one event, only after acceptance and confirmation, with the menu and guests carried over", () => {
    const events = () => loadStore().events.length;
    const start = events();
    const o = conference();
    const p = proposal(o.id);
    expect(p.status).toBe("ready");
    const costed = ok(S.salesFor(noor, "dxb")).opps.find((x) => x.id === o.id)!.proposals[0].costing;
    expect(costed.price).toBe(54000);
    expect(costed.directCost).toBeGreaterThan(0);
    expect(costed.contribution).toBeCloseTo(costed.price - costed.directCost, 2);
    // Saving, sending and even accepting creates nothing in Events.
    expect(status(S.proposalAction(noor, p.id, { action: "confirm" }))).toBe(409);
    ok(S.proposalAction(noor, p.id, { action: "mark_sent" }));
    expect(status(S.proposalAction(noor, p.id, { action: "record_acceptance", note: "" }))).toBe(400);
    ok(S.proposalAction(noor, p.id, { action: "record_acceptance", note: "Signed proposal received on 14 October" }));
    expect(events()).toBe(start);
    const done = ok(S.proposalAction(noor, p.id, { action: "confirm" }));
    expect(events()).toBe(start + 1);
    const e = loadStore().events.find((x) => x.id === done.eventId)!;
    expect(e.guests).toBe(120);
    expect(e.services.map((x) => x.id)).toEqual(["coffee_break", "lunch_buffet", "soft_drinks"]);
    expect(e.opportunityId).toBe(o.id);
    expect(e.proposalId).toBe(p.id);
    expect(isCommitted(e)).toBe(true);
    // Confirming again does not create a second event.
    expect(status(S.proposalAction(noor, p.id, { action: "confirm" }))).toBe(409);
    expect(events()).toBe(start + 1);
    // Operations sees it and can work out what to buy; Sales sees its status.
    expect(O.eventsFor(yasmin).some((x) => x.id === e.id)).toBe(true);
    expect(ok(O.eventDetail(yasmin, e.id, cleanEntries(yasmin, {}))).detail).toBeTruthy();
    expect(P.buyPlanForEvent(yasmin, e, cleanEntries(yasmin, {})).length).toBeGreaterThan(0);
    const mine = ok(S.salesFor(noor, "dxb")).opps.find((x) => x.id === o.id)!;
    expect(mine.status).toBe("confirmed");
    expect(mine.event?.id).toBe(e.id);
  });

  it("updates the linked event instead of creating another", () => {
    const linked = loadStore().events.find((e) => e.id === "EVT-DXB-0001")!;
    const p = ok(S.saveProposal(daniel, { oppId: "OPP-DXB-0004", date: linked.date, start: linked.start, end: linked.end, guests: 150, format: "seated", services: ["set_menu", "soft_drinks"], pricePerGuest: 320 })).proposal;
    expect(status(S.saveProposal(daniel, { oppId: "OPP-DXB-0005", date, pricePerGuest: 100, services: ["wine"] }))).toBe(409); // lost
    const count = loadStore().events.length;
    ok(S.proposalAction(daniel, p.id, { action: "mark_sent" }));
    ok(S.proposalAction(daniel, p.id, { action: "record_acceptance", note: "Client confirmed 150 by signed amendment" }));
    const done = ok(S.proposalAction(daniel, p.id, { action: "confirm" }));
    expect(done.eventId).toBe("EVT-DXB-0001");
    expect(loadStore().events.length).toBe(count);
    const e = loadStore().events.find((x) => x.id === "EVT-DXB-0001")!;
    expect(e.guests).toBe(150);
    expect(e.history.at(-1)!.action).toMatch(/confirmed sales proposal/);
    expect(e.issued.length).toBe(linked.issued.length); // stock already issued is kept
  });
});

describe("discounts and permissions", () => {
  it("sends a discount above the limit for approval, and the creator cannot approve it", () => {
    const o = conference();
    const p = proposal(o.id, { discountPct: 15 });
    expect(p.status).toBe("discount_pending");
    expect(status(S.proposalAction(noor, p.id, { action: "mark_sent" }))).toBe(409);
    expect(status(S.proposalAction(noor, p.id, { action: "approve" }))).toBe(403);
    expect(status(S.proposalAction(daniel, p.id, { action: "reject" }))).toBe(400);
    ok(S.proposalAction(daniel, p.id, { action: "changes", note: "Ten percent at most for this date" }));
    expect(loadStore().sales.proposals.find((x) => x.id === p.id)!.status).toBe("changes_requested");
    const again = ok(S.saveProposal(noor, { id: p.id, discountPct: 10 })).proposal;
    expect(again.status).toBe("ready");
    const big = proposal(o.id, { discountPct: 20 });
    expect(loadStore().sales.proposals.find((x) => x.id === again.id)!.status).toBe("superseded");
    ok(S.proposalAction(gm, big.id, { action: "approve" }));
    expect(loadStore().sales.proposals.find((x) => x.id === big.id)!.approval?.by).toBe("u-gm");
  });

  it("keeps each hotel's pipeline to its own sales team, and staff out", () => {
    expect(ok(S.salesFor(mariam)).opps.every((o) => o.propertyId === "doh")).toBe(true);
    expect(ok(S.salesFor(noor)).opps.every((o) => o.propertyId === "dxb")).toBe(true);
    expect(status(S.saveOpp(mariam, { id: "OPP-DXB-0001", status: "contacted" }))).toBe(404);
    expect(status(S.saveOpp(noor, { propertyId: "doh", type: "Wedding", customer: "X", expectedDate: date, guests: 10 }))).toBe(403);
    expect(status(S.salesFor(omar))).toBe(403);
    expect(status(S.saveOpp(owner, { id: "OPP-DXB-0001", status: "contacted" }))).toBe(403);
    expect(status(S.saveOpp(noor, { id: "OPP-DXB-0001", status: "confirmed" }))).toBe(409);
    expect(status(S.saveOpp(noor, { id: "OPP-DXB-0001", status: "lost" }))).toBe(400);
    expect(O.eventsFor(chef).some((e) => e.opportunityId)).toBe(false);
  });

  it("reports pipeline, pending and confirmed value separately", () => {
    const perf = ok(S.salesPerformance(noor, "dxb")).performance;
    expect(perf.currency).toBe("AED");
    expect(perf.pipeline).toBe(64000 + 210000 + 36000);
    expect(perf.awaitingDecision).toBe(1);
    expect(perf.confirmedValue).toBe(57600);
    expect(perf.lost).toBe(1);
    expect(status(S.salesPerformance(noor, "doh"))).toBe(403);
  });
});
