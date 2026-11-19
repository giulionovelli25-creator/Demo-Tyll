import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-proc-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const D = await import("../domain/procurement");
const { resetPurchasingStore, loadStore } = await import("../server/purchasing-store");
const P = await import("../server/purchasing");
const X = await import("../server/procurement");
const E = await import("../server/procurement-export");
const F = await import("../server/finance");
const { stockFor } = await import("../server/stock");
const { ean13 } = await import("../server/procurement-seed");
const { userById } = await import("../data/catalog");
const { approvalSteps } = await import("../data/purchasing-rules");
const { DEMO_TODAY, addDays, fmtMoney } = await import("../util");

type Entries = import("../server/stock").SessionEntries;
const none: Entries = { waste: [], counts: [], overrides: [], recipes: [], receipts: [] };
const U = (id: string) => userById[id];
const ok = <T,>(r: ({ ok: true } & T) | { ok: false; status: number; error: string }): T => { if (!r.ok) throw new Error(`${r.status}: ${r.error}`); return r as T; };

beforeEach(() => resetPurchasingStore());

describe("par levels", () => {
  it("lists an item once stock is below its minimum, with the quantity back to the maximum in whole packs", () => {
    expect(D.parTrigger(3, 0, { min: 5, max: 12 }, 2)).toEqual({ below: true, qty: 10, covered: false });
    expect(D.parTrigger(3, 9, { min: 5, max: 12 }, 2)).toEqual({ below: true, qty: 0, covered: true });
    expect(D.parTrigger(5, 0, { min: 5, max: 12 }, 2).below).toBe(false);
  });
  it("suggests levels from use, lead time and the order cycle", () => {
    expect(D.suggestPar(2, 1, 2, 1, 1)).toEqual({ min: 4, max: 8 });
    expect(D.suggestPar(2, 1, 2, 1, 5)).toEqual({ min: 5, max: 10 });
  });
});

describe("purchase order totals and VAT", () => {
  it("adds VAT per rate on the net of the lines", () => {
    const t = D.orderTotals([{ qty: 10, unitPrice: 10, vatRate: 0.06 }, { qty: 2, unitPrice: 25, vatRate: 0.23 }]);
    expect(t).toEqual({ net: 150, vat: 17.5, gross: 167.5, rates: [{ rate: 0.06, net: 100, vat: 6 }, { rate: 0.23, net: 50, vat: 11.5 }] });
  });
  it("uses 5% in the UAE and 15% in Saudi Arabia, and formats AED and SAR", () => {
    const lines = [{ qty: 4, unitPrice: 250, vatRate: D.VAT_SCHEMES.AE.rates.food }];
    expect(D.orderTotals(lines).vat).toBe(50);
    expect(D.orderTotals([{ qty: 4, unitPrice: 250, vatRate: D.VAT_SCHEMES.SA.rates.drinks }]).vat).toBe(150);
    expect(fmtMoney(1234, "AED")).toBe("AED 1,234");
    expect(fmtMoney(1234.5, "SAR", { decimals: true })).toBe("SAR 1,234.50");
    expect(D.VAT_SCHEMES.AE.currency).toBe("AED");
    expect(D.VAT_SCHEMES.SA.currency).toBe("SAR");
  });
  it("rounds to packs and writes them as people order them", () => {
    expect(D.ceilToPack(13, 6)).toBe(18);
    expect(D.packsText(48, 12, "Case of 12", "units")).toBe("4 × Case of 12 (48 units)");
    expect(D.packLabelFor("each", 24)).toBe("Case of 24");
  });
});

describe("approval limits", () => {
  it("purchasing always reviews; accounting every order; the F&B director above €2,000; the general manager above €5,000", () => {
    expect(approvalSteps("lis", 1500)).toEqual(["purchasing", "accounting"]);
    expect(approvalSteps("lis", 2500)).toEqual(["purchasing", "accounting", "fnb"]);
    expect(approvalSteps("lis", 6000)).toEqual(["purchasing", "accounting", "fnb", "manager"]);
    expect(D.approvalStepsFor(2000, { accountingAbove: 0, fnbAbove: 2000, managerAbove: 5000 })).toEqual(["purchasing", "accounting"]);
  });
});

