// Room charge check: the rules, the planted story, the totals and who may see it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-rc-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { POLICY, ROOM_STATUS_TYPE, ROOM_TYPES, TYPE_LABEL, classifyRoomCharge, detectExceptions, detectRoomChargeException } = await import("../domain/detect");
const { ROOM_STATUS_LABEL, roomChargesByDay, roomChargesBySource, summariseRoomCharges } = await import("../domain/room-charges");
const { explain } = await import("../domain/explain");
const { getDataset } = await import("../data/generate");
const { demoCases, demoRoomCheckFrom } = await import("../data/demo-cases");
const { ROOM_STORY, ROOM_STORY_CHARGE_ID, ROOM_STORY_EXCEPTION_ID, ROOM_STORY_ORDER_ID } = await import("../data/constants");
const { roomCheckFor } = await import("../server/room-charges");
const { snapshotFor } = await import("../server/snapshot");
const { userById } = await import("../data/catalog");
const { can } = await import("../domain/access");
const { activeItem } = await import("../nav");
const { orderTotals } = await import("../domain/orders");
const { DATA_START, DEMO_TODAY, addDays, eachDay, rel } = await import("../util");
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

  it("names a charge posted more than once the same way on the check and in the flags, whatever the number of postings", () => {
    expect(ROOM_STATUS_LABEL.duplicate).toBe("Posted more than once");
    expect(TYPE_LABEL[ROOM_STATUS_TYPE.duplicate]).toBe("Room charge posted more than once");
    expect(classifyRoomCharge({ ...charge, posted: [120, 120, 120] })).toBe("duplicate");
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
    // The message agrees with the facts: the guest has left, so it asks for the card on file, not whether they left.
    expect(why.message).toContain(`Room ${ROOM_STORY.room} has already checked out`);
    expect(why.message).not.toContain("check whether");
    const inHouse = { ...c, id: "RC-INHOUSE", checkoutMin: undefined };
    const ds = { ...d, chargesById: new Map([...d.chargesById, [inHouse.id, inHouse]]) };
    const stay = explain({ ...e, id: "EX-INHOUSE", chargeId: inHouse.id }, ds, d.counts, []);
    expect(stay.message).toContain("check whether that guest has already checked out");
  });

  it("keeps every open room charge case in the public demo, so each listed difference can be reviewed", () => {
    const kept = new Set(demoCases(d.exceptions, d.seedInvestigations).map((e) => e.id));
    for (const e of roomCases.filter((x) => d.seedInvestigations[x.id].status !== "closed")) expect(kept.has(e.id)).toBe(true);
  });

  it("keeps minibar check-outs in normal hours: the guest leaves between 7 AM and noon, before the late posting", () => {
    const late = d.roomCharges.filter((c) => c.source === "minibar" && classifyRoomCharge(c) === "after_checkout");
    expect(late.length).toBeGreaterThan(0);
    for (const c of late) {
      expect(c.min).toBeLessThan(13 * 60);
      expect(c.checkoutMin!).toBeGreaterThanOrEqual(7 * 60);
      expect(c.checkoutMin!).toBeLessThanOrEqual(12 * 60);
      expect(c.checkoutMin!).toBeLessThan(c.postedMin!);
    }
  });

  it("closes older differences as the night audit would, with the right note for each kind", () => {
    for (const e of roomCases.filter((x) => x.date < DEMO_TODAY && x.id !== ROOM_STORY_EXCEPTION_ID)) expect(d.seedInvestigations[e.id].status).toBe("closed");
    const moved = roomCases.find((e) => e.type === "room_charge_wrong_room" && d.seedInvestigations[e.id].outcome === "recovered");
    if (moved) expect(d.seedInvestigations[moved.id].notes[0].text).toContain("right room");
  });
});

