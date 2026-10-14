import { beforeEach, describe, expect, it } from "vitest";
import { userById } from "../data/catalog";
import { hydrateDataset } from "../data/dataset";
import { HERO_EXCEPTION_ID, getDataset } from "../data/generate";
import { snapshotFor } from "../server/snapshot";
import { useDemo } from "../store";
import { DEMO_TODAY, addDays } from "../util";

const s = () => useDemo.getState();
const signIn = (id: string) => s().signIn(id);
const data = getDataset();
const dohaCase = data.exceptions.find((e) => e.outletId === "doh-sky")!;
const minibarCase = data.exceptions.find((e) => !e.outletId && e.propertyId === "dxb")!;

// The browser store reads the data the server released after sign-in. The owner sees everything.
hydrateDataset(snapshotFor(userById["u-owner"]));

beforeEach(() => {
  signIn("u-owner");
  s().resetDemo();
});

describe("investigation workflow", () => {
  it("assigns, reviews, closes and reopens with an audit entry for each step", () => {
    signIn("u-rm");
    expect(s().assignInvestigation(HERO_EXCEPTION_ID, "TRC-S6", addDays(DEMO_TODAY, 2))).toEqual({ ok: true });
    expect(s().investigations[HERO_EXCEPTION_ID]).toMatchObject({ status: "assigned", assigneeId: "TRC-S6" });
    expect(s().startReview(HERO_EXCEPTION_ID).ok).toBe(true);
    expect(s().addNote(HERO_EXCEPTION_ID, "Bar confirmed the drink was poured.").ok).toBe(true);
    expect(s().closeInvestigation(HERO_EXCEPTION_ID, { outcome: "confirmed_loss", confirmedLoss: 22, recovered: 0, note: "Served, guest had left." }).ok).toBe(true);
    expect(s().investigations[HERO_EXCEPTION_ID]).toMatchObject({ status: "closed", outcome: "confirmed_loss", confirmedLoss: 22, closedBy: "u-rm" });
    expect(s().audit.map((a) => a.action)).toEqual(expect.arrayContaining(["Investigation assigned", "Review started", "Note added", "Investigation closed"]));

    // A restaurant manager cannot reopen. A controller can.
    expect(s().reopenInvestigation(HERO_EXCEPTION_ID).ok).toBe(false);
    signIn("u-fc");
    expect(s().reopenInvestigation(HERO_EXCEPTION_ID).ok).toBe(true);
    expect(s().investigations[HERO_EXCEPTION_ID]).toMatchObject({ status: "in_review", confirmedLoss: 0 });
  });

  it("validates deadlines, notes and amounts", () => {
    signIn("u-rm");
    expect(s().assignInvestigation(HERO_EXCEPTION_ID, "", addDays(DEMO_TODAY, 1)).ok).toBe(false);
    expect(s().assignInvestigation(HERO_EXCEPTION_ID, "TRC-S6", addDays(DEMO_TODAY, -1)).ok).toBe(false);
    expect(s().assignInvestigation(HERO_EXCEPTION_ID, "TRC-S6", "tomorrow").ok).toBe(false);
    expect(s().addNote(HERO_EXCEPTION_ID, " ").ok).toBe(false);
    const closeWith = (confirmedLoss: number, recovered: number, outcome: "confirmed_loss" | "recovered" | "legitimate", note = "Checked.") => s().closeInvestigation(HERO_EXCEPTION_ID, { outcome, confirmedLoss, recovered, note });
    expect(closeWith(50, 0, "confirmed_loss").ok).toBe(false);
    expect(closeWith(15, 15, "recovered").ok).toBe(false);
    expect(closeWith(-1, 0, "confirmed_loss").ok).toBe(false);
    expect(closeWith(0, 0, "confirmed_loss").ok).toBe(false);
    expect(closeWith(10, 0, "legitimate").ok).toBe(false);
    expect(closeWith(22, 0, "confirmed_loss", "").ok).toBe(false);
    expect(s().investigations[HERO_EXCEPTION_ID]).toBeUndefined();
    expect(closeWith(10, 12, "recovered").ok).toBe(true);
    expect(closeWith(0, 0, "legitimate").ok).toBe(false);
  });

  it("refuses cases outside the user's outlets or role", () => {
    signIn("u-rm");
    expect(s().closeInvestigation(dohaCase.id, { outcome: "legitimate", confirmedLoss: 0, recovered: 0, note: "Checked." }).ok).toBe(false);
    expect(s().addNote(dohaCase.id, "Trying to reach another hotel").ok).toBe(false);
    expect(s().addNote(minibarCase.id, "Property-wide record").ok).toBe(false);
    signIn("u-emp");
    expect(s().closeInvestigation(HERO_EXCEPTION_ID, { outcome: "legitimate", confirmedLoss: 0, recovered: 0, note: "Checked." }).ok).toBe(false);
    signIn("u-gm");
    expect(s().addNote(minibarCase.id, "Asked housekeeping for the minibar sheet.").ok).toBe(true);
    expect(s().addNote(dohaCase.id, "Not my hotel").ok).toBe(false);
    expect(Object.keys(s().investigations)).toEqual([minibarCase.id]);
  });
});

