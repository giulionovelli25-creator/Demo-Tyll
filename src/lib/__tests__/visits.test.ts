import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-visits-"));
process.env.TYLL_VISITS_STORE = path.join(dir, "visits.json");
const V = await import("../server/visits");
const A = await import("../server/admin");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";
const ID = "visitor_abcdefghijklmnop";
const at = (iso: string) => new Date(iso);
const view = (p: string, when: string, extra: Partial<Parameters<typeof V.recordView>[0]> = {}) =>
  V.recordView({ visitorId: ID, path: p, consent: true, userAgent: UA, ...extra }, at(when));

beforeEach(() => V.resetVisits());
afterEach(() => vi.unstubAllEnvs());

describe("recording demo visits", () => {
  it("records nothing without a yes, with Global Privacy Control, from bots, or for bad input", () => {
    expect(V.recordView({ visitorId: ID, path: "/stock", consent: false, userAgent: UA }).ok).toBe(false);
    expect(view("/stock", "2026-11-19T10:00:00Z", { gpc: true })).toMatchObject({ ok: true, skipped: expect.any(String) });
    expect(view("/stock", "2026-11-19T10:00:00Z", { userAgent: "Googlebot/2.1" })).toMatchObject({ skipped: "Automated browser." });
    expect(view("/stock", "2026-11-19T10:00:00Z", { visitorId: "x" }).ok).toBe(false);
    expect(view("https://evil.example/", "2026-11-19T10:00:00Z").ok).toBe(false);
    expect(view("/admin/visits", "2026-11-19T10:00:00Z").ok).toBe(false);
    expect(V.loadVisits().views).toHaveLength(0);
  });

  it("keeps only the page and tab, never search words or record ids", () => {
    expect(V.cleanPath("/forecast?tab=approvals&request=PR-LIS-0008&q=salmon")).toBe("/forecast?tab=approvals");
    expect(V.cleanPath("/investigations/EX-123")).toBe("/investigations/:id");
    expect(V.pageName("/forecast?tab=approvals")).toBe("Orders");
    expect(V.pageName("/deliveries")).toBe("Deliveries and invoices");
    expect(V.pageName("/waste")).toBe("Waste and breakage");
  });

  it("groups pages into visits, with the role, the time spent, and one team message per visit", () => {
    view("/", "2026-11-19T10:00:00Z", { sessionUserId: "u-fnb" });
    const second = view("/forecast?tab=approvals", "2026-11-19T10:02:00Z", { sessionUserId: "u-fnb" });
    if (!second.ok || !("viewId" in second)) throw new Error("not recorded");
    expect(V.recordLeave(ID, second.viewId, 75.4)).toEqual({ ok: true });
    expect(V.recordLeave("someone_else_123456", second.viewId, 10).ok).toBe(false); // only the visitor's own views
    view("/waste", "2026-11-19T11:00:00Z"); // 58 minutes later: a new visit
    const s = V.loadVisits();
    expect(s.visits.map((v) => v.views)).toEqual([2, 1]);
    expect(s.views[1]).toMatchObject({ page: "Orders", role: "F&B Director", seconds: 75 });
    const starts = s.alerts.filter((a) => a.kind === "new_visit");
    expect(starts).toHaveLength(2);
    expect(starts[0].text).toBe("New visitor on the demo (Visitor 1), on a computer. First page: Overview, as F&B Director.");
    expect(starts[1].text).toMatch(/^Visitor 1 is back on the demo/);
    // Nothing is configured, so nothing is sent, and the record says so.
    expect(starts.every((a) => a.channel === "log" && a.status === "logged")).toBe(true);
  });

  it("sends yesterday's summary once, on the first view of a new day", () => {
    view("/", "2026-11-19T10:00:00Z");
    view("/waste", "2026-11-19T10:01:00Z");
    view("/", "2026-11-20T09:00:00Z");
    view("/stock", "2026-11-20T09:01:00Z");
    const daily = V.loadVisits().alerts.filter((a) => a.kind === "daily");
    expect(daily).toHaveLength(1);
    expect(daily[0].text).toBe("Demo on 2026-11-19: 1 visitor, 2 page views. Most viewed: Overview (1), Waste and breakage (1).");
  });

  it("reports who is on now, per page and per visit, and exports CSV", () => {
    view("/", "2026-11-19T10:00:00Z", { sessionUserId: "u-buy" });
    view("/forecast?tab=toorder", "2026-11-19T10:01:00Z", { sessionUserId: "u-buy" });
    V.recordView({ visitorId: "second_visitor_abcdefg", path: "/", consent: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile" }, at("2026-11-19T10:03:00Z"));
    const r = V.visitReport(7, at("2026-11-19T10:04:00Z"));
    expect(r.totals).toMatchObject({ onNow: 2, visitorsToday: 2, viewsToday: 3, visitors: 2, visits: 2, views: 3 });
    expect(r.pages[0]).toMatchObject({ page: "Overview", views: 2, visitors: 2 });
    expect(r.visits[0]).toMatchObject({ visitor: "Visitor 2", device: "phone", live: true });
    expect(r.visits[1].path.map((p) => p.page)).toEqual(["Overview", "To order"]);
    expect(r.roles).toEqual([{ role: "Purchasing Manager", views: 2 }]);
    expect(r.delivery).toBe("Not configured");
    const csv = V.visitsCsv(7, at("2026-11-19T10:04:00Z")).split("\n");
    expect(csv[0]).toBe("time,visitor,device,visit,page,address,role,seconds");
    expect(csv).toHaveLength(4);
    expect(csv.join("\n")).not.toContain(ID); // the random id stays on the server
  });

  it("erases a visitor who withdraws, and deletes records after 90 days", () => {
    view("/", "2026-08-01T10:00:00Z");
    V.recordView({ visitorId: "other_visitor_abcdefg", path: "/", consent: true, userAgent: UA }, at("2026-11-19T10:00:00Z"));
    expect(V.loadVisits().views.map((v) => v.visitorId)).toEqual(["other_visitor_abcdefg"]); // the August view was older than 90 days
    view("/stock", "2026-11-19T10:05:00Z");
    expect(V.eraseVisitor(ID)).toEqual({ ok: true, erased: 1 });
    const s = V.loadVisits();
    expect(s.views.every((v) => v.visitorId !== ID)).toBe(true);
    expect(s.visitors[ID]).toBeUndefined();
    // Numbers are never reused: the next new visitor is not given an erased visitor's number.
    view("/", "2026-11-19T11:00:00Z");
    expect(V.loadVisits().visitors[ID].n).toBe(4); // 1 was deleted after 90 days, 2 is the other visitor, 3 was erased
  });

  it("marks a message sent only when Slack accepts it, and failed otherwise", async () => {
    vi.stubEnv("TYLL_SLACK_WEBHOOK_URL", "https://hooks.slack.test/abc");
    const r = view("/", "2026-11-19T10:00:00Z");
    if (!r.ok || !("viewId" in r)) throw new Error("not recorded");
    expect(r.alerts[0]).toMatchObject({ channel: "slack", status: "queued" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await V.deliverAlerts(r.alerts.map((a) => a.id));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(V.loadVisits().alerts[0]).toMatchObject({ status: "sent" });
    const r2 = view("/", "2026-11-19T12:00:00Z");
    if (!r2.ok || !("viewId" in r2)) throw new Error("not recorded");
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
    await V.deliverAlerts(r2.alerts.map((a) => a.id));
    expect(V.loadVisits().alerts.at(-1)).toMatchObject({ status: "failed", detail: "Slack answered 500." });
    fetchMock.mockRestore();
  });
});

describe("the visits page lock", () => {
  const req = (host: string, extra: Record<string, string> = {}) => new NextRequest(`http://${host}/api/admin/visits`, { headers: { host, ...extra } });

  it("without a key, opens only on this computer", () => {
    expect(A.isAdmin(req("localhost:3210"))).toBe(true);
    expect(A.isAdmin(req("demo.tyll.ai"))).toBe(false);
    expect(A.isAdmin(req("localhost:3210", { "x-forwarded-for": "::1" }))).toBe(true); // Next.js adds the caller's own address
    expect(A.isAdmin(req("localhost:3210", { "x-forwarded-for": "127.0.0.1, ::ffff:127.0.0.1" }))).toBe(true);
    expect(A.isAdmin(req("localhost:3210", { "x-forwarded-for": "203.0.113.9" }))).toBe(false);
    expect(A.isAdmin(req("localhost:3210", { "x-forwarded-for": "203.0.113.9, 127.0.0.1" }))).toBe(false);
  });

  it("with a key, opens only with the cookie for that key", () => {
    vi.stubEnv("TYLL_ADMIN_KEY", "correct-horse-battery");
    expect(A.isAdmin(req("localhost:3210"))).toBe(false);
    expect(A.adminCookieFor("wrong")).toBeNull();
    const cookie = A.adminCookieFor("correct-horse-battery")!;
    expect(A.isAdmin(req("demo.tyll.ai", { cookie: `${A.ADMIN_COOKIE}=${cookie}` }))).toBe(true);
    expect(A.isAdmin(req("demo.tyll.ai", { cookie: `${A.ADMIN_COOKIE}=forged` }))).toBe(false);
  });
});
