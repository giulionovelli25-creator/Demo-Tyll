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

const MS = await import("../domain/menu-sync");
const SIM = await import("../server/integrations/simphony-sample");
const MSV = await import("../server/menu-sync");
const { MENU_ITEMS, itemById } = await import("../data/catalog");
const { ingredientCostAt } = await import("../domain/pricing");
const { DEMO_TODAY: TODAY, addDays: plusDays } = await import("../util");

describe("Simphony: the connected point of sale (demo connection, recorded samples)", () => {
  it("reads the menu with prices, family groups and the modifiers each item offers", async () => {
    const { pos, transport } = SIM.sampleSimphony();
    const menu = await pos.readMenu("lis-terrace");
    expect(menu.find((m) => m.itemId === "burger")).toMatchObject({ price: 24, category: "Mains", modifiers: ["no-cheese"] });
    expect(menu.find((m) => m.itemId === "mojito")!.modifiers).toEqual(["double"]);
    expect(menu.filter((m) => !m.itemId).map((m) => m.name)).toEqual(["Sea bass with lemon butter", "Lobster burger"]);
    expect(transport.requests[0]).toMatchObject({ system: "simphony", method: "GET" });
  });
  it("maps guest checks to Tyll bills behind the same PosAdapter: sales, modifiers, voids, discounts, room charges", async () => {
    const { pos } = SIM.sampleSimphony(SIM.SIMPHONY_SAMPLE_DATE);
    const day = await pos.readDay("lis-terrace", SIM.SIMPHONY_SAMPLE_DATE);
    expect(day.orders).toHaveLength(3);
    const [a, b] = day.orders;
    expect(a.lines.find((l) => l.itemId === "burger")).toBeTruthy();
    expect(a.modifiers[0]).toEqual(["no-cheese"]);
    expect(b.modifiers[0]).toEqual(["double"]);
    expect(b.lines[0].unitPrice).toBe(15.5);
    const voided = b.lines.find((l) => l.itemId === "fondant")!;
    expect(voided).toMatchObject({ state: "removed_post", reason: "Ordered by mistake" });
    expect(b.discountReason).toBe("Hotel guest 10%");
    expect(b.discountPct).toBeCloseTo(0.1, 3);
    expect(b.payment).toBe("room");
    expect(day.unmapped.sort()).toEqual(["1031", "1032"]);
    // The plain PosAdapter call gives the same bills, without the modifier detail.
    const plain = await pos.fetchOrders("lis-terrace", SIM.SIMPHONY_SAMPLE_DATE);
    expect(plain.map((o) => o.id)).toEqual(day.orders.map((o) => o.id));
    // Another day of the sample has no sales: nothing is invented.
    expect(await pos.fetchOrders("lis-terrace", "2020-01-01")).toEqual([]);
  });
  it("is listed in Data sources as a demo connection, with what it reads", async () => {
    const { DATA_SOURCES } = await import("../adapters");
    const s = DATA_SOURCES.find((x) => x.id === "pos-simphony")!;
    expect(s.state).toBe("demo_connection");
    expect(s.note).toMatch(/Last sync 06:00, demo connection/);
    for (const w of ["Sales", "menu items and prices", "modifiers", "voids", "discounts"]) expect(s.supplies.toLowerCase()).toContain(w.toLowerCase());
  });
});

