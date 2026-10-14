import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-fin-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { loadStore, resetPurchasingStore } = await import("../server/purchasing-store");
const F = await import("../server/finance");
const P = await import("../server/purchasing");
const { stockFor, cleanEntries } = await import("../server/stock");
const { userById } = await import("../data/catalog");
const { BUDGETS } = await import("../data/finance-rules");

const U = (id: string) => userById[id];
const sara = U("u-rm"), buyer = U("u-buy"), priya = U("u-fc"), gm = U("u-gm"), owner = U("u-owner"), omar = U("u-emp"), store = U("u-store"), elena = U("u-acc-doh"), sales = U("u-sales");
const ok = <T,>(r: ({ ok: true } & T) | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r; };
const status = (r: { ok: boolean }) => (r.ok ? 200 : (r as unknown as { status: number }).status);
const row = (p: string, d: string) => F.budgetRows(loadStore(), p).find((b) => b.dept === d)!;

beforeEach(() => resetPurchasingStore());

/** Sara asks for chicken; it goes through purchasing, accounting and, when large, the GM. */
function approvedChicken(qty = 30) {
  const r = ok(P.saveRequest(sara, { propertyId: "dxb", period: "tomorrow", lines: [{ ingredientId: "chicken", qty }] })).request;
  ok(P.actOnRequest(sara, r.id, { action: "submit" }));
  for (let i = 0; i < 4; i++) {
    const st = loadStore().requests.find((x) => x.id === r.id)!.status;
    if (st === "approved") break;
    ok(P.actOnRequest(st === "purchasing" ? buyer : st === "accounting" ? priya : gm, r.id, { action: st, decision: "approve", comment: "Checked" }));
  }
  return loadStore().requests.find((x) => x.id === r.id)!;
}

describe("Scenario A: approval, receipt, invoice and spending stages", () => {
  it("never treats an approval as an expense; only a recorded invoice becomes one", () => {
    const before = row("dxb", "fnb");
    const r = approvedChicken();
    expect(r.poNumber).toBeTruthy();
    const afterApproval = row("dxb", "fnb");
    expect(afterApproval.recorded).toBe(before.recorded);
    expect(afterApproval.committed).toBeGreaterThan(before.committed);
    // Stage 3 sees the same figure as Finance.
    const b = P.budgetFor(r);
    expect(b.budget).toBe(BUDGETS.dxb.fnb);
    // The approval screen leaves the request itself out, then subtracts it as "left after this request".
    expect(b.available - r.lines[0].qty * r.lines[0].unitPrice).toBeCloseTo(afterApproval.remainingIfSpent, 2);

    // A storekeeper receives 28 of 30; the supplier invoices 30.
    ok(P.actOnRequest(store, r.id, { action: "receive", received: [{ ingredientId: "chicken", qty: 28 }] }));
    expect(status(P.actOnRequest(store, r.id, { action: "receive" }))).toBe(409);
    expect(F.invoicesFor(priya).ok && ok(F.invoicesFor(priya)).toInvoice.some((t) => t.requestId === r.id)).toBe(true);
    const inv = ok(F.recordInvoice(priya, { requestId: r.id, supplierId: r.lines[0].supplierId, supplierRef: "GPM-48213", lines: [{ ingredientId: "chicken", qty: 30, unitPrice: r.lines[0].unitPrice }] })).invoice;
    expect(status(F.recordInvoice(priya, { requestId: r.id, supplierId: r.lines[0].supplierId, supplierRef: "GPM-48214", lines: [{ ingredientId: "chicken", qty: 30, unitPrice: 1 }] }))).toBe(409);
    expect(inv.status).toBe("to_check");
    expect(inv.lines[0].issues).toContain("invoiced_not_delivered");
    expect(inv.overcharge).toBeCloseTo(2 * r.lines[0].unitPrice, 2);
    expect(row("dxb", "fnb").recorded).toBe(before.recorded);

    // Approving with the difference open needs a reason; a corrected invoice clears it.
    expect(status(F.invoiceAction(priya, inv.id, { action: "approve" }))).toBe(409);
    ok(F.invoiceAction(priya, inv.id, { action: "flag", note: "2 kg short on delivery" }));
    ok(F.invoiceAction(priya, inv.id, { action: "request_correction", note: "Please invoice 28 kg" }));
    const fixed = ok(F.invoiceAction(priya, inv.id, { action: "record_correction", lines: [{ ingredientId: "chicken", qty: 28, unitPrice: r.lines[0].unitPrice }] })).invoice;
    expect(fixed.status).toBe("matched");
    expect(loadStore().finance.invoices.find((i) => i.id === inv.id)!.original![0].qty).toBe(30);
    expect(status(F.invoiceAction(priya, inv.id, { action: "post" }))).toBe(409);
    ok(F.invoiceAction(priya, inv.id, { action: "approve" }));
    ok(F.invoiceAction(priya, inv.id, { action: "post" }));
    const after = row("dxb", "fnb");
    expect(after.recorded).toBeCloseTo(before.recorded + 28 * r.lines[0].unitPrice, 2);
    // Nothing is double counted across the stages.
    expect(after.recorded + after.invoices + after.committed).toBeCloseTo(before.recorded + before.invoices + before.committed + 28 * r.lines[0].unitPrice, 2);
  });

  it("finds the dataset's chicken invoice for more than was delivered, and states it as a difference", () => {
    const inv = ok(F.invoiceById(priya, "INV-DXB-1011-MEAT")).invoice;
    const l = inv.lines.find((x) => x.ingredientId === "chicken")!;
    expect(l.invoiced).toBeGreaterThan(l.received);
    expect(inv.status).toBe("to_check");
    expect(inv.overcharge).toBeGreaterThan(0);
  });
});