describe("stock and forecast actions", () => {
  it("lets an employee log waste at their outlet only, and validates the quantity", () => {
    signIn("u-emp");
    expect(s().logWaste({ outletId: "dxb-terrace", ingredientId: "salmon", qty: 1.2, reason: "spoilage" }).ok).toBe(true);
    expect(s().logWaste({ outletId: "dxb-lune", ingredientId: "salmon", qty: 1, reason: "spoilage" }).ok).toBe(false);
    expect(s().logWaste({ outletId: "dxb-terrace", ingredientId: "salmon", qty: 0, reason: "spoilage" }).ok).toBe(false);
    expect(s().logWaste({ outletId: "dxb-terrace", ingredientId: "salmon", qty: 9999, reason: "spoilage" }).ok).toBe(false);
    expect(s().logWaste({ outletId: "dxb-terrace", qty: 1, reason: "waste" }).ok).toBe(false);
    expect(s().wasteLogs).toHaveLength(1);
    expect(s().wasteLogs[0]).toMatchObject({ by: "TRC-S9", synced: true, date: DEMO_TODAY });
  });

  it("holds offline entries until the connection returns", () => {
    signIn("u-emp");
    s().setOffline(true);
    s().logWaste({ outletId: "dxb-terrace", itemId: "burger", qty: 1, reason: "waste" });
    expect(s().wasteLogs[0].synced).toBe(false);
    s().setOffline(false);
    expect(s().wasteLogs[0].synced).toBe(true);
  });

  it("records a count against the current estimate", () => {
    signIn("u-emp");
    expect(s().recordCount({ propertyId: "doh", ingredientId: "coke", counted: 10, expected: 12, allocation: {} }).ok).toBe(false);
    expect(s().recordCount({ propertyId: "dxb", ingredientId: "coke", counted: -1, expected: 12, allocation: {} }).ok).toBe(false);
    expect(s().recordCount({ propertyId: "dxb", ingredientId: "coke", counted: 100, expected: 90, allocation: { "dxb-terrace": 1 } }).ok).toBe(true);
    expect(s().counts[0]).toMatchObject({ ingredientId: "coke", counted: 100, kind: "spot" });
    expect(s().counts[0].expected).toBeGreaterThan(0);
  });

  it("restricts price changes and purchase approvals", () => {
    signIn("u-rm");
    expect(s().setIngredientPrice("wagyu", 300).ok).toBe(false);
    expect(s().approvePurchases("doh", [{ ingredientId: "salmon", qty: 5, cost: 700 }]).ok).toBe(false);
    expect(s().approvePurchases("dxb", [{ ingredientId: "salmon", qty: 5, cost: 700 }]).ok).toBe(true);
    signIn("u-fnb");
    expect(s().setIngredientPrice("wagyu", 0).ok).toBe(false);
    expect(s().setIngredientPrice("wagyu", 300).ok).toBe(true);
    expect(s().priceOverrides).toEqual([{ id: "wagyu", from: DEMO_TODAY, value: 300 }]);
    expect(s().approvals).toHaveLength(1);
  });
});