describe("room charge check on the server", () => {
  const fnb = userById["u-fnb"];
  const d0 = getDataset();
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

  it("agrees with the flags in the public demo: every difference counted has its case, the same count and money by type", () => {
    const was = process.env.TYLL_PUBLIC_DEMO;
    process.env.TYLL_PUBLIC_DEMO = "on";
    try {
      const kept = demoCases(d0.exceptions, d0.seedInvestigations);
      const keptIds = new Set(kept.map((e) => e.id));
      for (const [from, to] of [[addDays(DEMO_TODAY, -29), DEMO_TODAY], [addDays(DEMO_TODAY, -6), DEMO_TODAY], [addDays(DEMO_TODAY, -1), addDays(DEMO_TODAY, -1)], [DEMO_TODAY, DEMO_TODAY]]) {
        const r = roomCheckFor(fnb, { from, to });
        if (!r.ok) throw new Error(r.error);
        for (const row of r.rows) expect(keptIds.has(row.caseId)).toBe(true);
        // "Flagged by type" on the flags page, for the room types, over the same period.
        const flagged = kept.filter((e) => ROOM_TYPES.includes(e.type) && e.date >= from && e.date <= to);
        for (const s of r.summary.byStatus.filter((x) => x.status !== "matched")) {
          const ofType = flagged.filter((e) => e.type === ROOM_STATUS_TYPE[s.status as keyof typeof ROOM_STATUS_TYPE]);
          expect(ofType).toHaveLength(s.n);
          expect(ofType.reduce((t, e) => t + e.exposure, 0)).toBeCloseTo(s.value, 2);
        }
        expect(flagged).toHaveLength(r.summary.mismatched);
      }
      // The check reaches no further back than the cases the public demo keeps.
      const far = roomCheckFor(fnb, { from: DATA_START, to: DEMO_TODAY });
      expect(far.ok && far.from).toBe(demoRoomCheckFrom());
      // Closed room cases have their own rule, so the twelve newest other closed cases per hotel stay too, plus a share of
      // the other closed cases of the last 30 days, and nothing older.
      const otherClosed = d0.exceptions.filter((e) => !ROOM_TYPES.includes(e.type) && d0.seedInvestigations[e.id].status === "closed");
      const newest = [...otherClosed].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
      for (const e of newest) expect(keptIds.has(e.id)).toBe(true);
      const keptClosed = otherClosed.filter((e) => keptIds.has(e.id));
      expect(keptClosed.length).toBeGreaterThan(12);
      for (const e of keptClosed) expect(newest.includes(e) || e.date >= demoRoomCheckFrom()).toBe(true);
    } finally {
      if (was === undefined) delete process.env.TYLL_PUBLIC_DEMO;
      else process.env.TYLL_PUBLIC_DEMO = was;
    }
    // Outside the public demo the check still reaches back to the start of the data.
    const full = roomCheckFor(fnb, { from: DATA_START, to: DEMO_TODAY });
    expect(full.ok && full.from).toBe(DATA_START);
  });

  it("keeps room charges a minority of the public demo's flagged bills, and the Overview's money lost near the story's figure", () => {
    // The Overview's "Flagged bills" row: every case of the last 30 days that is not a stock count, open or closed.
    const from = addDays(DEMO_TODAY, -29);
    const bills = demoCases(d0.exceptions, d0.seedInvestigations).filter((e) => e.date >= from && !e.period);
    const lost = bills.reduce((t, e) => t + e.exposure, 0);
    const room = bills.filter((e) => ROOM_TYPES.includes(e.type)).reduce((t, e) => t + e.exposure, 0);
    expect(room).toBeGreaterThan(0);
    expect(room / lost).toBeLessThan(0.6);
    // The other rows of money lost come to about EUR 9,400, so this keeps the headline near EUR 10,000 (CLAUDE.md).
    expect(lost).toBeLessThan(1500);
    // Room charge differences stay rare: under one charge in a hundred over the 30 days.
    const charges = d0.roomCharges.filter((c) => c.date >= from);
    expect(charges.filter((c) => classifyRoomCharge(c) !== "matched").length / charges.length).toBeLessThan(0.01);
  });

  it("simulates minibar, spa and laundry over the whole history, so the 30 day trend has no step", () => {
    for (const source of ["minibar", "spa", "laundry"] as const) {
      const days = new Set(d0.roomCharges.filter((c) => c.source === source).map((c) => c.date));
      for (const date of eachDay({ from: addDays(DEMO_TODAY, -29), to: addDays(DEMO_TODAY, -1) })) expect(days.has(date)).toBe(true);
    }
  });

  it("is reached from Flagged transactions in the sidebar", () => {
    expect(activeItem("/money", "rooms")?.label).toBe("Flagged transactions");
  });
});
