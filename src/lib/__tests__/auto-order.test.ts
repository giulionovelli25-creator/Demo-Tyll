import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-auto-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { resetPurchasingStore, loadStore } = await import("../server/purchasing-store");
const A = await import("../server/auto-order");
const P = await import("../server/purchasing");
const { userById } = await import("../data/catalog");
const { DEMO_TODAY, addDays } = await import("../util");

const none: import("../server/stock").SessionEntries = { waste: [], counts: [], overrides: [], recipes: [], receipts: [] };
const marco = userById["u-fnb"];

beforeEach(() => resetPurchasingStore());

describe("automatic ordering", () => {
  it("orders items due today or tomorrow once a day, one order per supplier, at the prediction's quantities", () => {
    const before = P.monthPlanFor(marco, "lis", none);
    if (!before.ok) throw new Error(before.error);
    const due = before.plan.items.filter((i) => i.orderBy !== null && i.orderBy <= addDays(DEMO_TODAY, 1) && i.nextQty > 0 && !["lobster", "wagyu"].includes(i.ingredientId));
    const run = A.ensureAutoRun("lis", none)!;
    expect(run.date).toBe(DEMO_TODAY);
    const orders = loadStore().requests.filter((r) => run.requestIds.includes(r.id));
    expect(orders.every((r) => r.auto)).toBe(true);
    expect(new Set(orders.map((r) => r.lines[0].supplierId)).size).toBe(orders.length);
    for (const r of orders) expect(new Set(r.lines.map((l) => l.supplierId)).size).toBe(1);
    expect(orders.flatMap((r) => r.lines.map((l) => l.ingredientId)).sort()).toEqual(due.map((i) => i.ingredientId).sort());
    for (const l of orders.flatMap((r) => r.lines)) expect(l.qty).toBe(due.find((i) => i.ingredientId === l.ingredientId)!.nextQty);
    // A second call the same day does nothing new.
    const again = A.ensureAutoRun("lis", none)!;
    expect(again.requestIds).toEqual(run.requestIds);
    expect(loadStore().requests.filter((r) => r.auto).length).toBe(orders.length);
  });

  it("sends only orders under the limit with nothing to review; the rest wait for purchasing", () => {
    const run = A.ensureAutoRun("lis", none)!;
    const orders = loadStore().requests.filter((r) => run.requestIds.includes(r.id));
    for (const r of orders) {
      const total = P.requestTotal(r);
      if (r.auto!.decision === "sent") {
        expect(total).toBeLessThanOrEqual(1500);
        expect(r.status).toBe("approved");
        expect(r.poNumber).toBeTruthy();
        // Sent as a full purchase order: PDF kept, email logged, catalogue pack and VAT on its lines.
        expect(r.sent?.pdf).toMatch(/\.pdf$/);
        expect(r.lines.every((l) => l.vatRate !== undefined && !!l.packLabel)).toBe(true);
        expect(r.supplierId).toBeTruthy();
      } else {
        expect(r.status).toBe("purchasing");
        expect(r.auto!.why.length).toBeGreaterThan(5);
      }
    }
  });

  it("never orders the items kept for ordering by hand, and orders nothing when off", () => {
    const run = A.ensureAutoRun("lis", none)!;
    const lines = loadStore().requests.filter((r) => run.requestIds.includes(r.id)).flatMap((r) => r.lines.map((l) => l.ingredientId));
    expect(lines).not.toContain("lobster");
    expect(lines).not.toContain("wagyu");
    resetPurchasingStore();
    const off = A.saveAutoSettings(marco, "lis", { on: false });
    expect(off.ok).toBe(true);
    expect(A.ensureAutoRun("lis", none)).toBeNull();
    expect(loadStore().requests.some((r) => r.auto)).toBe(false);
  });

  it("only the F&B director, purchasing or the general manager may change the rules, within the offered choices", () => {
    expect(A.saveAutoSettings(userById["u-rm"], "lis", { sendUnder: 5000 }).ok).toBe(false);
    expect(A.saveAutoSettings(marco, "lis", { sendUnder: 999999 }).ok).toBe(false);
    const ok = A.saveAutoSettings(userById["u-buy"], "lis", { sendUnder: 500, never: ["lobster"] });
    expect(ok.ok && ok.settings.sendUnder).toBe(500);
  });
});