describe("scope, operations and reset", () => {
  it("keeps the scope inside the signed-in user's access", () => {
    signIn("u-rm");
    s().setScope({ propertyId: "doh" });
    expect(s().scope).toMatchObject({ propertyId: "dxb", outletId: "dxb-terrace" });
    signIn("u-owner");
    s().setScope({ outletId: "doh-sky" });
    expect(s().scope).toMatchObject({ propertyId: "doh", outletId: "doh-sky" });
    s().setScope({ propertyId: "dxb" });
    expect(s().scope).toMatchObject({ propertyId: "dxb", outletId: "all" });
  });

  it("validates custom date ranges", () => {
    expect(s().setCustom({ from: addDays(DEMO_TODAY, -3), to: addDays(DEMO_TODAY, 1) }).ok).toBe(false);
    expect(s().setCustom({ from: DEMO_TODAY, to: addDays(DEMO_TODAY, -3) }).ok).toBe(false);
    expect(s().setCustom({ from: addDays(DEMO_TODAY, -10), to: addDays(DEMO_TODAY, -4) }).ok).toBe(true);
    expect(s().preset).toBe("custom");
  });

  it("guards order and room changes, then restores everything on reset", () => {
    const ticket = data.liveOrders.find((o) => o.outletId === "dxb-terrace")!;
    const room = data.rooms.find((r) => r.propertyId === "dxb")!;
    signIn("u-fc");
    expect(s().setFlowStatus(ticket.id, "served").ok).toBe(false);
    expect(s().updateRoom(room.id, { priority: true }).ok).toBe(false);
    signIn("u-rm");
    expect(s().setFlowStatus(ticket.id, "served").ok).toBe(true);
    expect(s().updateRoom(room.id, { priority: true }).ok).toBe(false);
    signIn("u-gm");
    expect(s().updateRoom(room.id, { priority: true }).ok).toBe(true);
    s().resetDemo();
    expect(s().flowStatus).toEqual({});
    expect(s().roomState).toEqual({});
    expect(s().investigations).toEqual({});
    expect(s().userId).toBe("u-gm");
  });
});

describe("stock cases", () => {
  const sharedShort = data.counts.find((c) => c.propertyId === "dxb" && c.kind === "weekly" && (c.allocation["dxb-terrace"] ?? 0) > 0 && (c.allocation["dxb-terrace"] ?? 0) < 1 && c.counted < c.expected - 0.5)!;
  const luneShort = data.counts.find((c) => c.propertyId === "dxb" && c.ingredientId === "lobster" && c.counted < c.expected - 0.01);

  it("opens a case for an outlet's share of a shortfall, once, and lists it with the other cases", () => {
    signIn("u-rm");
    const r = s().openStockCase(sharedShort.id, "dxb-terrace");
    expect(r).toMatchObject({ ok: true });
    const id = r.id!;
    expect(s().openStockCase(sharedShort.id, "dxb-terrace")).toEqual({ ok: true, id });
    expect(s().stockCases).toHaveLength(1);
    const e = s().stockCases[0];
    expect(e).toMatchObject({ type: "stock_shortfall", outletId: "dxb-terrace", ingredientId: sharedShort.ingredientId });
    expect(e.exposure).toBeGreaterThan(0);
    expect(s().investigations[id]).toMatchObject({ status: "new" });
    // It then runs through the normal workflow.
    expect(s().assignInvestigation(id, "TRC-S6", addDays(DEMO_TODAY, 2)).ok).toBe(true);
    expect(s().closeInvestigation(id, { outcome: "inconclusive", confirmedLoss: 0, recovered: 0, note: "Recounted, still short." }).ok).toBe(true);
  });

  it("refuses outlets outside the user's access, outlets that did not use the item, other stores and staff", () => {
    signIn("u-rm");
    expect(s().openStockCase(sharedShort.id, "dxb-lune").ok).toBe(false);
    if (luneShort) expect(s().openStockCase(luneShort.id, "dxb-terrace").ok).toBe(false);
    signIn("u-emp");
    expect(s().openStockCase(sharedShort.id, "dxb-terrace").ok).toBe(false);
    signIn("u-gm");
    if (luneShort) expect(s().openStockCase(luneShort.id, "dxb-lune").ok).toBe(true);
    expect(s().openStockCase("C-NOPE", "dxb-terrace").ok).toBe(false);
  });

  it("refuses an unknown assignee", () => {
    signIn("u-rm");
    expect(s().assignInvestigation(HERO_EXCEPTION_ID, "nobody", addDays(DEMO_TODAY, 2)).ok).toBe(false);
  });
});
