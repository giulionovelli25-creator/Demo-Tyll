// Overnight feature 8, the browser side: a change shows at once, waits in a queue until the server confirms it, and
// nothing saved is kept in browser storage, so the next role on the same browser starts from the server's view.
import { beforeEach, describe, expect, it } from "vitest";
import { userById } from "../data/catalog";
import { hydrateDataset } from "../data/dataset";
import { HERO_EXCEPTION_ID } from "../data/generate";
import { emptyRecords, RECORD_KEYS } from "../domain/records";
import { snapshotFor } from "../server/snapshot";
import { storagePolicy, useDemo } from "../store";
import { DEMO_TODAY, addDays } from "../util";

const s = () => useDemo.getState();
hydrateDataset(snapshotFor(userById["u-owner"]));

beforeEach(() => {
  s().signIn("u-owner");
  s().resetDemo();
});

describe("changes made in the browser", () => {
  it("show at once and wait in a queue, with the person who made them, until the server confirms", () => {
    s().signIn("u-rm");
    expect(s().assignInvestigation(HERO_EXCEPTION_ID, "MER-S6", addDays(DEMO_TODAY, 2))).toEqual({ ok: true });
    expect(s().investigations[HERO_EXCEPTION_ID]).toMatchObject({ status: "assigned", updatedBy: "u-rm", updatedRole: "restaurant_manager" });
    expect(s().pendingOps).toHaveLength(1);
    expect(s().pendingOps[0]).toMatchObject({ userId: "u-rm", op: { kind: "investigation.assign", id: HERO_EXCEPTION_ID } });
    // A refused change is not queued.
    expect(s().assignInvestigation(HERO_EXCEPTION_ID, "nobody", addDays(DEMO_TODAY, 2)).ok).toBe(false);
    expect(s().pendingOps).toHaveLength(1);
  });

  it("take the server's records, drop what it confirmed, and keep only this person's unconfirmed changes on top", () => {
    s().signIn("u-rm");
    s().assignInvestigation(HERO_EXCEPTION_ID, "MER-S6", addDays(DEMO_TODAY, 2));
    s().addNote(HERO_EXCEPTION_ID, "Asked the bar for the ticket.");
    const [first] = s().pendingOps;
    const server = { ...emptyRecords(), investigations: { [HERO_EXCEPTION_ID]: { status: "assigned" as const, assigneeId: "MER-S6", deadline: addDays(DEMO_TODAY, 2), notes: [], confirmedLoss: 0, recovered: 0 } } };
    s().receiveRecords(server, first.key);
    expect(s().pendingOps).toHaveLength(1);
    expect(s().investigations[HERO_EXCEPTION_ID].notes.map((n) => n.text)).toEqual(["Asked the bar for the ticket."]);
    // Another person signs in on this browser: their view from the server never carries the first person's queue.
    s().signIn("u-fc");
    s().receiveRecords(emptyRecords());
    expect(s().investigations).toEqual({});
  });

  it("are never written to browser storage", () => {
    s().signIn("u-fnb");
    s().setIngredientPrice("wagyu", 300);
    const stored = storagePolicy.partialize(s());
    for (const k of RECORD_KEYS) expect(stored).not.toHaveProperty(k);
    expect(stored).toHaveProperty("pendingOps");
    expect(stored).not.toHaveProperty("userId");
  });

  it("write no trail line of their own for signing in or out: the server's access log has those, with the role", () => {
    s().signOut();
    s().signIn("u-fnb");
    s().signOut();
    s().signIn("u-fc");
    expect(s().audit).toEqual([]);
  });

  it("keep resolve and snooze on Alerts in the queue for the server, never in browser storage", () => {
    s().signIn("u-fnb");
    expect(s().setAlertState("stock-critical", "resolved", "Order 3 critical items today")).toEqual({ ok: true });
    expect(s().alertStates["stock-critical"]).toEqual({ state: "resolved", on: DEMO_TODAY });
    expect(s().pendingOps.at(-1)).toMatchObject({ userId: "u-fnb", op: { kind: "alert.state", id: "stock-critical", state: "resolved" } });
    expect(s().audit[0]).toMatchObject({ userId: "u-fnb", role: "fnb_director", action: "Alert resolved" });
    expect(storagePolicy.partialize(s())).not.toHaveProperty("alertStates");
  });

  it("drops records an older browser kept, when it loads", () => {
    const out = storagePolicy.migrate({ investigations: { X: {} }, priceOverrides: [1], approvals: [1], scope: { propertyId: "lis" } });
    expect(out).toEqual({ scope: { propertyId: "lis" } });
  });
});
