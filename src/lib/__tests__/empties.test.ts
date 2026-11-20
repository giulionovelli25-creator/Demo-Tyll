// Empty bottle scans: the barcodes, which days count from scans, the bottles they give, the story, saving on the server
// with who and which role, who may log and see them, and that Over pouring's totals still add up.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-empties-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const E = await import("../domain/empties");
const { POUR_RULES, POUR_SKUS, figures, perBottle, pourLog } = await import("../domain/pour");
const { getDataset } = await import("../data/generate");
const { pourFor } = await import("../server/pour");
const S = await import("../server/empties");
const { resetDemo } = await import("../server/demo");
const { loadStore, mutateStore } = await import("../server/purchasing-store");
const { STAFF, USERS, userById } = await import("../data/catalog");
const { can } = await import("../domain/access");
const { DEMO_TODAY, DEMO_NOW_MIN, addDays, sum } = await import("../util");
type EmptyScan = import("../domain/empties").EmptyScan;
type PourEntry = import("../domain/pour").PourEntry;

const U = (id: string) => userById[id];
const pour = (id = "u-fnb") => {
  const r = pourFor(U(id), "lis");
  if (!r.ok) throw new Error(r.error);
  return r.pour;
};
const ok = <T,>(r: ({ ok: true } & T) | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const scan = (o: Partial<EmptyScan>): EmptyScan => ({ id: `T-${Math.random()}`, propertyId: "lis", outletId: "lis-lobby", skuId: "red", date: DEMO_TODAY, min: 20 * 60, shift: "evening", by: "AZU-S5", role: "employee", method: "scan", ...o });
const entry = (o: Partial<PourEntry>): PourEntry => ({ date: DEMO_TODAY, outletId: "lis-lobby", shift: "evening", skuId: "red", sold: 0, ml: 0, ...o });

describe("bottle barcodes", () => {
  it("gives every label its own valid EAN-13 in the in-house 29 range, and finds the label by it", () => {
    const codes = Object.values(E.BOTTLE_BARCODE);
    expect(new Set(codes).size).toBe(POUR_SKUS.length);
    for (const code of codes) {
      const d = code.split("").map(Number);
      expect(code).toMatch(/^29\d{11}$/);
      expect(d[12]).toBe((10 - (d.slice(0, 12).reduce((s, x, i) => s + x * (i % 2 ? 3 : 1), 0) % 10)) % 10);
    }
    expect(E.skuByBarcode(` ${E.BOTTLE_BARCODE.red} `)?.id).toBe("red");
    expect(E.skuByBarcode("5601234567890")).toBeUndefined();
  });
});

describe("which days count from scans", () => {
  it("counts an outlet from its first day of scanning, once that day has closed", () => {
    const from = E.scanningFrom([scan({ date: addDays(DEMO_TODAY, -3) }), scan({ date: DEMO_TODAY, outletId: "lis-ird" })]);
    expect(from.get("lis-lobby")).toBe(addDays(DEMO_TODAY, -3));
    // Started today: simulated until tomorrow, so a part day never counts as a whole one.
    expect(from.has("lis-ird")).toBe(false);
  });

  it("ignores scans that were taken back", () => {
    expect(E.scanningFrom([scan({ date: addDays(DEMO_TODAY, -2), withdrawnAt: "x" })]).size).toBe(0);
  });

  it("leaves an outlet that does not scan, and the days before it started, simulated", () => {
    const log = [entry({ date: addDays(DEMO_TODAY, -5), ml: 1500 }), entry({ date: addDays(DEMO_TODAY, -1), ml: 1500 }), entry({ outletId: "lis-ird", date: addDays(DEMO_TODAY, -1), ml: 750 })];
    const out = E.withScans(log, [scan({ date: addDays(DEMO_TODAY, -1) })]);
    expect(out[0].scanned).toBeUndefined();
    expect(out[1].scanned).toBe(1);
    expect(out[2].scanned).toBeUndefined();
  });
});

describe("bottles from scans", () => {
  it("counts the empties plus the open bottle's change, which add up to what was poured", () => {
    const log = pourLog(getDataset().orders);
    const scans = S.seededScans();
    const covered = E.withScans(log, scans).filter((e) => e.scanned !== undefined);
    expect(covered.length).toBeGreaterThan(100);
    const byKey = new Map(log.map((e) => [`${e.date}|${e.outletId}|${e.shift}|${e.skuId}`, e]));
    for (const e of covered) {
      const bottleMl = POUR_SKUS.find((s) => s.id === e.skuId)!.bottleMl;
      expect(e.scanned! + e.part!).toBeCloseTo(byKey.get(`${e.date}|${e.outletId}|${e.shift}|${e.skuId}`)!.ml / bottleMl, 9);
    }
  });

  it("keeps the simulated history's figures: the same flags and the same money as before scans existed", () => {
    const log = pourLog(getDataset().orders);
    const before = figures(log);
    const after = figures(E.withScans(log, S.seededScans()));
    expect(after.sold).toBe(before.sold);
    expect(Math.abs(after.opened - before.opened)).toBeLessThan(1);
    expect(Math.abs(after.gapValue - before.gapValue)).toBeLessThan(before.gapValue * 0.02);
    expect(after.scanned).toBeGreaterThan(0);
  });

  it("does not flag a shift whose empties match the glasses sold", () => {
    // Bar Azulejo started scanning two days ago (a white wine); yesterday's late house red: 10 glasses sold, 2 empties.
    const out = E.withScans([entry({ date: addDays(DEMO_TODAY, -1), sold: 10, ml: 1500 })], [scan({ date: addDays(DEMO_TODAY, -2), skuId: "white" }), scan({ date: addDays(DEMO_TODAY, -1) }), scan({ date: addDays(DEMO_TODAY, -1) })]);
    const f = figures(out.filter((e) => e.skuId === "red"), 1);
    expect(f.scanned).toBe(2);
    expect(f.expected).toBe(10);
    expect(f.flagged).toBe(false);
    expect(f.gapValue).toBe(0);
  });

  it("counts an empty in a shift with no glass sold as a bottle used with nothing billed", () => {
    const out = E.withScans([], [scan({ date: addDays(DEMO_TODAY, -2) }), scan({ date: addDays(DEMO_TODAY, -1) })]);
    expect(out).toHaveLength(2);
    const f = figures(out, 1);
    expect(f.opened).toBe(2);
    expect(f.expected).toBe(2 * perBottle(POUR_SKUS.find((s) => s.id === "red")!));
    expect(f.flagged).toBe(true);
  });
});

describe("the simulated scan history and the story", () => {
  it("scans at Bar Azulejo and Mercado only, by job, never after the demo's clock today", () => {
    const scans = S.seededScans();
    expect(new Set(scans.map((s) => s.outletId))).toEqual(new Set(["lis-lobby", "lis-terrace"]));
    for (const s of scans) {
      expect(s.date >= addDays(DEMO_TODAY, -17)).toBe(true);
      if (s.date === DEMO_TODAY) expect(s.min).toBeLessThan(DEMO_NOW_MIN);
    }
    expect(new Set(scans.map((s) => s.id)).size).toBe(scans.length);
    // Mercado's steward bins most evening empties there.
    const mercadoEvening = scans.filter((s) => s.outletId === "lis-terrace" && s.shift !== "day");
    expect(mercadoEvening.filter((s) => s.by === "MER-S9").length / mercadoEvening.length).toBeGreaterThan(0.5);
  });

  it("shows the house red worked example in the empties: last Friday's late shift at Bar Azulejo comes first", () => {
    const p = pour();
    const top = p.empties.shifts[0];
    const friday = [1, 2, 3, 4, 5, 6, 7].map((n) => addDays(DEMO_TODAY, -n)).find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 5);
    expect(top).toMatchObject({ date: friday, outletId: "lis-lobby", shift: "late", skuId: "red" });
    expect(top.figures.scanned).toBeGreaterThanOrEqual(7);
    expect(top.figures.gapValue).toBeGreaterThan(250);
    expect(top.scans).toHaveLength(top.figures.scanned);
    expect(p.empties.outlets.find((o) => o.outletId === "lis-ird")!.from).toBeNull();
    expect(p.empties.outlets.find((o) => o.outletId === "lis-lobby")!.from).toBe(addDays(DEMO_TODAY, -17));
    expect(p.empties.outlets.find((o) => o.outletId === "lis-terrace")!.from).toBe(addDays(DEMO_TODAY, -9));
  });

  it("holds on every business day of a week", async () => {
    for (let i = 0; i < 7; i++) {
      vi.resetModules();
      process.env.TYLL_DEMO_DATE = addDays("2026-11-16", i);
      const P = await import("../server/pour");
      const C = await import("../data/catalog");
      const r = P.pourFor(C.userById["u-fnb"], "lis");
      if (!r.ok) throw new Error(r.error);
      const top = r.pour.empties.shifts[0];
      expect(top.outletId, process.env.TYLL_DEMO_DATE).toBe("lis-lobby");
      expect(top.skuId).toBe("red");
      expect(top.shift).toBe("late");
      expect(top.figures.gapValue).toBeGreaterThan(250);
      // Only shifts below the threshold with real money are listed; the rest are noise.
      for (const s of r.pour.empties.shifts) expect(s.figures.flagged && s.figures.gapValue >= P.SCANNED_SHIFT_MIN).toBe(true);
    }
    vi.resetModules();
    process.env.TYLL_DEMO_DATE = "2026-10-13";
  });

  it("never says who scanned on Over pouring, not by name and not by job", () => {
    const text = JSON.stringify(pour().empties);
    for (const s of STAFF) expect(text).not.toContain(s.name);
    for (const u of USERS) expect(text).not.toContain(u.name);
    // One supervisor on a bar shift is as good as a name, so the job is left out too, for every role.
    for (const id of ["u-fnb", "u-gm", "u-fc", "u-owner", "u-lby"]) {
      const p = pour(id);
      expect(JSON.stringify(p.empties)).not.toMatch(/Bartender|Supervisor|Steward|Server|Manager|AZU-S|MER-S|"by"/);
      for (const sh of p.empties.shifts) for (const x of sh.scans) expect(Object.keys(x).sort()).toEqual(["method", "min"]);
    }
  });

  it("lists every scanned shift that qualifies, not only the first dozen", () => {
    const from = addDays(DEMO_TODAY, -29);
    const qualifying = E.withScans(pourLog(getDataset().orders), S.seededScans())
      .filter((e) => e.scanned !== undefined && e.date >= from && e.date <= DEMO_TODAY)
      .filter((e) => { const f = figures([e], 1); return f.flagged && f.gapValue >= 50; });
    expect(pour().empties.shifts).toHaveLength(qualifying.length);
  });
});

