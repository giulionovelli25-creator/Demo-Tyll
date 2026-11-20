// Radisson feedback build: one file for the bugs and features of that brief.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-radisson-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { resetPurchasingStore, loadStore } = await import("../server/purchasing-store");
const P = await import("../server/purchasing");
const PR = await import("../server/procurement");
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

const none: import("../server/stock").SessionEntries = { waste: [], counts: [], overrides: [], recipes: [], receipts: [] };
const lowItems = (userId: string) => {
  const r = P.monthPlanFor(userById[userId], "lis", none);
  if (!r.ok) throw new Error(r.error);
  return r.plan.items.filter((i) => i.health !== "fine" && i.nextQty > 0);
};

describe("Order now", () => {
  it("there are critical or low items to order in the demo", () => {
    expect(lowItems("u-buy").length).toBeGreaterThan(0);
    expect(lowItems("u-buy").some((i) => i.health === "critical")).toBe(true);
  });
  it("orders the suggested quantity from the usual supplier and sends it for approval", () => {
    const item = lowItems("u-chef")[0];
    const out = P.orderNow(userById["u-chef"], "lis", item.ingredientId, none);
    if (!out.ok) throw new Error(out.error);
    const r = loadStore().requests.find((x) => x.id === out.request!.id)!;
    expect(r.status).toBe("purchasing");
    expect(r.createdBy).toBe("u-chef");
    const line = r.lines.find((l) => l.ingredientId === item.ingredientId)!;
    expect(line.qty).toBe(item.nextQty);
    expect(line.supplierId).toBe(PR.catalogueFor("lis", item.ingredientId)[0].supplierId);
    expect(r.history.some((h) => h.action === "Draft purchase order created from Order now")).toBe(true);
    expect(r.history.at(-1)!.action).toBe("Submitted to purchasing");
  });
  it("a preview saves nothing", () => {
    const before = loadStore().requests.length;
    const item = lowItems("u-buy")[0];
    const out = P.orderNow(userById["u-buy"], "lis", item.ingredientId, none, { preview: true });
    expect(out.ok).toBe(true);
    expect(loadStore().requests.length).toBe(before);
  });
  it("a second press finds the item already on order, so nothing is ordered twice", () => {
    const item = lowItems("u-buy")[0];
    expect(P.orderNow(userById["u-buy"], "lis", item.ingredientId, none).ok).toBe(true);
    const count = loadStore().requests.length;
    const again = P.orderNow(userById["u-buy"], "lis", item.ingredientId, none);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.status).toBe(409);
    expect(loadStore().requests.length).toBe(count);
  });
  it("joins the person's open draft for that supplier instead of starting another", () => {
    const items = lowItems("u-fnb");
    const bySupplier = new Map<string, typeof items>();
    for (const i of items) { const s = PR.catalogueFor("lis", i.ingredientId)[0]?.supplierId; if (s) bySupplier.set(s, [...(bySupplier.get(s) ?? []), i]); }
    const [, pair] = [...bySupplier.entries()].find(([, v]) => v.length >= 2) ?? [];
    expect(pair).toBeDefined();
    if (!pair) return;
    const made = PR.createPurchaseOrders(userById["u-fnb"], "lis", [{ ingredientId: pair[1].ingredientId, qty: pair[1].nextQty }], { source: "manual" });
    if (!made.ok) throw new Error(made.error);
    const preview = P.orderNow(userById["u-fnb"], "lis", pair[0].ingredientId, none, { preview: true });
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.draft?.id).toBe(made.orders[0].id);
    const out = P.orderNow(userById["u-fnb"], "lis", pair[0].ingredientId, none);
    if (!out.ok) throw new Error(out.error);
    expect(out.request!.id).toBe(made.orders[0].id);
    expect(out.request!.lines.map((l) => l.ingredientId).sort()).toEqual([pair[0].ingredientId, pair[1].ingredientId].sort());
  });
  it("is refused for a role that cannot order, and for an item that is not low", () => {
    const item = lowItems("u-buy")[0];
    const fc = P.orderNow(userById["u-fc"], "lis", item.ingredientId, none);
    expect(fc.ok).toBe(false);
    if (!fc.ok) expect(fc.status).toBe(403);
    const plan = P.monthPlanFor(userById["u-buy"], "lis", none);
    if (!plan.ok) throw new Error(plan.error);
    const fine = plan.plan.items.find((i) => i.health === "fine")!;
    const r = P.orderNow(userById["u-buy"], "lis", fine.ingredientId, none);
    expect(r.ok).toBe(false);
  });
});
