// Overnight feature 8: decisions and corrections saved on the demo server, with the person and the role, and one
// workspace per public demo visitor so prospects never see or overwrite each other's changes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-records-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { userById } = await import("../data/catalog");
const { getDataset, getOutletStock } = await import("../data/generate");
const { BREAKFAST_EXAMPLE_EXCEPTION_ID, COVERS_EXAMPLE_EXCEPTION_ID, TILL_EXAMPLE_EXCEPTION_IDS, TILL_STORY_EXCEPTION_ID } = await import("../data/constants");
const { applyRecordOp, emptyRecords } = await import("../domain/records");
const { listInvestigations } = await import("../domain/metrics");
const { allowedOutlets } = await import("../domain/access");
const { applyRecord, recordsFor, serverEnv, seededHistory } = await import("../server/records");
const { inWorkspace, newWorkspaceId, sweepWorkspaces, workspaceRoot, WORKSPACE_COOKIE, WORKSPACE_TTL_MS } = await import("../server/workspace");
const { loadStore, resetPurchasingStore } = await import("../server/purchasing-store");
const { resetDemo, freshenPublicDemo } = await import("../server/demo");
const { logWasteShared } = await import("../server/stock-log");
const { SESSION_COOKIE, resetAuthStore, startDemoSession, readAudit, audit } = await import("../server/auth");
const { snapshotFor } = await import("../server/snapshot");
const recordsRoute = await import("../../app/api/records/route");
const demoRoute = await import("../../app/api/auth/demo/route");
const { proxy } = await import("../../proxy");
const { DEMO_TODAY } = await import("../util");

const u = (id: string) => userById[id];
const STORY = TILL_STORY_EXCEPTION_ID;
const story = () => getDataset().exceptions.find((e) => e.id === STORY)!;
const close = (key?: string) => ({ key, op: { kind: "investigation.close", id: STORY, input: { outcome: "recovered", confirmedLoss: 0, recovered: story().exposure, note: "Guest came back and paid the lamb chops." } } });
const ok = <T extends { ok: boolean }>(r: T) => { expect(r).toMatchObject({ ok: true }); return r as Extract<T, { ok: true }>; };

beforeEach(() => {
  resetPurchasingStore();
  fs.rmSync(workspaceRoot(), { recursive: true, force: true });
});

