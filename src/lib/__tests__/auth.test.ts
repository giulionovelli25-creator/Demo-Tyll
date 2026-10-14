import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A private store for these tests, created before the auth module reads its settings.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-auth-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { AUTH_POLICY, SESSION_COOKIE, demoAccounts, login, resetAuthStore, resolveSession, verifyPin, lockSession, logout } = await import("../server/auth");
const { snapshotFor, orderById, ordersOnDate, ordersWithItem, searchOrders } = await import("../server/snapshot");
const { proxy } = await import("../../proxy");
const dataRoute = await import("../../app/api/data/route");
const orderRoute = await import("../../app/api/orders/[id]/route");
const loginRoute = await import("../../app/api/auth/login/route");
const { userById } = await import("../data/catalog");
const { getDataset } = await import("../data/generate");

const creds = (userId: string) => demoAccounts().find((a) => a.userId === userId)!;
const signIn = (userId: string) => {
  const r = login(creds(userId).email, creds(userId).password, "test");
  if (!r.ok) throw new Error(r.error);
  return r.token;
};
const req = (url: string, token?: string, init: { method?: string; body?: unknown; origin?: string } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.origin ? { origin: init.origin } : {}),
      host: "localhost",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

beforeAll(() => resetAuthStore());
beforeEach(() => resetAuthStore());
afterEach(() => vi.useRealTimers());

describe("stored secrets", () => {
  it("keeps only salted verifiers, never the passwords or PINs", () => {
    const raw = fs.readFileSync(process.env.TYLL_AUTH_STORE!, "utf8");
    for (const a of demoAccounts()) {
      expect(raw).not.toContain(a.password);
      expect(raw).not.toContain(`"${a.pin}"`);
    }
    expect(raw).toContain("scrypt$");
  });
});