describe("Menu sync and new dishes", () => {
  it("finds what changed on the till: two new dishes, one price change, one dish taken off", async () => {
    const menu = await SIM.sampleSimphony().pos.readMenu("lis-terrace");
    const known = [...new Set(Object.values(SIM.SIMPHONY_CONFIG.items))].map((id) => ({ itemId: id, name: itemById[id].name, price: itemById[id].price }));
    const d = MS.diffMenu(menu, known);
    expect(d.added.map((a) => a.name)).toEqual(["Sea bass with lemon butter", "Lobster burger"]);
    expect(d.priceChanged).toEqual([{ itemId: "burger", name: "Wagyu beef burger", from: 22, to: 24 }]);
    expect(d.removed).toEqual([{ itemId: "kidspasta", name: "Kids pasta" }]);
  });
  it("suggests a recipe from the closest dish, saying which and what was swapped", () => {
    const cost = (g: string) => ingredientCostAt(g, TODAY);
    const bass = MS.suggestRecipe("Sea bass with lemon butter", "Mains", MENU_ITEMS, cost);
    expect(bass.from?.itemId).toBe("salmon");
    expect(bass.swapped).toEqual({ from: "salmon", to: "hammour" });
    expect(bass.lines.some((l) => l.ingredientId === "hammour")).toBe(true);
    expect(bass.lines.some((l) => l.ingredientId === "salmon")).toBe(false);
    const lob = MS.suggestRecipe("Lobster burger", "Mains", MENU_ITEMS, cost);
    expect(lob.from?.itemId).toBe("burger");
    expect(lob.swapped).toEqual({ from: "wagyu", to: "lobster" });
    expect(MS.suggestRecipe("Chef's surprise", "Mains", MENU_ITEMS, cost).lines).toEqual([]);
  });
  it("costs a new dish at a labelled standard share of its price until the recipe is confirmed", () => {
    expect(MS.standardCost(29, "food")).toBe(8.7);
    expect(MS.standardCost(10, "beverage")).toBe(2.2);
  });
  it("applies modifiers: Double doubles the spirit, No cheese takes the cheese out", () => {
    const mojito = itemById["mojito"].recipe!;
    expect(MS.applyModifiers(mojito, ["double"]).find((l) => l.ingredientId === "rum")!.qty).toBeCloseTo(0.1, 6);
    const burger = itemById["burger"].recipe!;
    const plain = MS.applyModifiers(burger, ["no-cheese"]);
    expect(plain.some((l) => l.ingredientId === "cheddar")).toBe(false);
    expect(plain).toHaveLength(burger.length - 1);
    expect(MS.applyModifiers(burger, [])).toEqual(burger);
  });
  it("syncs once a day at 06:00, archives the removed dish, keeps the new price, and tells the chef", async () => {
    const s = (await MSV.ensureMenuSync())!;
    expect(s.at).toBe(`${TODAY}T06:00`);
    expect(MSV.syncLine(s)).toBe("Menu synced from Simphony at 06:00: 2 new dishes, 1 price change, 1 dish removed");
    expect(s.prices.burger).toBe(24);
    expect(s.archived.kidspasta).toBeTruthy();
    expect(s.newDishes.every((d) => d.status === "needs_recipe" && d.standardCost > 0)).toBe(true);
    expect(loadStore().notify.notices.some((n) => n.type === "menu-new-dish" && n.to === "u-chef" && n.title === "2 new dishes need a recipe")).toBe(true);
    const again = (await MSV.ensureMenuSync())!;
    expect(again.newDishes).toHaveLength(2);
    expect(loadStore().notify.notices.filter((n) => n.type === "menu-new-dish" && n.to === "u-chef")).toHaveLength(1);
  });
  it("the chef confirms a recipe on one screen; roles without recipes cannot; bad lines are refused", async () => {
    const s = (await MSV.ensureMenuSync())!;
    const dish = s.newDishes.find((d) => d.name === "Sea bass with lemon butter")!;
    expect(MSV.confirmRecipe(userById["u-buy"], { posId: dish.posId, lines: dish.suggestion.lines }).ok).toBe(false);
    expect(MSV.confirmRecipe(userById["u-chef"], { posId: dish.posId, lines: [{ ingredientId: "nope", qty: 1 }] }).ok).toBe(false);
    expect(MSV.confirmRecipe(userById["u-chef"], { posId: dish.posId, lines: [{ ingredientId: "hammour", qty: 0 }] }).ok).toBe(false);
    const ok = MSV.confirmRecipe(userById["u-chef"], { posId: dish.posId, lines: dish.suggestion.lines });
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.dish).toMatchObject({ status: "confirmed", confirmed: { by: "u-chef", role: "chef" } });
    expect(MSV.confirmRecipe(userById["u-chef"], { posId: dish.posId, lines: dish.suggestion.lines }).ok).toBe(false);
    const out = await MSV.menuFor(userById["u-chef"]);
    if (!out.ok) throw new Error(out.error);
    expect(out.menu.newDishes.find((d) => d.posId === dish.posId)!.recipeCost).toBeGreaterThan(0);
    // Last night's example: modifiers read from Simphony and what they did.
    expect(out.menu.examples.map((e) => e.modifier).sort()).toEqual(["Double", "No cheese"]);
    expect(out.menu.examples.find((e) => e.modifier === "No cheese")!.used).toBe(0);
    void plusDays;
  });
});