describe("receiving and the three way match", () => {
  it("adds deliveries up, keeps damaged goods out of stock and leaves the rest outstanding", () => {
    const lines = [{ ingredientId: "chicken", qty: 20, suggested: 20, requirement: 0, available: 0, incoming: 0, safety: 0, supplierId: "meat", unitPrice: 10 }];
    const one = D.applyReceipt(lines, [D.receiptLine("chicken", 12, 2)]);
    expect(one[0]).toMatchObject({ received: 10, damaged: 2 });
    expect(D.outstanding(one[0])).toBe(10);
    const two = D.applyReceipt(one, [D.receiptLine("chicken", 10)]);
    expect(D.fullyReceived(two)).toBe(true);
  });
  it("flags a short delivery and a price above the order and the agreed price, in units and money", () => {
    const m = D.threeWay([{ ingredientId: "tenderloin", ordered: 40, received: 36, damaged: 0, invoiced: 40, orderPrice: 60, invoicePrice: 62.5, agreedPrice: 60 }]);
    expect(m.lines[0].flags).toEqual(["short", "invoiced_not_received", "price_above_order", "price_above_agreed"]);
    expect(m.lines[0].unitsOver).toBe(4);
    expect(m.qtyMoney).toBe(250);
    expect(m.priceMoney).toBe(90);
    expect(m.difference).toBe(340);
    const c = D.creditLines(m.lines, () => "Beef", () => "kg", (n) => `€${n}`);
    expect(c.amount).toBe(340);
    expect(c.lines.map((l) => l.reason)).toEqual(["short", "price"]);
  });
  it("names units invoiced but refused as damaged", () => {
    const m = D.threeWay([{ ingredientId: "salmon", ordered: 10, received: 8, damaged: 2, invoiced: 10, orderPrice: 30, invoicePrice: 30 }]);
    const c = D.creditLines(m.lines, () => "Salmon", () => "kg", String);
    expect(c.lines).toMatchObject([{ reason: "damaged", qty: 2, amount: 60 }]);
  });
  it("names the status of a purchase order at every step", () => {
    expect(D.poStatus({ status: "fnb" })).toBe("waiting");
    expect(D.poStatus({ status: "approved" })).toBe("approved");
    expect(D.poStatus({ status: "approved", sentAt: "x" })).toBe("sent");
    expect(D.poStatus({ status: "approved", sentAt: "x", receipts: [{ id: "g", at: "x", by: "u", final: false, lines: [D.receiptLine("x", 1)] }] })).toBe("partly_received");
    expect(D.poStatus({ status: "received" })).toBe("received");
    expect(D.poStatus({ status: "received", closed: { at: "x", by: "u", note: "n" } })).toBe("closed");
  });
});

describe("stock valuation", () => {
  const lots = [{ date: "2026-10-01", qty: 10, price: 10 }, { date: "2026-10-05", qty: 10, price: 12 }];
  it("values stock at weighted average cost, FIFO or last purchase price", () => {
    expect(D.valueOnHand(15, lots, "wac", 9).value).toBe(165);
    expect(D.valueOnHand(15, lots, "fifo", 9).value).toBe(170);
    expect(D.valueOnHand(15, lots, "last", 9).value).toBe(180);
  });
  it("values stock older than the recorded purchases at the standard cost under FIFO", () => {
    expect(D.valueOnHand(25, lots, "fifo", 9).value).toBe(265);
    expect(D.valueOnHand(5, [], "wac", 9)).toEqual({ value: 45, unitCost: 9 });
  });
  it("follows the method set for the hotel, and only the controller or general manager may change it", () => {
    expect(X.savePurchasingSettings(U("u-rm"), "lis", { valuation: "fifo" }).ok).toBe(false);
    ok(X.savePurchasingSettings(U("u-fc"), "lis", { valuation: "fifo" }));
    expect(X.valuationMethod("lis")).toBe("fifo");
    const rows = stockFor(U("u-fnb"), "lis", none);
    expect(rows.every((r) => Number.isFinite(r.value) && r.valuationCost >= 0)).toBe(true);
  });
});

describe("supplier delivery days and codes", () => {
  it("counts an order after the cut-off from the next day, then moves to the supplier's next delivery day", () => {
    expect(D.nextDeliveryDate("2026-11-18", 15 * 60, "14:00", 1, [1, 3, 5])).toBe("2026-11-20");
    expect(D.nextDeliveryDate("2026-11-18", 15 * 60, "14:00", 1, [2, 4])).toBe("2026-11-24");
    expect(D.nextDeliveryDate("2026-11-18", 9 * 60, "14:00", 1, [4])).toBe("2026-11-19");
  });
  it("makes valid EAN-13 barcodes in the in-house 29 range", () => {
    const code = ean13(420);
    const digits = code.split("").map(Number);
    const check = (10 - (digits.slice(0, 12).reduce((s, d, i) => s + d * (i % 2 ? 3 : 1), 0) % 10)) % 10;
    expect(code).toMatch(/^29\d{11}$/);
    expect(digits[12]).toBe(check);
  });
  it("lets the same item come from different suppliers at different hotels: catalogues are per hotel", () => {
    const c = X.catalogueFor("lis", "chicken");
    expect(c.length).toBeGreaterThan(1);
    expect(c[0].preferred).toBe(true);
    expect(c.every((l) => l.propertyId === "lis")).toBe(true);
    expect(X.catalogueFor("other-hotel", "chicken")).toEqual([]);
  });
});