describe("saving a scan on the server", () => {
  it("saves a picked or scanned bottle with the user, role, business day and shift, once per client id", () => {
    resetDemo(U("u-gm"), "stock");
    const emp = U("u-emp");
    const a = ok(S.logEmpty(emp, { outletId: "lis-terrace", skuId: "white", clientId: "c1" }));
    expect(a.scan).toMatchObject({ outletId: "lis-terrace", skuId: "white", byUser: "u-emp", by: "MER-S9", role: "employee", date: DEMO_TODAY, min: DEMO_NOW_MIN, shift: "evening", method: "pick" });
    expect(ok(S.logEmpty(emp, { outletId: "lis-terrace", skuId: "white", clientId: "c1" })).scan.id).toBe(a.scan.id);
    const b = ok(S.logEmpty(emp, { outletId: "lis-terrace", barcode: E.BOTTLE_BARCODE.vodka }));
    expect(b.scan).toMatchObject({ skuId: "vodka", method: "scan" });
    expect(loadStore().emptyScans).toHaveLength(2);
    expect(ok(S.emptiesFor(emp)).mine.map((m) => m.id)).toEqual([b.scan.id, a.scan.id]);
  });

  it("refuses an unknown barcode, a missing bottle, another outlet and roles without the permission", () => {
    const emp = U("u-emp");
    expect(S.logEmpty(emp, { outletId: "lis-terrace", barcode: "2900000000000" })).toMatchObject({ ok: false, status: 404 });
    expect(S.logEmpty(emp, { outletId: "lis-terrace" })).toMatchObject({ ok: false, status: 400 });
    expect(S.logEmpty(emp, { outletId: "lis-lobby", skuId: "red" })).toMatchObject({ ok: false, status: 403 });
    for (const id of ["u-buy", "u-chef", "u-fc", "u-store", "u-sales"]) expect(S.logEmpty(U(id), { outletId: "lis-terrace", skuId: "red" })).toMatchObject({ ok: false, status: 403 });
    // A restaurant manager logs at their own outlet only.
    expect(S.logEmpty(U("u-rm"), { outletId: "lis-lobby", skuId: "red" })).toMatchObject({ ok: false, status: 403 });
    expect(S.logEmpty(U("u-maid"), { outletId: "lis-terrace", skuId: "red" })).toMatchObject({ ok: false, status: 403 });
    // In-Room Dining pours wine but does not scan its empties: nobody can log one there, so nobody is told it counts.
    expect(S.logEmpty(U("u-fnb"), { outletId: "lis-ird", skuId: "red" })).toMatchObject({ ok: false, status: 409 });
    expect(ok(S.emptiesFor(U("u-fnb"))).outlets.sort()).toEqual(["lis-lobby", "lis-terrace"]);
  });

  it("tells the person Over pouring counts the scan only when it does", () => {
    resetDemo(U("u-gm"), "stock");
    expect(ok(S.logEmpty(U("u-fnb"), { outletId: "lis-lobby", skuId: "red" })).counted).toBe(true);
    expect(ok(S.logEmpty(U("u-emp"), { outletId: "lis-terrace", skuId: "vodka" })).counted).toBe(true);
  });

  it("lets only the person who scanned take it back, once, and keeps it on record", () => {
    resetDemo(U("u-gm"), "stock");
    const a = ok(S.logEmpty(U("u-emp"), { outletId: "lis-terrace", skuId: "red" })).scan;
    expect(S.undoEmpty(U("u-fnb"), { id: a.id })).toMatchObject({ ok: false, status: 404 });
    const back = ok(S.undoEmpty(U("u-emp"), { id: a.id }));
    expect(back.scan.withdrawnBy).toBe("u-emp");
    expect(back.mine).toHaveLength(0);
    expect(S.undoEmpty(U("u-emp"), { id: a.id })).toMatchObject({ ok: false, status: 409 });
    expect(loadStore().emptyScans).toHaveLength(1);
  });

  it("is cleared by the stock reset", () => {
    ok(S.logEmpty(U("u-emp"), { outletId: "lis-terrace", skuId: "red" }));
    resetDemo(U("u-gm"), "stock");
    expect(loadStore().emptyScans).toEqual([]);
  });
});

