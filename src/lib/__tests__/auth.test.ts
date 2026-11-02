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
    expect(where(proxy(req("/finance", signIn("u-buy"))))).toBe("/stock");
    expect(where(proxy(req("/investigations", manager)))).toBeNull();
  });
});

describe("public demo (TYLL_PUBLIC_DEMO=on)", () => {
  const demoRoute = () => import("../../app/api/auth/demo/route");
  const where = (res: Response) => res.headers.get("location") && new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search;
  const cookieOf = (res: Response) => /tyll_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  beforeEach(() => vi.stubEnv("TYLL_PUBLIC_DEMO", "on"));
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless the flag is set: the welcome page and the demo route are closed", async () => {
    vi.stubEnv("TYLL_PUBLIC_DEMO", "");
    expect(where(proxy(req("/welcome")))).toBe("/login");
    const res = await (await demoRoute()).POST(req("/api/auth/demo", undefined, { method: "POST", body: {} }));
    expect(res.status).toBe(403);
    expect(where(proxy(req("/forecast?tab=buy")))).toBe("/login?next=%2Fforecast%3Ftab%3Dbuy");
  });

  it("sends new visitors to the welcome screen instead of sign-in", () => {
    expect(where(proxy(req("/")))).toBe("/welcome");
    expect(where(proxy(req("/login")))).toBe("/welcome");
    expect(where(proxy(req("/welcome")))).toBeNull();
  });

  it("enters as the Purchasing Manager with no PIN, and switches only between allowed roles", async () => {
    const { POST } = await demoRoute();
    const res = await POST(req("/api/auth/demo", undefined, { method: "POST", body: {} }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { id: "u-buy" }, home: "/stock" });
    const token = cookieOf(res)!;
    const view = resolveSession(token)!;
    expect(view.user.id).toBe("u-buy");
    expect(view.pinRequired).toBe(false);

    const chef = await POST(req("/api/auth/demo", token, { method: "POST", body: { userId: "u-chef" } }));
    expect((await chef.json()).home).toBe("/stock");
    expect(resolveSession(token)).toBeNull(); // the previous session ends on a switch
    expect(resolveSession(cookieOf(chef)!)!.user.id).toBe("u-chef");

    expect((await POST(req("/api/auth/demo", undefined, { method: "POST", body: { userId: "u-owner" } }))).status).toBe(403);
    expect((await POST(req("/api/auth/demo", undefined, { method: "POST", body: {}, origin: "https://evil.example" }))).status).toBe(403);
  });

  it("opens deep links directly, as a role that may see the page", () => {
    const first = proxy(req("/forecast?tab=buy"));
    expect(where(first)).toBe("/forecast?tab=buy");
    expect(resolveSession(cookieOf(first)!)!.user.id).toBe("u-buy");
    const cases: [string, string][] = [["/stock", "u-chef"], ["/money", "u-fc"], ["/finance?tab=invoices", "u-fc"], ["/events", "u-fnb"], ["/rooms", "u-gm"], ["/staff", "u-emp"], ["/investigations", "u-fnb"]];
    for (const [url, id] of cases) expect(resolveSession(cookieOf(proxy(req(url)))!)!.user.id).toBe(id);
    // A role that may already open the page keeps its session.
    const fnb = cookieOf(proxy(req("/events")))!;
    expect(where(proxy(req("/stock", fnb)))).toBeNull();
    // Finance links switch to the role that reconciles invoices.
    const gm = cookieOf(proxy(req("/rooms")))!;
    expect(resolveSession(cookieOf(proxy(req("/finance?tab=invoices", gm)))!)!.user.id).toBe("u-fc");
    // Purchasing links switch away from a role that only approves.
    const fc = cookieOf(proxy(req("/finance")))!;
    expect(resolveSession(cookieOf(proxy(req("/forecast?tab=buy", fc)))!)!.user.id).toBe("u-buy");
    // Home changes to a role that may see it, because Home is one click from anywhere.
    const buyer = cookieOf(proxy(req("/forecast")))!;
    expect(resolveSession(cookieOf(proxy(req("/", buyer)))!)!.user.id).toBe("u-fnb");
  });
});

describe("public demo freshness", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("returns shared records to the start at most once an hour", async () => {
    vi.stubEnv("TYLL_PUBLIC_DEMO", "on");
    const { freshenPublicDemo } = await import("../server/demo");
    const { loadStore, mutateStore } = await import("../server/purchasing-store");
    const t = 10_000_000_000_000;
    freshenPublicDemo(t);
    const clean = loadStore().stockLog.waste.length;
    mutateStore((x) => { x.stockLog.waste.push({ ...x.stockLog.waste[0], id: "W-TEST" }); });
    freshenPublicDemo(t + 30 * 60 * 1000);
    expect(loadStore().stockLog.waste.length).toBe(clean + 1);
    freshenPublicDemo(t + 61 * 60 * 1000);
    expect(loadStore().stockLog.waste.length).toBe(clean);
  });
});
