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

const D = await import("../domain/dispatch");
const E = await import("../server/procurement-export");
const L = await import("../server/late-delivery");

/** Takes an order through the approval chain; each step by its own role. */
function approve(id: string) {
  const steps: [string, string][] = [["u-buy", "purchasing"], ["u-fc", "accounting"], ["u-fnb", "fnb"], ["u-gm", "manager"]];
  for (const [u, a] of steps) {
    const st = loadStore().requests.find((r) => r.id === id)!.status;
    if (st !== a) continue;
    const r = P.actOnRequest(userById[u], id, { action: a, decision: "approve" });
    if (!r.ok) throw new Error(`${a}: ${r.error}`);
  }
  return loadStore().requests.find((r) => r.id === id)!;
}
const orderFor = (userId: string, ingredientId: string, qty: number) => {
  const made = PR.createPurchaseOrders(userById[userId], "lis", [{ ingredientId, qty }], { source: "manual" });
  if (!made.ok) throw new Error(made.error);
  const id = made.orders[0].id;
  const sub = P.actOnRequest(userById[userId], id, { action: "submit" });
  if (!sub.ok) throw new Error(sub.error);
  return id;
};

describe("Sending orders to suppliers: the state machine", () => {
  it("moves draft, pending, approved, sending, then sent or failed; failed goes back to sending, sent goes nowhere", () => {
    expect(D.canMove("draft", "pending")).toBe(true);
    expect(D.canMove("pending", "approved")).toBe(true);
    expect(D.canMove("approved", "sending")).toBe(true);
    expect(D.canMove("sending", "sent")).toBe(true);
    expect(D.canMove("sending", "failed")).toBe(true);
    expect(D.canMove("failed", "sending")).toBe(true);
    expect(D.canMove("failed", "sent")).toBe(false);
    expect(D.canMove("approved", "sent")).toBe(false);
    expect(D.SEND_NEXT.sent).toEqual([]);
  });
  it("reads the state from the order record", () => {
    const base = seedRequests()[0];
    expect(D.sendState({ ...base, status: "draft" })).toBe("draft");
    expect(D.sendState({ ...base, status: "accounting" })).toBe("pending");
    expect(D.sendState({ ...base, status: "approved", sent: undefined, sentAt: undefined, dispatch: undefined })).toBe("approved");
    expect(D.sendState({ ...base, status: "approved", sentAt: "2026-10-13T08:00" })).toBe("sent");
    expect(D.sendState({ ...base, status: "approved", dispatch: { channel: "portal", state: "failed", key: "k", attempts: [] } })).toBe("failed");
  });
});