describe("the rules (shared by browser and server)", () => {
  it("keeps a decision with the person, the role and the time, and never changes the records it was given", () => {
    const before = emptyRecords();
    const r = applyRecordOp(before, close().op as never, serverEnv(u("u-fnb")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rec.investigations[STORY]).toMatchObject({ status: "closed", outcome: "recovered", recovered: story().exposure, closedBy: "u-fnb", updatedBy: "u-fnb", updatedRole: "fnb_director" });
    expect(r.rec.audit[0]).toMatchObject({ userId: "u-fnb", role: "fnb_director", action: "Investigation closed", ref: STORY });
    expect(before).toEqual(emptyRecords());
  });

  it("refuses what the role or the outlet does not allow, and checks amounts", () => {
    const env = (id: string) => serverEnv(u(id));
    expect(applyRecordOp(emptyRecords(), close().op as never, env("u-chef")).ok).toBe(false); // no flags at all
    expect(applyRecordOp(emptyRecords(), { kind: "investigation.close", id: STORY, input: { outcome: "recovered", confirmedLoss: 0, recovered: story().exposure + 1, note: "Too much." } }, env("u-fnb")).ok).toBe(false);
    expect(applyRecordOp(emptyRecords(), { kind: "investigation.close", id: STORY, input: { outcome: "legitimate", confirmedLoss: 0, recovered: 0, note: "" } }, env("u-fnb")).ok).toBe(false);
    expect(applyRecordOp(emptyRecords(), { kind: "price.set", ingredientId: "coke", cost: 0.9 }, env("u-emp")).ok).toBe(false);
    expect(applyRecordOp(emptyRecords(), { kind: "price.set", ingredientId: "coke", cost: 0 }, env("u-fnb")).ok).toBe(false);
    // The bar manager sees Bar Azulejo only: Mercado's case is not in their data.
    expect(applyRecordOp(emptyRecords(), close().op as never, env("u-lby"))).toMatchObject({ ok: false });
  });

  it("does not flag what is allowed: a price change, a standard and a recount by the right role go through", () => {
    const fnb = serverEnv(u("u-fnb"));
    let rec = emptyRecords();
    for (const op of [
      { kind: "price.set", ingredientId: "coke", cost: 0.92 },
      { kind: "recipe.standard", itemId: "wine", ingredientId: "wine", qty: 0.1875, from: "2026-10-01", reason: "Menu serves 187.5 ml" },
    ] as const) {
      const r = applyRecordOp(rec, op, fnb);
      expect(r.ok).toBe(true);
      if (r.ok) rec = r.rec;
    }
    expect(rec.priceOverrides).toEqual([{ id: "coke", from: DEMO_TODAY, value: 0.92 }]);
    expect(rec.priceLog[0]).toMatchObject({ ingredientId: "coke", by: "u-fnb", role: "fnb_director" });
    expect(rec.recipeChanges[0]).toMatchObject({ by: "u-fnb", role: "fnb_director" });
  });
});

describe("saved on the server", () => {
  it("saves a change once, however often it is sent", () => {
    ok(applyRecord(u("u-fnb"), close("k1")));
    ok(applyRecord(u("u-fnb"), close("k1")));
    const r = loadStore().records!;
    expect(r.audit.filter((a) => a.action === "Investigation closed")).toHaveLength(1);
    expect(r.applied).toEqual(["u-fnb:k1"]);
  });

  it("checks the permission on the server, whatever the browser says", () => {
    expect(applyRecord(u("u-chef"), close())).toMatchObject({ ok: false, status: 403 });
    expect(applyRecord(u("u-buy"), { op: { kind: "price.set", ingredientId: "coke", cost: 0.5 } })).toMatchObject({ ok: false, status: 403 });
    expect(applyRecord(u("u-fnb"), { op: { kind: "drop.everything" } })).toMatchObject({ ok: false, status: 400 });
    expect(applyRecord(u("u-fnb"), {})).toMatchObject({ ok: false, status: 400 });
    expect(loadStore().records!.audit).toHaveLength(0);
  });

  it("never trusts a stock period sent by the browser", () => {
    const real = getOutletStock().periods.find((p) => p.outletId === "lis-terrace")!;
    const forged = { ...real, id: "P-NOPE" };
    expect(applyRecord(u("u-fnb"), { op: { kind: "case.fromPeriod", period: forged } })).toMatchObject({ ok: false, error: "This stock period is not available." });
    // A Bar Azulejo period is outside the Mercado chef's and the Mercado restaurant manager's access.
    const bar = getOutletStock().periods.find((p) => p.outletId === "lis-lobby")!;
    expect(applyRecord(u("u-rm"), { op: { kind: "case.fromPeriod", period: bar } })).toMatchObject({ ok: false });
  });

  it("sends each role only what it may see", () => {
    ok(applyRecord(u("u-fnb"), close()));
    ok(applyRecord(u("u-fnb"), { op: { kind: "price.set", ingredientId: "coke", cost: 0.92 } }));
    ok(applyRecord(u("u-fnb"), { op: { kind: "alert.dismiss", id: "EX-NOTICE" } }));
    const view = (id: string) => recordsFor(u(id)).records;

    expect(view("u-fc").investigations[STORY]).toMatchObject({ status: "closed", updatedRole: "fnb_director" });
    expect(view("u-fc").dismissedAlerts).toEqual([]); // a closed notice is the person's own
    expect(view("u-fnb").dismissedAlerts).toEqual(["EX-NOTICE"]);
    // The head chef and staff see no cases and no prices; purchasing sees prices but no cases.
    for (const id of ["u-chef", "u-emp"]) {
      expect(view(id).investigations).toEqual({});
      expect(view(id).priceOverrides).toEqual([]);
      expect(view(id).audit.some((a) => a.userId === "u-fnb")).toBe(false);
    }
    expect(view("u-buy").investigations).toEqual({});
    expect(view("u-buy").priceOverrides).toHaveLength(1);
    // The bar manager does not get Mercado's decision.
    expect(view("u-lby").investigations[STORY]).toBeUndefined();
    // Roles that keep the audit trail see everyone's changes; others see their own and the cases they can open.
    expect(view("u-fc").audit.map((a) => a.action)).toEqual(expect.arrayContaining(["Investigation closed", "Ingredient price changed"]));
    expect(view("u-buy").audit.some((a) => a.action === "Ingredient price changed")).toBe(false);
    expect(view("u-rm").audit.some((a) => a.ref === STORY && a.role === "fnb_director")).toBe(true);
  });

  it("keeps totals reconciled: one decision moves recovered and open flags by the same amount for every role", () => {
    const fc = u("u-fc");
    const totals = (records: ReturnType<typeof recordsFor>["records"], who = fc) => {
      const snap = snapshotFor(who);
      const list = listInvestigations({ data: { ...getDataset(), exceptions: snap.exceptions, seedInvestigations: snap.seedInvestigations }, waste: [], counts: [], overrides: [], investigations: records.investigations, adjust: { recounts: [], recipes: [], waste: [] } });
      return { open: list.filter((i) => i.status !== "closed").length, recovered: Math.round(list.reduce((s, i) => s + i.recovered, 0) * 100) / 100 };
    };
    const before = totals(recordsFor(fc).records);
    ok(applyRecord(u("u-fnb"), close()));
    const after = totals(recordsFor(fc).records);
    expect(after.open).toBe(before.open - 1);
    expect(after.recovered).toBeCloseTo(before.recovered + story().exposure, 2);
    // The F&B director, who made the change, sees the same figures.
    expect(totals(recordsFor(u("u-fnb")).records, u("u-fnb"))).toEqual(after);
  });

  it("records waste, counts and corrections with the role, in the same trail", () => {
    const r = logWasteShared(u("u-emp"), { outletId: "lis-terrace", ingredientId: "salmon", qty: 1.2, reason: "spoilage" });
    expect(r).toMatchObject({ ok: true, entry: { byUser: "u-emp", role: "employee" } });
    expect(loadStore().records!.audit[0]).toMatchObject({ userId: "u-emp", role: "employee", action: "Waste logged" });
  });

  it("shows who closed the checked examples, agreeing with the seeded cases, also after a reset", () => {
    const h = seededHistory();
    expect(h.map((a) => a.ref).sort()).toEqual([...TILL_EXAMPLE_EXCEPTION_IDS, COVERS_EXAMPLE_EXCEPTION_ID, BREAKFAST_EXAMPLE_EXCEPTION_ID].sort());
    for (const a of h) {
      const st = getDataset().seedInvestigations[a.ref!];
      expect(a).toMatchObject({ userId: st.closedBy, role: "restaurant_manager", action: "Investigation closed" });
      expect(a.at.slice(0, 10)).toBe(st.closedAt);
    }
    expect(recordsFor(u("u-fc")).records.audit.filter((a) => a.action === "Investigation closed")).toHaveLength(h.length);
    ok(resetDemo(u("u-gm"), "all"));
    const after = recordsFor(u("u-fc")).records.audit;
    expect(after[0]).toMatchObject({ action: "Demo data reset", userId: "u-gm", role: "gm" });
    expect(after.slice(1)).toEqual(h);
  });

  it("reset puts the saved records back: all of them, or only the stock ones for the stock story", () => {
    ok(applyRecord(u("u-fnb"), close()));
    ok(applyRecord(u("u-fnb"), { op: { kind: "price.set", ingredientId: "coke", cost: 0.92 } }));
    ok(resetDemo(u("u-gm"), "stock"));
    expect(loadStore().records!.priceOverrides).toEqual([]);
    expect(loadStore().records!.investigations[STORY]).toMatchObject({ status: "closed" });
    ok(resetDemo(u("u-gm"), "all"));
    expect(loadStore().records!.investigations).toEqual({});
  });
});

describe("public demo workspaces", () => {
  beforeEach(() => { vi.stubEnv("TYLL_PUBLIC_DEMO", "on"); resetAuthStore(); });
  afterEach(() => vi.unstubAllEnvs());

  const req = (url: string, cookies: Record<string, string | undefined>, init: { method?: string; body?: unknown } = {}) =>
    new NextRequest(`http://localhost${url}`, {
      method: init.method ?? "GET",
      headers: {
        cookie: Object.entries(cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; "),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        host: "localhost",
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  const session = (id: string) => { const r = startDemoSession(id, "test"); if (!r.ok) throw new Error(r.error); return r.token; };
  const cookieOf = (res: Response, name: string) => new RegExp(`${name}=([^;]+)`).exec(res.headers.get("set-cookie") ?? "")?.[1];
  // Each call runs in its own request context, as Next.js runs each request.
  const get = async (token: string, ws?: string) => (await (await inWorkspace(null, () => recordsRoute.GET(req("/api/records", { [SESSION_COOKIE]: token, [WORKSPACE_COOKIE]: ws })))).json()) as ReturnType<typeof recordsFor>;
  const post = (token: string, ws: string | undefined, body: unknown) => inWorkspace(null, () => recordsRoute.POST(req("/api/records", { [SESSION_COOKIE]: token, [WORKSPACE_COOKIE]: ws }, { method: "POST", body })));

  it("gives each browser its own workspace cookie on the first page, and keeps it", () => {
    const first = proxy(req("/", {}));
    const ws = cookieOf(first, WORKSPACE_COOKIE);
    expect(ws).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first.headers.get("set-cookie")).toMatch(/tyll_ws=[^;]+;.*HttpOnly/i);
    const again = proxy(req("/stock", { [SESSION_COOKIE]: cookieOf(first, SESSION_COOKIE), [WORKSPACE_COOKIE]: ws }));
    expect(cookieOf(again, WORKSPACE_COOKIE)).toBeUndefined();
    // A tampered cookie is replaced, never used as a path.
    expect(cookieOf(proxy(req("/", { [WORKSPACE_COOKIE]: "../../etc" })), WORKSPACE_COOKIE)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("two prospects at the same time never see or overwrite each other's changes", async () => {
    const a = newWorkspaceId(), b = newWorkspaceId();
    const ta = session("u-fnb"), tb = session("u-fnb");
    expect((await post(ta, a, close("x"))).status).toBe(200);
    expect((await get(ta, a)).records.investigations[STORY]).toMatchObject({ status: "closed" });
    expect((await get(tb, b)).records.investigations[STORY]).toBeUndefined();
    // B closes the same case differently; A's decision stays as A made it.
    const legit = { op: { kind: "investigation.close", id: STORY, input: { outcome: "legitimate", confirmedLoss: 0, recovered: 0, note: "Checked: the dishes were sent back." } } };
    expect((await post(tb, b, legit)).status).toBe(200);
    expect((await get(ta, a)).records.investigations[STORY]).toMatchObject({ outcome: "recovered" });
    expect((await get(tb, b)).records.investigations[STORY]).toMatchObject({ outcome: "legitimate" });
    // The shared set is untouched, and each workspace has its own file.
    expect(loadStore().records!.investigations).toEqual({});
    expect(fs.existsSync(path.join(workspaceRoot(), a, "purchasing.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot(), b, "purchasing.json"))).toBe(true);
    // Concurrent requests stay in their own workspace.
    const both = await Promise.all([get(ta, a), get(tb, b), get(ta, a), get(tb, b)]);
    expect(both.map((x) => x.records.investigations[STORY]?.outcome)).toEqual(["recovered", "legitimate", "recovered", "legitimate"]);
  });

  it("keeps the workspace through role switches, refreshes and Back, and no role receives another's data", async () => {
    const ws = newWorkspaceId();
    let token = session("u-fnb");
    expect((await post(token, ws, close())).status).toBe(200);
    expect((await post(token, ws, { op: { kind: "price.set", ingredientId: "coke", cost: 0.92 } })).status).toBe(200);
    const order = ["u-chef", "u-fc", "u-buy", "u-fnb", "u-chef", "u-buy", "u-fc", "u-fnb", "u-buy", "u-chef"];
    for (const id of order) {
      const res = await inWorkspace(null, () => demoRoute.POST(req("/api/auth/demo", { [SESSION_COOKIE]: token, [WORKSPACE_COOKIE]: ws }, { method: "POST", body: { userId: id } })));
      expect(res.status).toBe(200);
      expect(cookieOf(res, WORKSPACE_COOKIE)).toBeUndefined(); // the switch never changes the workspace
      token = cookieOf(res, SESSION_COOKIE)!;
      for (let refresh = 0; refresh < 2; refresh++) {
        const r = (await get(token, ws)).records;
        const role = u(id).role;
        if (role === "chef" || role === "purchasing") expect(r.investigations).toEqual({});
        else expect(r.investigations[STORY]).toMatchObject({ status: "closed", updatedRole: "fnb_director" });
        expect(r.priceOverrides.length).toBe(role === "chef" ? 0 : 1);
        expect(r.dismissedAlerts).toEqual([]);
        // Nothing about a case this role cannot open, and no one else's changes unless the role keeps the audit trail.
        const visible = new Set(snapshotFor(u(id)).exceptions.map((e) => e.id));
        for (const a of r.audit) {
          if (a.ref) expect(visible.has(a.ref)).toBe(true);
          else if (role !== "controller") expect(a.userId).toBe(id);
        }
      }
    }
  });

  it("lets any visitor reset their own workspace, never the shared set or another visitor's", () => {
    const a = newWorkspaceId(), b = newWorkspaceId();
    for (const ws of [a, b]) inWorkspace(ws, () => ok(applyRecord(u("u-fnb"), close())));
    expect(inWorkspace(a, () => resetDemo(u("u-fnb"), "all"))).toMatchObject({ ok: true });
    expect(inWorkspace(a, () => loadStore().records!.investigations)).toEqual({});
    expect(inWorkspace(b, () => loadStore().records!.investigations[STORY])).toMatchObject({ status: "closed" });
    expect(inWorkspace(null, () => resetDemo(u("u-fnb"), "all"))).toMatchObject({ ok: false, status: 403 });
    // The hourly refresh of the shared set never touches a visitor's workspace.
    inWorkspace(b, () => freshenPublicDemo(Date.now() + 2 * 60 * 60 * 1000));
    expect(inWorkspace(b, () => loadStore().records!.investigations[STORY])).toMatchObject({ status: "closed" });
  });

  it("shows each visitor only their own access log", () => {
    const a = newWorkspaceId(), b = newWorkspaceId();
    inWorkspace(a, () => audit("u-fnb", "Signed in", "", "1.1.1.1"));
    inWorkspace(b, () => audit("u-fc", "Signed in", "", "2.2.2.2"));
    expect(inWorkspace(a, () => readAudit()).map((x) => x.ip)).toEqual(["1.1.1.1"]);
    expect(inWorkspace(null, () => readAudit())).toEqual([]);
  });

  it("removes workspaces unused for a day and keeps the ones in use", () => {
    const old = newWorkspaceId(), fresh = newWorkspaceId();
    for (const ws of [old, fresh]) inWorkspace(ws, () => loadStore());
    const past = new Date(Date.now() - WORKSPACE_TTL_MS - 60_000);
    fs.utimesSync(path.join(workspaceRoot(), old, "purchasing.json"), past, past);
    expect(sweepWorkspaces(Date.now(), true)).toEqual([old]);
    expect(fs.existsSync(path.join(workspaceRoot(), old))).toBe(false);
    expect(fs.existsSync(path.join(workspaceRoot(), fresh))).toBe(true);
    // A visitor who comes back after the sweep starts again from the demo data.
    expect(inWorkspace(old, () => loadStore().records!.investigations)).toEqual({});
  });

  it("outside the public demo, the cookie is ignored and everyone at the hotel shares one set of records", async () => {
    vi.stubEnv("TYLL_PUBLIC_DEMO", "");
    const ws = newWorkspaceId();
    // Run the rule directly in a request context that carries a workspace cookie but no public demo.
    const { enterWorkspaceOf } = await import("../server/guard");
    inWorkspace(null, () => {
      enterWorkspaceOf(req("/api/records", { [WORKSPACE_COOKIE]: ws }));
      ok(applyRecord(u("u-fnb"), close()));
    });
    expect(loadStore().records!.investigations[STORY]).toMatchObject({ status: "closed" });
    expect(fs.existsSync(path.join(workspaceRoot(), ws))).toBe(false);
    expect(allowedOutlets(u("u-fnb")).length).toBeGreaterThan(1);
  });
});