describe("sign-in", () => {
  it("accepts the right password and gives the same answer for a wrong password or an unknown email", () => {
    expect(login(creds("u-owner").email, creds("u-owner").password, "t").ok).toBe(true);
    const wrong = login(creds("u-owner").email, "nope", "t");
    const unknown = login("nobody@grandresorts.example", "nope", "t");
    expect(wrong.ok || unknown.ok).toBe(false);
    if (!wrong.ok && !unknown.ok) expect(wrong.error).toBe(unknown.error);
  });

  it("locks the account after repeated wrong passwords, even against the right one", () => {
    for (let i = 0; i < AUTH_POLICY.loginMaxFailures; i++) login(creds("u-gm").email, "wrong", "t");
    const blocked = login(creds("u-gm").email, creds("u-gm").password, "t");
    expect(blocked).toMatchObject({ ok: false, status: 429 });
    vi.useFakeTimers({ now: Date.now() + AUTH_POLICY.loginLockMs + 1000 });
    expect(login(creds("u-gm").email, creds("u-gm").password, "t").ok).toBe(true);
  });

  it("refuses cross-site sign-in requests", async () => {
    const res = await loginRoute.POST(req("/api/auth/login", undefined, { method: "POST", body: { email: creds("u-owner").email, password: creds("u-owner").password }, origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
});

describe("PIN", () => {
  it("is required for management roles and not for operational staff", () => {
    expect(resolveSession(signIn("u-owner"))).toMatchObject({ pinRequired: true, pinUnlocked: false });
    expect(resolveSession(signIn("u-emp"))).toMatchObject({ pinRequired: false, pinUnlocked: true });
  });

  it("unlocks with the right PIN and counts down wrong ones", () => {
    const token = signIn("u-rm");
    expect(verifyPin(token, "0000", "t")).toMatchObject({ ok: false, attemptsLeft: AUTH_POLICY.pinMaxFailures - 1 });
    expect(verifyPin(token, creds("u-rm").pin, "t")).toEqual({ ok: true });
    expect(resolveSession(token)?.pinUnlocked).toBe(true);
  });

  it("ends the session and blocks PIN entry after too many wrong PINs", () => {
    const token = signIn("u-fc");
    for (let i = 0; i < AUTH_POLICY.pinMaxFailures - 1; i++) verifyPin(token, "0000", "t");
    expect(verifyPin(token, "0000", "t")).toMatchObject({ ok: false, status: 429, signedOut: true });
    expect(resolveSession(token)).toBeNull();
    const again = signIn("u-fc");
    expect(verifyPin(again, creds("u-fc").pin, "t")).toMatchObject({ ok: false, status: 429 });
  });

  it("re-locks after the idle limit, and on request", () => {
    const token = signIn("u-owner");
    verifyPin(token, creds("u-owner").pin, "t");
    vi.useFakeTimers({ now: Date.now() + AUTH_POLICY.pinIdleMs + 1000 });
    expect(resolveSession(token)).toMatchObject({ pinUnlocked: false });
    vi.useRealTimers();
    verifyPin(token, creds("u-owner").pin, "t");
    lockSession(token, "t");
    expect(resolveSession(token)?.pinUnlocked).toBe(false);
  });

  it("expires idle sessions and ends them on sign-out", () => {
    const token = signIn("u-gm");
    vi.useFakeTimers({ now: Date.now() + AUTH_POLICY.sessionIdleMs + 1000 });
    expect(resolveSession(token)).toBeNull();
    vi.useRealTimers();
    const t2 = signIn("u-gm");
    logout(t2, "t");
    expect(resolveSession(t2)).toBeNull();
  });
});

describe("protected data", () => {
  it("refuses data without a session, and without a PIN for management roles", async () => {
    expect((await dataRoute.GET(req("/api/data"))).status).toBe(401);
    const token = signIn("u-owner");
    expect((await dataRoute.GET(req("/api/data", token))).status).toBe(423);
    verifyPin(token, creds("u-owner").pin, "t");
    expect((await dataRoute.GET(req("/api/data", token))).status).toBe(200);
  });

  it("sends an outlet manager only their outlet's records", () => {
    const snap = snapshotFor(userById["u-rm"]);
    expect(new Set(snap.dayItems.map((r) => r.outletId))).toEqual(new Set(["dxb-terrace"]));
    expect(snap.exceptions.every((e) => e.outletId === "dxb-terrace")).toBe(true);
    expect(snap.rooms).toHaveLength(0);
    expect(snap.roomCharges.every((c) => c.outletId === "dxb-terrace")).toBe(true);
    // Counts of Maison Lune's own store stay with Lune.
    expect(snap.counts.some((c) => ["lobster", "truffle", "tenderloin"].includes(c.ingredientId))).toBe(false);
    expect(snapshotFor(userById["u-gm"]).counts.some((c) => c.ingredientId === "tenderloin")).toBe(true);
  });

  it("sends operational staff quantities but no sales, costs or cases", () => {
    const snap = snapshotFor(userById["u-emp"]);
    expect(snap.dayItems.length).toBeGreaterThan(0);
    expect(snap.dayItems.every((r) => r.gross === 0 && r.discounts === 0)).toBe(true);
    expect(snap.exceptions).toHaveLength(0);
    expect(snap.roomCharges).toHaveLength(0);
    expect(snap.deliveries.every((d) => d.lines.every((l) => l.poPrice === 0 && l.invoicePrice === 0))).toBe(true);
  });

  it("hides orders outside a user's outlets, with the same answer as a missing order", async () => {
    const lune = getDataset().orders.find((o) => o.outletId === "dxb-lune")!;
    const terrace = getDataset().orders.find((o) => o.outletId === "dxb-terrace")!;
    const manager = userById["u-rm"];
    expect(orderById(manager, lune.id)).toBeNull();
    expect(orderById(manager, terrace.id)?.id).toBe(terrace.id);
    expect(orderById(userById["u-emp"], terrace.id)).toBeNull();
    expect(ordersOnDate(manager, terrace.date).every((o) => o.outletId === "dxb-terrace")).toBe(true);
    expect(ordersWithItem(manager, "burger", "2026-10-07", "2026-10-13", ["dxb-lune", "dxb-pool"])).toHaveLength(0);
    expect(searchOrders(manager, "MLN-")).toHaveLength(0);

    const token = signIn("u-rm");
    verifyPin(token, creds("u-rm").pin, "t");
    const params = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await orderRoute.GET(req(`/api/orders/${lune.id}`, token), params(lune.id))).status).toBe(404);
    expect((await orderRoute.GET(req("/api/orders/NOPE", token), params("NOPE"))).status).toBe(404);
    expect((await orderRoute.GET(req(`/api/orders/${terrace.id}`, token), params(terrace.id))).status).toBe(200);
  });
});

describe("page guard", () => {
  const where = (res: Response) => (res.headers.get("location") ? new URL(res.headers.get("location")!).pathname : null);

  it("sends signed-out visitors to sign in", () => {
    expect(where(proxy(req("/money")))).toBe("/login");
  });

  it("keeps each role to the pages it may open", () => {
    const staff = signIn("u-emp");
    expect(where(proxy(req("/money", staff)))).toBe("/staff");
    expect(where(proxy(req("/", staff)))).toBe("/staff");
    expect(where(proxy(req("/finance", staff)))).toBe("/staff");
    expect(where(proxy(req("/staff", staff)))).toBeNull();
    expect(where(proxy(req("/stock", staff)))).toBeNull();
    const manager = signIn("u-rm");
    expect(where(proxy(req("/rooms", manager)))).toBeNull();
    expect(where(proxy(req("/money", signIn("u-maid"))))).toBe("/staff");
    expect(where(proxy(req("/finance", manager)))).toBe("/");
    expect(where(proxy(req("/finance", signIn("u-buy"))))).toBe("/forecast");
    expect(where(proxy(req("/investigations", manager)))).toBeNull();
  });
});
