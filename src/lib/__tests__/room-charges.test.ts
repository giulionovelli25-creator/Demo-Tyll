// Room charge check: the rules, the planted story, the totals and who may see it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-rc-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { POLICY, ROOM_TYPES, classifyRoomCharge, detectExceptions, detectRoomChargeException } = await import("../domain/detect");
const { roomChargesByDay, roomChargesBySource, summariseRoomCharges } = await import("../domain/room-charges");
const { explain } = await import("../domain/explain");
const { getDataset } = await import("../data/generate");
const { demoCases } = await import("../data/demo-cases");
const { ROOM_STORY, ROOM_STORY_CHARGE_ID, ROOM_STORY_EXCEPTION_ID, ROOM_STORY_ORDER_ID } = await import("../data/constants");
const { roomCheckFor } = await import("../server/room-charges");
const { snapshotFor } = await import("../server/snapshot");
const { userById } = await import("../data/catalog");
const { can } = await import("../domain/access");
const { activeItem } = await import("../nav");
const { orderTotals } = await import("../domain/orders");
const { DEMO_TODAY, addDays, eachDay, rel } = await import("../util");
type RoomCharge = import("../types").RoomCharge;

const charge: RoomCharge = { id: "RC-T", propertyId: "lis", outletId: "lis-terrace", date: DEMO_TODAY, min: 20 * 60, room: "1412", source: "restaurant", description: "Mercado check T", orderId: "MER-T", expected: 120, posted: [120], postedMin: 20 * 60 + 1 };

describe("room charge rules", () => {
  it("does not flag a charge posted to the right room, for the right amount, while the guest is in house", () => {
    expect(classifyRoomCharge(charge)).toBe("matched");
    expect(detectRoomChargeException(charge)).toBeNull();
    // The folio names the same room: not a wrong room.
    expect(detectRoomChargeException({ ...charge, folioRoom: "1412" })).toBeNull();
    // Posted before the guest checked out: fine.
    expect(detectRoomChargeException({ ...charge, checkoutMin: 24 * 60 + 9 * 60 })).toBeNull();
    // A check-out time with no posting time cannot prove a late posting.
    expect(detectRoomChargeException({ ...charge, postedMin: undefined, checkoutMin: 10 * 60 })).toBeNull();
    // Rounding within the tolerance is ignored.
    expect(detectRoomChargeException({ ...charge, posted: [120 + POLICY.roomChargeTolerance] })).toBeNull();
  });

  it("flags each kind of difference with the money at stake", () => {
    expect(detectRoomChargeException({ ...charge, posted: [] })).toMatchObject({ type: "room_charge_missing", exposure: 120 });
    expect(detectRoomChargeException({ ...charge, posted: [100] })).toMatchObject({ type: "room_charge_incorrect", exposure: 20 });
    expect(detectRoomChargeException({ ...charge, posted: [120, 120] })).toMatchObject({ type: "room_charge_duplicate", exposure: 120 });
    const wrong = detectRoomChargeException({ ...charge, folioRoom: "1421" })!;
    expect(wrong).toMatchObject({ type: "room_charge_wrong_room", exposure: 120, headline: "Room 1412: charge posted to room 1421" });
    expect(wrong.comparedWith).toContain("check MER-T is on room 1421");
    const late = detectRoomChargeException({ ...charge, source: "minibar", outletId: undefined, orderId: undefined, posted: [18], expected: 18, min: 11 * 60, postedMin: 11 * 60 + 1, checkoutMin: 10 * 60 + 5 })!;
    expect(late).toMatchObject({ type: "room_charge_after_checkout", exposure: 18 });
    expect(late.headline).toBe("Room 1412: minibar charge reached the guest bill after check-out");
    expect(late.comparedWith).toContain("10:05 AM");
  });

  it("checks in a fixed order, so one charge raises one flag", () => {
    expect(classifyRoomCharge({ ...charge, posted: [], folioRoom: "1421" })).toBe("missing");
    expect(classifyRoomCharge({ ...charge, posted: [120, 120], folioRoom: "1421" })).toBe("wrong_room");
    expect(classifyRoomCharge({ ...charge, posted: [120, 120], checkoutMin: 19 * 60 })).toBe("after_checkout");
    expect(ROOM_TYPES).toEqual(expect.arrayContaining(["room_charge_wrong_room", "room_charge_after_checkout"]));
  });
});

