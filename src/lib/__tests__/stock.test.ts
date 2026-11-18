import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-stock-"));
process.env.TYLL_AUTH_STORE = path.join(dir, "auth.json");
process.env.TYLL_PURCHASING_STORE = path.join(dir, "purchasing.json");

const { SESSION_COOKIE, demoAccounts, login, resetAuthStore, verifyPin } = await import("../server/auth");
const { stockFor, forecastFor } = await import("../server/stock");
const stockRoute = await import("../../app/api/stock/route");
const forecastRoute = await import("../../app/api/forecast/route");
const { userById } = await import("../data/catalog");
const { getDataset } = await import("../data/generate");
const { stockPosition } = await import("../domain/inventory");
const { buildForecast, defaultInputs } = await import("../domain/forecast");

const none = { waste: [], counts: [], overrides: [], recipes: [], receipts: [] };
const sara = userById["u-rm"];
const owner = userById["u-owner"];
const d = getDataset();
const full = { dayItems: d.dayItems, counts: d.counts, deliveries: d.deliveries, transfers: d.transfers, waste: d.wasteLogs };

const creds = (id: string) => demoAccounts().find((a) => a.userId === id)!;
const session = (id: string) => {
  const r = login(creds(id).email, creds(id).password, "t");
  if (!r.ok) throw new Error(r.error);
  if (creds(id).pin) verifyPin(r.token, creds(id).pin!, "t");
  return r.token;
};
const post = (url: string, token: string, body: unknown, origin = "http://localhost") =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json", origin, host: "localhost" }, body: JSON.stringify(body) });

beforeEach(() => resetAuthStore());

describe("shared stock", () => {
  it("gives a manager the same shared-store figures as the full calculation", () => {
    const truth = new Map(stockPosition("lis", full).map((r) => [r.ingredientId, r.estimated]));
    const rows = stockFor(sara, "lis", none);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.estimated).toBeCloseTo(truth.get(r.ingredientId)!, 6);
    const chicken = rows.find((r) => r.ingredientId === "chicken");
    if (chicken) expect(chicken.estimated).toBeCloseTo(truth.get("chicken")!, 6);
  });

  it("keeps every item in the shared storeroom: no outlet has its own store", () => {
    // Maison Lune and its own store were removed; lobster is now drawn from the main storeroom by every outlet that sells it.
    const ownerRows = stockFor(owner, "lis", none);
    expect(ownerRows.every((r) => r.store === null)).toBe(true);
    const lobster = ownerRows.find((r) => r.ingredientId === "lobster")!;
    expect(lobster.usage).toBeCloseTo(stockPosition("lis", full).find((r) => r.ingredientId === "lobster")!.usage, 6);
    expect(stockFor(sara, "lis", none).some((r) => r.store !== null)).toBe(false);
  });

  it("shares out count differences only across the user's own outlets", () => {
    for (const r of stockFor(sara, "lis", none)) expect(Object.keys(r.allocation).every((id) => id === "lis-terrace")).toBe(true);
  });
});

describe("purchase suggestions", () => {
  it("gives Sara the same suggestions as the full calculation for her ingredients", () => {
    const truth = buildForecast(d, full, "lis", defaultInputs(d, "lis"));
    const mine = forecastFor(sara, "lis", undefined, none).forecast;
    expect(mine.plans.filter((p) => p.suggested > 0).length).toBeGreaterThan(0);
    for (const p of mine.plans) expect(p.suggested).toBeCloseTo(truth.plans.find((t) => t.ingredientId === p.ingredientId)!.suggested, 6);
    // Item-level sales forecasts stay limited to her outlet.
    const terraceItems = new Set(d.dayItems.filter((r) => r.outletId === "lis-terrace").map((r) => r.itemId));
    expect(mine.items.every((i) => terraceItems.has(i.itemId))).toBe(true);
  });
});

describe("stock routes", () => {
  it("allows the user's own hotel and refuses others, cross-site calls and staff on forecasts", async () => {
    const rm = session("u-rm");
    expect((await stockRoute.POST(post("/api/stock", rm, { propertyId: "lis" }))).status).toBe(200);
    expect((await stockRoute.POST(post("/api/stock", rm, { propertyId: "doh" }))).status).toBe(403);
    expect((await stockRoute.POST(post("/api/stock", rm, { propertyId: "lis" }, "https://evil.example"))).status).toBe(403);
    expect((await forecastRoute.POST(post("/api/forecast", rm, { propertyId: "lis" }))).status).toBe(200);
    const staff = session("u-emp");
    expect((await forecastRoute.POST(post("/api/forecast", staff, { propertyId: "lis" }))).status).toBe(403);
  });
});

describe("where did it go", () => {
  const varianceRoute = () => import("../../app/api/variance/route");
  const get = (url: string, token: string) => new NextRequest(`http://localhost${url}`, { headers: { cookie: `${SESSION_COOKIE}=${token}`, host: "localhost" } });

  it("sends a manager only their own outlets' periods, and refuses staff and other hotels", async () => {
    const { GET } = await varianceRoute();
    const rm = session("u-rm");
    const res = await GET(get("/api/variance?propertyId=lis", rm));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { periods: { outletId: string }[] };
    expect(body.periods.length).toBeGreaterThan(0);
    expect(body.periods.every((p) => p.outletId === "lis-terrace")).toBe(true);
    expect((await GET(get("/api/variance?propertyId=doh", rm))).status).toBe(403);
    expect((await GET(get("/api/variance?id=UP-AZU-wine-1012-1440", rm))).status).toBe(404);
    expect((await GET(get("/api/variance?propertyId=lis", session("u-emp")))).status).toBe(403);
    const owner = (await (await GET(get("/api/variance?propertyId=lis", session("u-owner")))).json()) as { periods: { outletId: string }[] };
    expect(new Set(owner.periods.map((p) => p.outletId)).size).toBeGreaterThan(1);
  });
});