describe("a purchase order keeps its catalogue lines", () => {
  it("saving or submitting a draft keeps the agreed price, pack and VAT, rounds to packs, and refuses another supplier's item", () => {
    const nadia = U("u-buy");
    const po = ok(X.createPurchaseOrders(nadia, "lis", [{ ingredientId: "wine", qty: 27 }], { source: "par" })).orders[0];
    const before = po.lines[0];
    expect(before).toMatchObject({ vatRate: 0.23, packSize: 9, packLabel: "Case of 12 × 75 cl" });
    const saved = ok(P.saveRequest(nadia, { id: po.id, lines: [{ ingredientId: "wine", qty: 30, supplierId: "wine" }] })).request;
    expect(saved.lines[0]).toMatchObject({ qty: 36, unitPrice: before.unitPrice, vatRate: 0.23, packLabel: "Case of 12 × 75 cl" });
    expect(P.saveRequest(nadia, { id: po.id, lines: [{ ingredientId: "wine", qty: 27 }, { ingredientId: "chicken", qty: 10 }] }).ok).toBe(false);
    ok(P.actOnRequest(nadia, po.id, { action: "submit" }));
    expect(P.actOnRequest(nadia, po.id, { action: "purchasing", decision: "approve", changes: [{ ingredientId: "wine", supplierId: "bev-alt", reason: "cheaper" }] }).ok).toBe(false);
  });
});