describe("room charge data and totals", () => {
  const d = getDataset();
  const roomCases = d.exceptions.filter((e) => ROOM_TYPES.includes(e.type));

  it("seeds every kind of difference, rarely, on top of thousands of clean postings", () => {
    const s = summariseRoomCharges(d.roomCharges);
    expect(s.checked).toBeGreaterThan(4000);
    expect(s.matched / s.checked).toBeGreaterThan(0.97);
    for (const st of ["missing", "wrong_amount", "duplicate", "wrong_room", "after_checkout"] as const) expect(s.byStatus.find((x) => x.status === st)!.n).toBeGreaterThan(0);
  });

  it("reconciles the check with the flags: one flag per difference, the same money", () => {
    const s = summariseRoomCharges(d.roomCharges);
    expect(s.matched + s.mismatched).toBe(s.checked);
    expect(s.byStatus.reduce((t, x) => t + x.n, 0)).toBe(s.checked);
    expect(roomCases).toHaveLength(s.mismatched);
    expect(s.atStake).toBeCloseTo(roomCases.reduce((t, e) => t + e.exposure, 0), 2);
    // detectExceptions raises the same room flags as the per charge rule.
    expect(detectExceptions([], d.roomCharges).map((e) => e.id).sort()).toEqual(roomCases.map((e) => e.id).sort());
    // Every case has a seeded state, so the totals never read an empty one.
    for (const e of roomCases) expect(d.seedInvestigations[e.id]).toBeDefined();
  });

  it("adds up the same way by day and by source", () => {
    const days = eachDay({ from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY });
    const inDays = d.roomCharges.filter((c) => c.date >= days[0]);
    const byDay = roomChargesByDay(inDays, days);
    const s = summariseRoomCharges(inDays);
    expect(byDay).toHaveLength(30);
    expect(byDay.reduce((t, x) => t + x.checked, 0)).toBe(s.checked);
    expect(byDay.reduce((t, x) => t + x.mismatched, 0)).toBe(s.mismatched);
    expect(byDay.reduce((t, x) => t + x.value, 0)).toBeCloseTo(s.atStake, 2);
    const bySource = roomChargesBySource(inDays);
    expect(bySource.reduce((t, x) => t + x.n, 0)).toBe(s.checked);
    expect(bySource.reduce((t, x) => t + x.counts.matched, 0)).toBe(s.matched);
    expect(bySource.reduce((t, x) => t + x.charged, 0)).toBeCloseTo(s.charged, 2);
  });

  it("plants the story: last night's Mercado dinner signed to room 1412, posted to room 1421", () => {
    const order = d.ordersById.get(ROOM_STORY_ORDER_ID)!;
    expect(order).toMatchObject({ outletId: "lis-terrace", date: rel(-1), payment: "room", room: ROOM_STORY.room });
    const c = d.chargesById.get(ROOM_STORY_CHARGE_ID)!;
    expect(classifyRoomCharge(c)).toBe("wrong_room");
    expect(c.expected).toBe(orderTotals(order).net);
    const e = d.exceptions.find((x) => x.id === ROOM_STORY_EXCEPTION_ID)!;
    expect(e).toMatchObject({ type: "room_charge_wrong_room", exposure: c.expected, outletId: "lis-terrace" });
    expect(d.seedInvestigations[e.id].status).toBe("new");
    expect(demoCases(d.exceptions, d.seedInvestigations).some((x) => x.id === e.id)).toBe(true);
    const why = explain(e, d, d.counts, []);
    expect(why.recommended[0]).toContain(`from room ${ROOM_STORY.folioRoom} to room ${ROOM_STORY.room}`);
    expect(why.facts.join(" ")).toContain(`Room ${ROOM_STORY.room} checked out`);
  });

  it("keeps every open room charge case in the public demo, so each listed difference can be reviewed", () => {
    const kept = new Set(demoCases(d.exceptions, d.seedInvestigations).map((e) => e.id));
    for (const e of roomCases.filter((x) => d.seedInvestigations[x.id].status !== "closed")) expect(kept.has(e.id)).toBe(true);
  });

  it("closes older differences as the night audit would, with the right note for each kind", () => {
    for (const e of roomCases.filter((x) => x.date < DEMO_TODAY && x.id !== ROOM_STORY_EXCEPTION_ID)) expect(d.seedInvestigations[e.id].status).toBe("closed");
    const moved = roomCases.find((e) => e.type === "room_charge_wrong_room" && d.seedInvestigations[e.id].outcome === "recovered");
    if (moved) expect(d.seedInvestigations[moved.id].notes[0].text).toContain("right room");
  });
});