describe("Sending orders to suppliers: automatic, by channel, once", () => {
  it("a fully approved email supplier order goes on its own, once, with the PDF kept and the email logged, not sent", () => {
    const id = orderFor("u-chef", "salmon", 20);
    const approved = approve(id);
    expect(approved.status).toBe("approved");
    expect(D.sendState(approved)).toBe("approved");
    expect(PR.sendApproved("lis")).toContain(id);
    const r = loadStore().requests.find((x) => x.id === id)!;
    expect(D.sendState(r)).toBe("sent");
    expect(r.dispatch).toMatchObject({ channel: "email", state: "sent" });
    expect(r.dispatch!.attempts).toHaveLength(1);
    expect(r.sent?.pdf).toMatch(/\.pdf$/);
    expect(r.history.some((h) => /Sent automatically once fully approved/.test(h.comment ?? ""))).toBe(true);
    // Running the sender again, or pressing Send, never sends it twice.
    expect(PR.sendApproved("lis")).not.toContain(id);
    expect(PR.sendPurchaseOrder(userById["u-buy"], id).ok).toBe(false);
    expect(loadStore().procurement!.outbox.filter((e) => e.ref === id)).toHaveLength(1);
  });
  it("a push that times out shows as failed, tells purchasing, and a retry with the same reference never makes a second order", () => {
    const id = orderFor("u-chef", "wine", 18);
    approve(id);
    PR.sendApproved("lis");
    let r = loadStore().requests.find((x) => x.id === id)!;
    expect(r.dispatch).toMatchObject({ channel: "portal", state: "failed" });
    expect(D.sendState(r)).toBe("failed");
    expect(r.sentAt).toBeUndefined();
    expect(loadStore().notify.notices.some((n) => n.type === "po-send-failed" && n.ref === id && n.to === "u-buy")).toBe(true);
    // The sender does not retry on its own; a person does.
    expect(PR.sendApproved("lis")).not.toContain(id);
    const retry = PR.sendPurchaseOrder(userById["u-buy"], id);
    if (!retry.ok) throw new Error(retry.error);
    r = loadStore().requests.find((x) => x.id === id)!;
    expect(D.sendState(r)).toBe("sent");
    expect(r.dispatch!.attempts.map((a) => a.result)).toEqual(["failed", "sent"]);
    expect(r.dispatch!.attempts[1].detail).toMatch(/already had this order/);
    // The supplier received it once: one push logged, one reference in its system.
    expect(loadStore().procurement!.outbox.filter((e) => e.ref === id)).toHaveLength(1);
    expect(loadStore().procurement!.inbox!.filter((e) => e.key === r.dispatch!.key)).toHaveLength(1);
    expect(loadStore().notify.notices.find((n) => n.type === "po-send-failed" && n.ref === id)!.resolved).toBe(true);
  });
  it("a phone supplier waits for purchasing to call, then counts as sent", () => {
    const id = orderFor("u-chef", "wineglass", 48);
    approve(id);
    expect(PR.sendApproved("lis")).not.toContain(id);
    expect(D.sendState(loadStore().requests.find((x) => x.id === id)!)).toBe("approved");
    expect(PR.sendPurchaseOrder(userById["u-buy"], id).ok).toBe(false);
    expect(PR.recordPhoneOrder(userById["u-chef"], id, {}).ok).toBe(false);
    const done = PR.recordPhoneOrder(userById["u-buy"], id, { note: "Order number HB-221" });
    if (!done.ok) throw new Error(done.error);
    expect(done.request.dispatch).toMatchObject({ channel: "manual", state: "sent" });
    expect(done.request.expectedAt).toBeTruthy();
    expect(PR.recordPhoneOrder(userById["u-buy"], id, {}).ok).toBe(false);
  });
  it("the supplier's change waits for purchasing: accepted, the order takes the new quantity", () => {
    const id = orderFor("u-chef", "flour", 100);
    approve(id);
    PR.sendApproved("lis");
    const r = loadStore().requests.find((x) => x.id === id)!;
    expect(r.dispatch?.channel).toBe("portal");
    expect(r.confirmation?.state).toBe("changed");
    const c = r.confirmation!.changes[0];
    expect(c.kind).toBe("qty");
    expect(Number(c.to)).toBeLessThan(Number(c.from));
    expect(PR.decideSupplierChange(userById["u-chef"], id, { decision: "accept" }).ok).toBe(false);
    const ok = PR.decideSupplierChange(userById["u-buy"], id, { decision: "accept" });
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.request.lines.find((l) => l.ingredientId === c.ingredientId)!.qty).toBe(Number(c.to));
    expect(ok.request.confirmation?.state).toBe("accepted");
    expect(PR.decideSupplierChange(userById["u-buy"], id, { decision: "accept" }).ok).toBe(false);
  });
  it("declining a supplier's change needs a reason and keeps the order as sent", () => {
    const id = orderFor("u-chef", "flour", 100);
    approve(id);
    PR.sendApproved("lis");
    const before = loadStore().requests.find((x) => x.id === id)!.lines.map((l) => l.qty);
    expect(PR.decideSupplierChange(userById["u-buy"], id, { decision: "decline" }).ok).toBe(false);
    const ok = PR.decideSupplierChange(userById["u-buy"], id, { decision: "decline", note: "We need the full quantity, will call." });
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.request.confirmation?.state).toBe("declined");
    expect(ok.request.lines.map((l) => l.qty)).toEqual(before);
  });
  it("switching automatic sending off leaves approved orders for purchasing to send", () => {
    const st = PR.savePurchasingSettings(userById["u-buy"], "lis", { autoSend: false });
    if (!st.ok) throw new Error(st.error);
    const id = orderFor("u-chef", "salmon", 20);
    approve(id);
    expect(PR.sendApproved("lis")).toEqual([]);
    expect(PR.sendPurchaseOrder(userById["u-buy"], id).ok).toBe(true);
  });
  it("Delivered comes from the goods receipt, which is also the arrival at goods in: one record", () => {
    const id = orderFor("u-chef", "salmon", 20);
    approve(id);
    PR.sendApproved("lis");
    const got = L.recordArrival(userById["u-store"], { key: `PR:${id}`, complete: true });
    if (!got.ok) throw new Error(got.error);
    const r = loadStore().requests.find((x) => x.id === id)!;
    expect(r.status).toBe("received");
    expect(r.receipts).toHaveLength(1);
    expect(loadStore().lateDelivery!.arrivals.filter((a) => a.key === `PR:${id}`)).toHaveLength(1);
    expect(L.recordArrival(userById["u-store"], { key: `PR:${id}`, complete: true }).ok).toBe(false);
  });
  it("CSV and JSON export still list sent purchase orders", () => {
    const id = orderFor("u-chef", "salmon", 20);
    approve(id);
    PR.sendApproved("lis");
    const docs = E.exportDocuments(userById["u-fc"], "lis", "purchase_orders");
    if (!docs.ok) throw new Error(docs.error);
    expect(docs.documents.some((d) => JSON.stringify(d).includes(id.slice(3)))).toBe(true);
    expect(E.toCsv("purchase_orders", docs.documents).split("\n").length).toBeGreaterThan(1);
  });
});