const IP = await import("../server/ingredient-prices");
const FIN = await import("../server/finance");
const REC = await import("../server/records");

describe("Ingredient prices from approved supplier invoices", () => {
  it("the price is the weighted average of approved invoices: quantity times price, over quantity", () => {
    const s = loadStore();
    const lines = FIN.approvedInvoiceLines(s, "lis").filter((l) => l.ingredientId === "salmon" && l.date >= plusDays(TODAY, -IP.PRICE_WINDOW_DAYS));
    expect(lines.length).toBeGreaterThan(1);
    const want = Math.round((lines.reduce((t, l) => t + l.qty * l.price, 0) / lines.reduce((t, l) => t + l.qty, 0)) * 100) / 100;
    const p = IP.priceTable(s, "lis").find((x) => x.ingredientId === "salmon")!;
    expect(p.wac).toBe(want);
    expect(p.basis).toBe("invoices");
    expect(p.effective).toBe(want);
    expect(p.last?.price).toBe(Math.round(lines.at(-1)!.price * 100) / 100);
    expect(p.contract?.price).toBeGreaterThan(0);
  });
  it("only approved or recorded invoices count: one still to check does not", () => {
    const all = FIN.invoicesFor(userById["u-fc"], "lis");
    if (!all.ok) throw new Error(all.error);
    const toCheck = all.invoices.filter((i) => i.status === "to_check");
    expect(toCheck.length).toBeGreaterThan(0);
    const refs = new Set(FIN.approvedInvoiceLines(loadStore(), "lis").map((l) => l.ref));
    for (const i of toCheck) expect(refs.has(i.id)).toBe(false);
  });
  it("a price typed by hand is an override with who, when and why; it can be taken back", () => {
    expect(REC.applyRecord(userById["u-fnb"], { op: { kind: "price.override", ingredientId: "salmon", cost: 30, reason: "" } }).ok).toBe(false);
    expect(REC.applyRecord(userById["u-buy"], { op: { kind: "price.override", ingredientId: "salmon", cost: 30, reason: "New season price" } }).ok).toBe(false);
    const ok = REC.applyRecord(userById["u-fnb"], { op: { kind: "price.override", ingredientId: "salmon", cost: 30, reason: "Supplier raised prices from Monday, invoice not in yet" } });
    expect(ok.ok).toBe(true);
    let p = IP.priceTable(loadStore(), "lis").find((x) => x.ingredientId === "salmon")!;
    expect(p).toMatchObject({ basis: "override", effective: 30, override: { price: 30, by: "u-fnb", role: "fnb_director", reason: "Supplier raised prices from Monday, invoice not in yet" } });
    expect(p.wac).not.toBe(30);
    expect(REC.applyRecord(userById["u-fnb"], { op: { kind: "price.clear", ingredientId: "salmon" } }).ok).toBe(true);
    p = IP.priceTable(loadStore(), "lis").find((x) => x.ingredientId === "salmon")!;
    expect(p.basis).toBe("invoices");
    expect(p.override).toBeNull();
  });
  it("Recipes and Stock levels say how stock is valued", () => {
    expect(IP.PRICE_BASIS).toBe("Valued at weighted average cost from supplier invoices");
    const r = IP.ingredientPricesFor(userById["u-chef"], "lis");
    if (!r.ok) throw new Error(r.error);
    expect(r.basis).toBe(IP.PRICE_BASIS);
    expect(r.mayEdit).toBe(false);
  });
});

const EX = await import("../server/expiry");
const noEntries: import("../server/stock").SessionEntries = { waste: [], counts: [], overrides: [], recipes: [], receipts: [] };

