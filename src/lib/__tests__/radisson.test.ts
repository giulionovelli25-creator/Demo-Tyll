// Radisson feedback build: one file for the bugs and features of that brief.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-radisson-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { resetPurchasingStore } = await import("../server/purchasing-store");
const { seedRequests } = await import("../server/orders-seed");
const { userById } = await import("../data/catalog");
const Q = await import("../domain/order-queues");

beforeEach(() => resetPurchasingStore());

describe("Orders: the All filter and the filter it opens on", () => {
  const orders = seedRequests();
  it("All shows every order, for every role", () => {
    for (const id of ["u-fnb", "u-buy", "u-chef", "u-fc"]) {
      const u = userById[id];
      expect(orders.filter((r) => Q.inQueue(r, "all", u))).toHaveLength(orders.length);
    }
    expect(orders.length).toBeGreaterThan(0);
  });
  it("opens on the role's own step when it has orders", () => {
    expect(Q.openingQueue(orders, userById["u-buy"], null)).toBe("purchasing");
  });
  it("opens on All when the role's own step is empty, never on an empty list", () => {
    const fc = userById["u-fc"];
    const noAccounting = orders.filter((r) => r.status !== "accounting");
    expect(Q.ownQueue(fc)).toBe("accounting");
    expect(Q.openingQueue(noAccounting, fc, null)).toBe("all");
    expect(noAccounting.filter((r) => Q.inQueue(r, Q.openingQueue(noAccounting, fc, null), fc)).length).toBeGreaterThan(0);
  });
  it("a filter asked for in the address always wins", () => {
    expect(Q.openingQueue(orders, userById["u-fc"], "approved")).toBe("approved");
  });
});