describe("Sending orders to suppliers: the channel per supplier", () => {
  it("purchasing sets how a supplier takes orders; other roles cannot", () => {
    expect(PR.saveSupplier(userById["u-chef"], "lis", { id: "meat", channel: "portal" }).ok).toBe(false);
    expect(PR.saveSupplier(userById["u-buy"], "lis", { id: "meat", channel: "fax" }).ok).toBe(false);
    const ok = PR.saveSupplier(userById["u-buy"], "lis", { id: "meat", channel: "manual" });
    if (!ok.ok) throw new Error(ok.error);
    expect(PR.supplierAccount("lis", "meat")!.channel).toBe("manual");
  });
  it("the demo suppliers use all three channels", () => {
    const ch = new Set(PR.procurementOf().suppliers.map((s) => s.channel ?? "email"));
    expect([...ch].sort()).toEqual(["email", "manual", "portal"]);
  });
});

describe("Automatic orders in the approval chain", () => {
  it("the person who keeps the ordering rule may approve an automatic order, but never a request they raised themselves", async () => {
    const A = await import("../server/auto-order");
    A.ensureAutoRun("lis", none);
    const held = loadStore().requests.find((r) => r.auto?.decision === "held");
    if (held) {
      expect(held.createdBy).toBe("u-fnb");
      let st = held.status;
      for (const [u, a] of [["u-buy", "purchasing"], ["u-fc", "accounting"], ["u-fnb", "fnb"]] as const) {
        if (st !== a) continue;
        const r = P.actOnRequest(userById[u], held.id, { action: a, decision: "approve" });
        if (!r.ok) throw new Error(`${a}: ${r.error}`);
        st = r.request.status;
      }
    }
    // A request the F&B director raised by hand still needs someone else.
    const own = orderFor("u-fnb", "salmon", 200);
    P.actOnRequest(userById["u-buy"], own, { action: "purchasing", decision: "approve" });
    P.actOnRequest(userById["u-fc"], own, { action: "accounting", decision: "approve" });
    const r = loadStore().requests.find((x) => x.id === own)!;
    if (r.status === "fnb") expect(P.actOnRequest(userById["u-fnb"], own, { action: "fnb", decision: "approve" }).ok).toBe(false);
  });
});