describe("a new scan on Over pouring", () => {
  it("adds one bottle at an outlet that scans, today, and the totals still add up", () => {
    resetDemo(U("u-gm"), "stock");
    const before = pour();
    ok(S.logEmpty(U("u-fnb"), { outletId: "lis-lobby", skuId: "red" }));
    const after = pour();
    const lobby = (p: typeof before) => p.wine.outlets.find((o) => o.outletId === "lis-lobby")!.periods.today;
    expect(lobby(after).opened).toBeCloseTo(lobby(before).opened + 1, 5);
    expect(lobby(after).scanned).toBe(lobby(before).scanned + 1);
    expect(lobby(after).expected).toBe(lobby(before).expected + 5);
    expect(after.wine.totals.today.gapValue).toBeGreaterThan(before.wine.totals.today.gapValue);
    expect(after.empties.outlets.find((o) => o.outletId === "lis-lobby")!.today).toBe(before.empties.outlets.find((o) => o.outletId === "lis-lobby")!.today + 1);
    for (const p of ["today", "week", "month"] as const) {
      const w = after.wine;
      expect(w.totals[p].sold).toBe(sum(w.outlets, (o) => o.periods[p].sold));
      expect(w.totals[p].opened).toBeCloseTo(sum(w.outlets, (o) => o.periods[p].opened), 5);
      expect(w.totals[p].scanned).toBe(sum(w.rows, (r) => r.periods[p].scanned));
    }
    // Today's point on the 30 day trend moves with it.
    expect(after.wine.daily.at(-1)!.gapValue).toBeGreaterThan(before.wine.daily.at(-1)!.gapValue);
  });

  it("leaves an outlet that does not scan simulated, even with a stray scan on record that the store moved a day on", () => {
    resetDemo(U("u-gm"), "stock");
    const before = pour();
    const ird = (p: typeof before) => p.wine.outlets.find((o) => o.outletId === "lis-ird")!.periods;
    // A scan at In-Room Dining saved before logging there was refused, then the store moved one business day forward.
    const yesterday = addDays(DEMO_TODAY, -1);
    mutateStore((x) => { x.emptyScans = [scan({ id: "ES-IRD-1", outletId: "lis-ird", date: yesterday, byUser: "u-fnb", role: "fnb_director", at: `${yesterday}T20:55:00.000Z` })]; x.businessDate = yesterday; });
    expect(loadStore().emptyScans![0].date).toBe(DEMO_TODAY);
    const after = pour();
    expect(ird(after)).toEqual(ird(before));
    expect(after.wine.totals).toEqual(before.wine.totals);
    const row = after.empties.outlets.find((o) => o.outletId === "lis-ird")!;
    expect(row.from).toBeNull();
    expect(row).not.toHaveProperty("startsTomorrow");
    // Even dated before today it never switches the outlet to scans: one stray empty would otherwise wipe its bottles.
    expect(E.scanningFrom([scan({ outletId: "lis-ird", date: addDays(DEMO_TODAY, -3) })]).has("lis-ird")).toBe(false);
    const log = [entry({ outletId: "lis-ird", date: addDays(DEMO_TODAY, -1), sold: 4, ml: 3000 })];
    expect(E.withScans(log, [scan({ outletId: "lis-ird", date: addDays(DEMO_TODAY, -3) })])).toEqual(log);
    resetDemo(U("u-gm"), "stock");
  });

  it("stops counting a scan that was taken back", () => {
    resetDemo(U("u-gm"), "stock");
    const before = pour();
    const a = ok(S.logEmpty(U("u-fnb"), { outletId: "lis-lobby", skuId: "red" })).scan;
    ok(S.undoEmpty(U("u-fnb"), { id: a.id }));
    expect(pour().wine.totals).toEqual(before.wine.totals);
  });

  it("keeps the flags of Over pouring the same as with simulated bottles", () => {
    resetDemo(U("u-gm"), "stock");
    const p = pour();
    expect(p.wine.flags[0].outletId).toBe("lis-lobby");
    expect(p.wine.flags[0].figures.yieldPer!).toBeLessThan(5 * POUR_RULES.threshold);
  });
});

describe("who logs empties", () => {
  it("gives the permission to the bar and outlet teams and their managers, not to purchasing, the chef or finance", () => {
    for (const id of ["u-emp", "u-fnb", "u-gm", "u-owner", "u-rm", "u-lby"]) expect(E.mayLogEmpty(U(id)), id).toBe(true);
    for (const id of ["u-buy", "u-chef", "u-fc", "u-store", "u-maid", "u-bell", "u-sales"]) expect(E.mayLogEmpty(U(id)), id).toBe(false);
    expect(can(U("u-emp"), "stock.logEmpty")).toBe(true);
    expect(E.pourOutlets(["lis-terrace", "lis-lobby", "lis-ird", "lis-banquets"])).toContain("lis-lobby");
    expect(E.emptyOutlets(["lis-terrace", "lis-lobby", "lis-ird", "lis-banquets"]).sort()).toEqual(["lis-lobby", "lis-terrace"]);
  });
});