describe("end to end: low stock to a credit request", () => {
  it("stock below the minimum, PO, approvals, email with PDF, short delivery, dearer invoice, both differences flagged, credit drafted", () => {
    const sara = U("u-rm"), nadia = U("u-buy"), priya = U("u-fc"), marco = U("u-fnb"), ahmed = U("u-store");
    // 1. Stock falls below the minimum: spoiled beef is logged.
    const before = ok(X.parsFor(sara, "lis", none)).rows.find((r) => r.ingredientId === "wagyu" && r.location === "main")!;
    expect(before.below).toBe(false);
    const spoiled = Math.round((before.onHand - before.min + 1) * 10) / 10;
    const entries: Entries = { ...none, waste: [{ id: "w-e2e", outletId: "lis-terrace", date: DEMO_TODAY, ingredientId: "wagyu", qty: spoiled, reason: "spoilage", by: "MER-S7", synced: true, seq: 1 }] };
    const toOrder = ok(X.toOrderFor(sara, "lis", entries)).rows.find((r) => r.ingredientId === "wagyu")!;
    expect(toOrder.below).toBe(true);
    expect(toOrder.qty).toBeGreaterThan(0);
    expect(toOrder.qty).toBe(D.ceilToPack(toOrder.max - toOrder.onHand - toOrder.onOrder, toOrder.packSize));

    // 2. One click: a draft purchase order for the supplier, raised for a banquet to 50 kg.
    const made = ok(X.createPurchaseOrders(sara, "lis", [{ ingredientId: "wagyu", qty: Math.max(50, toOrder.qty) }], { source: "par" }));
    expect(made.orders).toHaveLength(1);
    const po = made.orders[0];
    expect(po).toMatchObject({ status: "draft", supplierId: "meat", costCentre: "4100 F&B food" });
    expect(po.deliveryDate! > DEMO_TODAY).toBe(true);
    expect(po.lines[0]).toMatchObject({ vatRate: 0.06, packLabel: expect.any(String) });
    const net = D.orderTotals(po.lines).net;
    expect(net).toBeGreaterThan(2000);
    expect(net).toBeLessThan(5000);

    // 3. Approval: purchasing, accounting, then the F&B director because it is over €2,000. Nobody approves their own order.
    ok(P.actOnRequest(sara, po.id, { action: "submit" }));
    ok(P.actOnRequest(nadia, po.id, { action: "purchasing", decision: "approve" }));
    expect(loadStore().requests.find((r) => r.id === po.id)!.status).toBe("accounting");
    ok(P.actOnRequest(priya, po.id, { action: "accounting", decision: "approve" }));
    expect(loadStore().requests.find((r) => r.id === po.id)!.status).toBe("fnb");
    expect(P.actOnRequest(nadia, po.id, { action: "fnb", decision: "approve" }).ok).toBe(false);
    ok(P.actOnRequest(marco, po.id, { action: "fnb", decision: "approve" }));
    const approved = loadStore().requests.find((r) => r.id === po.id)!;
    expect(D.poStatus(approved)).toBe("approved");
    expect(approved.poNumber).toBeTruthy();

    // 4. Sent by email with the PDF, and a copy kept. Logged, not sent, in the demo.
    const sent = ok(X.sendPurchaseOrder(nadia, po.id));
    expect(D.poStatus(sent.request)).toBe("sent");
    expect(sent.email).toMatchObject({ to: "encomendas@carnes-ribeiro.example", status: "logged" });
    const pdf = ok(X.readPurchaseOrderPdf(nadia, po.id));
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.bytes.toString("latin1")).toContain(approved.poNumber);
    expect(X.sendPurchaseOrder(nadia, po.id).ok).toBe(false);

    // 5. Partly received: 5 kg short. Stock rises by what was accepted, the rest stays on order.
    const stockBefore = stockFor(sara, "lis", entries).find((r) => r.ingredientId === "wagyu")!.estimated;
    ok(P.actOnRequest(ahmed, po.id, { action: "receive", lines: [{ ingredientId: "wagyu", delivered: 45, damaged: 0, batch: "CR-4471", expiry: addDays(DEMO_TODAY, 5) }] }));
    const partly = loadStore().requests.find((r) => r.id === po.id)!;
    expect(D.poStatus(partly)).toBe("partly_received");
    expect(partly.lines[0].received).toBe(45);
    const stockAfter = stockFor(sara, "lis", entries).find((r) => r.ingredientId === "wagyu")!.estimated;
    expect(Math.round((stockAfter - stockBefore) * 1000) / 1000).toBe(45);

    // 6. The invoice arrives for all 50 kg, at a higher price than agreed.
    const agreed = partly.lines[0].unitPrice;
    const inv = ok(F.recordInvoice(priya, { requestId: po.id, supplierId: "meat", supplierRef: "CRF-88213", lines: [{ ingredientId: "wagyu", qty: 50, unitPrice: agreed + 2.5 }] }));
    expect(inv.invoice.status).toBe("to_check");

    // 7. The three way match flags both differences, in units and money.
    const m = X.matchFor(priya, po.id);
    if (!m.ok) throw new Error(m.error);
    const line = m.match.lines[0];
    expect(line.flags).toEqual(expect.arrayContaining(["short", "invoiced_not_received", "price_above_order", "price_above_agreed"]));
    expect(line.unitsOver).toBe(5);
    expect(m.match.qtyMoney).toBe(Math.round(5 * (agreed + 2.5) * 100) / 100);
    expect(m.match.priceMoney).toBe(112.5);

    // The order still opens with its budget once an invoice is recorded against it.
    expect(F.budgetForRequest("lis", "fnb", po.id).budget).toBeGreaterThan(0);

    // 8. The credit request is drafted from those differences.
    const credit = ok(X.draftCredit(priya, po.id)).credit;
    expect(credit.amount).toBe(Math.round((5 * (agreed + 2.5) + 112.5) * 100) / 100);
    expect(credit.lines.map((l) => l.reason)).toEqual(["short", "price"]);
    expect(credit.body).toContain(approved.poNumber);
    expect(credit.status).toBe("draft");

    // The export carries the order, the receipt and the invoice.
    const pos = ok(E.exportDocuments(nadia, "lis", "purchase_orders")).documents;
    expect(pos.some((d) => d.po_number === approved.poNumber && d.status === "partly_received")).toBe(true);
    const receipts = ok(E.exportDocuments(nadia, "lis", "receipts")).documents;
    expect(receipts.find((d) => d.po_number === approved.poNumber)!.lines[0]).toMatchObject({ delivered: 45, accepted: 45, batch: "CR-4471" });
    const invoices = ok(E.exportDocuments(priya, "lis", "invoices")).documents;
    const row = invoices.find((d) => d.supplier_invoice_number === "CRF-88213")!;
    expect((row.lines[0] as Record<string, number>).difference).toBe(Math.round((50 * (agreed + 2.5) - 45 * agreed) * 100) / 100);
    expect(E.toCsv("receipts", receipts).split("\n")[0]).toBe(E.EXPORT_FIELDS.receipts.map((f) => f.name).join(","));
    expect(E.exportDocuments(U("u-rm"), "lis", "invoices").ok).toBe(false);
  });
});

describe("the export field list document", () => {
  it("names every exported field, so the mapping document never drifts from the code", () => {
    const doc = fs.readFileSync(path.join(process.cwd(), "docs", "procurement-export.md"), "utf8");
    for (const kind of Object.keys(E.EXPORT_FIELDS) as (keyof typeof E.EXPORT_FIELDS)[]) for (const f of E.EXPORT_FIELDS[kind]) expect(doc, `${kind}.${f.name}`).toContain(`\`${f.name}\``);
  });
});