describe("currency, stages and permissions", () => {
  it("keeps each hotel in its own currency and never mixes them", () => {
    const d = ok(F.financeReport(priya, { propertyId: "dxb" }) as { ok: true; currency: string; entries: { propertyId: string }[] });
    const q = ok(F.financeReport(priya, { propertyId: "doh" }) as { ok: true; currency: string; entries: { propertyId: string }[] });
    expect(d.currency).toBe("AED");
    expect(q.currency).toBe("QAR");
    expect(d.entries.every((e) => e.propertyId === "dxb")).toBe(true);
    expect(q.entries.every((e) => e.propertyId === "doh")).toBe(true);
  });

  it("separates recorded spending from invoices and commitments", () => {
    for (const b of F.budgetRows(loadStore(), "dxb")) {
      expect(b.remaining).toBeCloseTo(b.budget - b.recorded, 2);
      expect(b.remainingIfSpent).toBeCloseTo(b.budget - b.recorded - b.invoices - b.committed, 2);
    }
    expect(row("dxb", "hk").recorded).toBeCloseTo(8400 + 3150 + 6200, 2);
  });

  it("refuses finance to staff, sales and purchasing, and other hotels to a hotel accountant", () => {
    for (const u of [omar, store, sales, buyer, sara]) expect(status(F.invoicesFor(u))).toBe(403);
    expect(status(F.invoiceById(elena, "INV-DXB-1011-MEAT"))).toBe(404);
    expect(status(F.invoiceAction(elena, "INV-DXB-1011-MEAT", { action: "flag", note: "x x x" }))).toBe(404);
    expect(status(F.invoiceAction(owner, "INV-DXB-1011-MEAT", { action: "flag", note: "x x x" }))).toBe(403);
    expect(ok(F.financeHome(owner)).approvals).toBe(0);
    expect(status(F.financeReport(elena, { propertyId: "dxb" }))).toBe(403);
    const r = approvedChicken(5);
    expect(status(P.actOnRequest(omar, r.id, { action: "receive" }))).toBe(404);
  });

  it("raises stock only on receipt, once", () => {
    const qty = () => stockFor(sara, "dxb", cleanEntries(sara, {})).find((x) => x.ingredientId === "chicken")!.estimated;
    const start = qty();
    const r = approvedChicken(12);
    expect(qty()).toBeCloseTo(start, 6);
    ok(P.actOnRequest(store, r.id, { action: "receive", received: [{ ingredientId: "chicken", qty: 10 }] }));
    expect(qty()).toBeCloseTo(start + 10, 6);
    expect(status(P.actOnRequest(buyer, r.id, { action: "receive" }))).toBe(409);
    expect(qty()).toBeCloseTo(start + 10, 6);
  });
});