describe("room charge check on the server", () => {
  const fnb = userById["u-fnb"];
  const all = () => {
    const r = roomCheckFor(fnb, { from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY });
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("is for managers who work the check, and refused to the rest on the server", () => {
    for (const id of ["u-fnb", "u-gm", "u-fc", "u-owner", "u-rm"]) expect(can(userById[id], "roomcharge.view")).toBe(true);
    for (const id of ["u-chef", "u-buy", "u-emp", "u-fo", "u-events"]) {
      expect(can(userById[id], "roomcharge.view")).toBe(false);
      expect(roomCheckFor(userById[id], {})).toMatchObject({ ok: false, status: 403 });
      expect(snapshotFor(userById[id]).roomCharges).toHaveLength(0);
    }
    expect(snapshotFor(fnb).roomCharges.length).toBeGreaterThan(0);
  });

  it("lists every difference in the period, largest first, and agrees with its own summary", () => {
    const r = all();
    expect(r.rows).toHaveLength(r.summary.mismatched);
    expect(r.rows.reduce((t, x) => t + x.atStake, 0)).toBeCloseTo(r.summary.atStake, 2);
    for (let i = 1; i < r.rows.length; i++) expect(r.rows[i - 1].atStake).toBeGreaterThanOrEqual(r.rows[i].atStake);
    expect(r.days).toHaveLength(30);
    expect(r.days.reduce((t, x) => t + x.mismatched, 0)).toBe(r.summary.mismatched);
    expect(r.story).toMatchObject({ room: ROOM_STORY.room, folioRoom: ROOM_STORY.folioRoom, caseId: ROOM_STORY_EXCEPTION_ID });
  });

  it("keeps a restaurant manager to their own outlet, with no hotel wide minibar, spa or laundry", () => {
    const bar = userById["u-lby"];
    const r = roomCheckFor(bar, { from: addDays(DEMO_TODAY, -29), to: DEMO_TODAY, outlets: "lis-lobby,lis-terrace,lis-ird", whole: "lis" });
    if (!r.ok) throw new Error(r.error);
    expect(r.rows.every((x) => x.outletId === "lis-lobby")).toBe(true);
    expect(r.bySource.map((x) => x.source)).toEqual(["restaurant"]);
    expect(r.story).toBeNull();
  });

  it("follows the outlet selector: an empty selection shows nothing, one outlet shows only that outlet", () => {
    const none = roomCheckFor(fnb, { outlets: "", whole: "" });
    expect(none.ok && none.summary.checked).toBe(0);
    const ird = roomCheckFor(fnb, { outlets: "lis-ird", whole: "" });
    if (!ird.ok) throw new Error(ird.error);
    expect(ird.bySource.map((x) => x.source)).toEqual(["room_service"]);
    expect(roomCheckFor(fnb, { from: DEMO_TODAY, to: addDays(DEMO_TODAY, -3) })).toMatchObject({ ok: false, status: 400 });
  });

  it("is reached from Flagged transactions in the sidebar", () => {
    expect(activeItem("/money", "rooms")?.label).toBe("Flagged transactions");
  });
});