describe("Expiry with action", () => {
  it("Expiring soon is switched on", async () => {
    const { featureOn, linkShown } = await import("../features");
    expect(featureOn("expiry")).toBe(true);
    expect(linkShown("/stock?tab=expiry")).toBe(true);
  });
  it("the use-by date is the received date plus the shelf life, unless the label differed", () => {
    EX.ensureExpiryStory("lis");
    // A dataset delivery: received plus shelf life.
    const plain = EX.batchesFor("lis").find((b) => b.ingredientId === "hammour" && b.source.startsWith("PO-LIS-") && !b.source.includes("EXP"))!;
    expect(plain.useBy).toBe("shelf_life");
    expect(plain.expiry).toBe(plusDays(plain.received, 3));
    // The story's fish: the label said use by tomorrow, sooner than the shelf life, so it was changed on receiving.
    const story = EX.batchesFor("lis").find((b) => b.source.startsWith("PO-LIS-EXP-"))!;
    expect(story).toMatchObject({ useBy: "label", received: TODAY, expiry: plusDays(TODAY, 1) });
    // A use-by typed on receiving that differs from the shelf life is the label's.
    const id = orderFor("u-chef", "salmon", 20);
    approve(id);
    PR.sendApproved("lis");
    const label = plusDays(TODAY, 5);
    const rec = P.actOnRequest(userById["u-store"], id, { action: "receive", lines: [{ ingredientId: "salmon", delivered: 20, batch: "LBL-1", expiry: label }] });
    if (!rec.ok) throw new Error(rec.error);
    expect(EX.batchesFor("lis").find((b) => b.batch === "LBL-1")).toMatchObject({ useBy: "label", expiry: label });
  });
  it("the sea bass from the cancelled lunch is at risk, with a special suggested", () => {
    EX.ensureExpiryStory("lis");
    const r = EX.expiringFor(userById["u-fnb"], "lis", noEntries, 3);
    if (!r.ok) throw new Error("no");
    const bass = r.rows.find((x) => x.source.startsWith("PO-LIS-EXP-"))!;
    expect(bass.daysLeft).toBe(1);
    expect(bass.atRisk).toBe(true);
    expect(bass.action.kind).toBe("special");
    expect(bass.extra).toBeGreaterThan(1);
  });
  it("tonight's special is saved once, with who; the restaurant manager is told (and the chef, when someone else sets it)", () => {
    EX.ensureExpiryStory("lis");
    const r = EX.expiringFor(userById["u-fnb"], "lis", noEntries, 3);
    if (!r.ok) throw new Error("no");
    const bass = r.rows.find((x) => x.source.startsWith("PO-LIS-EXP-"))!;
    expect(EX.decideExpiry(userById["u-buy"], "lis", { kind: "special", ingredientId: "hammour", batch: bass.batch }).ok).toBe(false);
    const d = EX.decideExpiry(userById["u-chef"], "lis", { kind: "special", ingredientId: "hammour", batch: bass.batch, outletId: "lis-terrace" });
    if (!d.ok) throw new Error(d.error);
    expect(d.decision).toMatchObject({ kind: "special", by: "u-chef", qty: bass.extra });
    const notices = loadStore().notify.notices.filter((n) => n.type === "expiry-decision" && n.ref === d.decision.key);
    // The person who set it is not told about their own decision; Mercado's restaurant manager is.
    expect(notices.map((n) => n.to)).not.toContain("u-chef");
    expect(notices.some((n) => userById[n.to]?.role === "restaurant_manager")).toBe(true);
    expect(notices[0].title).toMatch(/^Tonight's special at Mercado/);
    expect(EX.decideExpiry(userById["u-fnb"], "lis", { kind: "move", ingredientId: "hammour", batch: bass.batch, outletId: "lis-ird" }).ok).toBe(false);
    const after = EX.expiringFor(userById["u-fnb"], "lis", noEntries, 3);
    if (!after.ok) throw new Error("no");
    expect(after.rows.find((x) => x.batch === bass.batch)).toMatchObject({ atRisk: false, decision: { kind: "special" } });
  });
  it("a special set by the restaurant manager tells the chef", () => {
    EX.ensureExpiryStory("lis");
    const r = EX.expiringFor(userById["u-fnb"], "lis", noEntries, 3);
    if (!r.ok) throw new Error("no");
    const bass = r.rows.find((x) => x.source.startsWith("PO-LIS-EXP-"))!;
    const d = EX.decideExpiry(userById["u-rm"], "lis", { kind: "special", ingredientId: "hammour", batch: bass.batch, outletId: "lis-terrace" });
    if (!d.ok) throw new Error(d.error);
    expect(loadStore().notify.notices.filter((n) => n.type === "expiry-decision").map((n) => n.to)).toContain("u-chef");
  });
  it("logging a batch as waste writes a shared waste entry with the reason Expired", () => {
    EX.ensureExpiryStory("lis");
    const r = EX.expiringFor(userById["u-fnb"], "lis", noEntries, 3);
    if (!r.ok) throw new Error("no");
    const bass = r.rows.find((x) => x.source.startsWith("PO-LIS-EXP-"))!;
    const d = EX.decideExpiry(userById["u-chef"], "lis", { kind: "waste", ingredientId: "hammour", batch: bass.batch });
    if (!d.ok) throw new Error(d.error);
    expect(loadStore().stockLog.waste.find((w) => w.id === `W-EXP-${bass.batch}-hammour`)).toMatchObject({ reason: "expired", qty: bass.left });
  });
});

const ST = await import("../server/stocktake");
const CR = await import("../domain/count-review");

describe("Stock count variance review before approval", () => {
  it("a completed stock take waits for approval in the demo, counted by purchasing and the storekeeper", () => {
    ST.ensureStockTakeStory("lis");
    const list = ST.stockTakesFor(userById["u-fnb"], "lis");
    if (!list.ok) throw new Error(list.error);
    const t = list.takes.find((x) => x.status === "submitted")!;
    expect(t).toBeTruthy();
    expect(t.report.totals.withDifference).toBe(6);
    expect(t.large).toBeGreaterThanOrEqual(2);
    expect(loadStore().notify.notices.some((n) => n.type === "stocktake-review" && n.ref === t.id && n.to === "u-fnb")).toBe(true);
    ST.ensureStockTakeStory("lis");
    expect((loadStore().stockTakes ?? []).filter((x) => x.status === "submitted")).toHaveLength(1);
  });
  it("each difference has a likely reason by fixed rules, and large ones are marked", () => {
    ST.ensureStockTakeStory("lis");
    const list = ST.stockTakesFor(userById["u-fnb"], "lis");
    if (!list.ok) throw new Error(list.error);
    const t = list.takes.find((x) => x.status === "submitted")!;
    expect(t.review.lamb).toMatchObject({ large: true });
    expect(t.review.lamb.reason).toMatch(/Fresh item|Used without a record/);
    expect(t.review.vodka.reason).toMatch(/Over pouring/);
    expect(t.review.cheddar.reason).toMatch(/More than the system/);
    for (const r of Object.values(t.review)) expect(r.reason).not.toMatch(/theft|fraud|stole|steal|blame|waiter|bartender/i);
  });
  it("the rules: counting error, surplus, short delivery, drinks, fresh, other; large at €50 or 15%", () => {
    const base = { system: 10, area: "dry" as const, shelfLifeDays: 30, deliveryShort: false };
    expect(CR.likelyReason({ ...base, diff: -0.1, value: -2 })).toMatch(/counting error/);
    expect(CR.likelyReason({ ...base, diff: 2, value: 30 })).toMatch(/More than the system/);
    expect(CR.likelyReason({ ...base, diff: -2, value: -30, deliveryShort: true })).toMatch(/came short/);
    expect(CR.likelyReason({ ...base, diff: -2, value: -30, area: "cellar" })).toMatch(/Over pouring/);
    expect(CR.likelyReason({ ...base, diff: -2, value: -30, shelfLifeDays: 3 })).toMatch(/Fresh item/);
    expect(CR.likelyReason({ ...base, diff: -2, value: -30 })).toMatch(/Used without a record/);
    expect(CR.isLarge({ value: -50, diff: -1, system: 100 })).toBe(true);
    expect(CR.isLarge({ value: -20, diff: -2, system: 10 })).toBe(true);
    expect(CR.isLarge({ value: -10, diff: -2, system: 10 })).toBe(false);
  });
  it("the people who counted cannot approve; another manager approves and stock follows the counts", () => {
    ST.ensureStockTakeStory("lis");
    const t = (loadStore().stockTakes ?? []).find((x) => x.status === "submitted")!;
    expect(ST.decideStockTake(userById["u-buy"], t.id, { decision: "approve" }).ok).toBe(false);
    const ok = ST.decideStockTake(userById["u-fnb"], t.id, { decision: "approve", note: "Lamb checked with the chef" });
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.take.status).toBe("approved");
    expect(ok.take.countIds!.length).toBe(t.lines.filter((l) => l.counted !== null).length);
  });
});
