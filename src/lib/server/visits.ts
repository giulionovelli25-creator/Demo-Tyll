// Demo visits: which pages visitors open, how long they stay and in which role, so the Tyll team can see what interests
// prospects. Recorded only after the visitor says yes in the consent banner (the browser sends nothing before that), and
// a Global Privacy Control signal counts as no. No name, email, IP address or browser fingerprint is stored: a visitor is
// a random id their browser made after saying yes. Records older than 90 days are deleted. A visitor can withdraw, which
// erases everything recorded for them.
// Kept in its own file, apart from the demo records, so the hourly demo reset never wipes it.
import fs from "node:fs";
import path from "node:path";
import { userById } from "../data/catalog";
import { activeItem } from "../nav";
import { DEMO_TIME_ZONE } from "../util";
import { PUBLIC_DEMO_ROLES } from "./auth";
import { dataFile } from "./data-file";

export const RETENTION_DAYS = 90;
/** A new visit starts after this long without a page view. */
export const SESSION_GAP_MS = 30 * 60 * 1000;
/** Visitors seen this recently count as on the demo now. */
export const LIVE_MS = 5 * 60 * 1000;
const MAX_VIEWS_PER_DAY = 600;
/** The day a visit counts towards. The demo hotel's zone unless the team sets its own. */
const ZONE = process.env.TYLL_TEAM_TIME_ZONE || DEMO_TIME_ZONE;

export type Device = "phone" | "tablet" | "computer";
export interface Visitor { id: string; n: number; firstSeen: string; lastSeen: string; device: Device }
export interface Visit { id: string; visitorId: string; start: string; lastAt: string; views: number }
export interface View { id: string; visitorId: string; visitId: string; at: string; path: string; page: string; role?: string; seconds?: number }
export type AlertStatus = "logged" | "queued" | "sent" | "failed";
export interface VisitAlert { id: string; at: string; kind: "new_visit" | "daily"; text: string; channel: "slack" | "email" | "log"; status: AlertStatus; detail?: string }
export interface VisitShape { seq: number; visitorSeq: number; visitors: Record<string, Visitor>; visits: Visit[]; views: View[]; alerts: VisitAlert[]; summaries: string[] }

const empty = (): VisitShape => ({ seq: 0, visitorSeq: 0, visitors: {}, visits: [], views: [], alerts: [], summaries: [] });
const file = () => process.env.TYLL_VISITS_STORE ?? dataFile("visits.json");

export function loadVisits(): VisitShape {
  try {
    return { ...empty(), ...(JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<VisitShape>) };
  } catch {
    return empty();
  }
}

function save(s: VisitShape) {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

function mutate<T>(run: (s: VisitShape) => T): T {
  const s = loadVisits();
  const out = run(s);
  save(s);
  return out;
}

export const resetVisits = () => save(empty());

// ---- What is recorded ------------------------------------------------------------------------------------------------

const VISITOR_ID = /^[A-Za-z0-9_-]{16,64}$/;
const BOT = /bot|crawl|spider|slurp|headless|preview|lighthouse|facebookexternalhit|embedly|monitor/i;

export const deviceOf = (ua: string): Device => (/ipad|tablet/i.test(ua) ? "tablet" : /mobi|iphone|android/i.test(ua) ? "phone" : "computer");

/** Only the page, never the rest of the address: no search words, ids or anything a visitor typed. The tab is kept. */
export function cleanPath(raw: string): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.length > 300) return null;
  const u = new URL(raw, "http://x");
  const tab = u.searchParams.get("tab");
  const base = u.pathname.replace(/\/(PR|PO|EX|ST|INV|GR)-[\w-]+/gi, "/:id");
  return tab && /^[a-z_]{1,24}$/.test(tab) ? `${base}?tab=${tab}` : base;
}

const EXTRA: Record<string, string> = {
  "/investigations": "Money Back List", "/investigations/:id": "A Money Back case", "/count": "Stock count", "/more": "Other tools",
  "/settings": "Settings", "/welcome": "Welcome", "/finance": "Invoices and reconciliation", "/events": "Events", "/rooms": "Rooms", "/staff": "Tyll Staff",
};

/** The page's name as the menu shows it. */
export function pageName(clean: string): string {
  const [p, q] = clean.split("?");
  const tab = q ? new URLSearchParams(q).get("tab") : null;
  if (p === "/forecast" && tab === "approvals") return "Orders";
  return activeItem(p, tab)?.label ?? EXTRA[p] ?? (p.split("/")[1] || "Overview").replace(/^\w/, (c) => c.toUpperCase());
}

export const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export interface ViewIn { visitorId: unknown; path: unknown; consent: unknown; userAgent: string; sessionUserId?: string; gpc?: boolean }

/** A page opened. Returns the view's id, so the time spent can be added when the visitor leaves it. */
export function recordView(i: ViewIn, now = new Date()): { ok: true; viewId: string; alerts: VisitAlert[] } | { ok: true; skipped: string } | Fail {
  if (i.consent !== true) return fail(400, "Recorded only after the visitor agrees.");
  if (i.gpc) return { ok: true, skipped: "Global Privacy Control is on." };
  if (typeof i.visitorId !== "string" || !VISITOR_ID.test(i.visitorId)) return fail(400, "Unknown visitor.");
  if (BOT.test(i.userAgent)) return { ok: true, skipped: "Automated browser." };
  const clean = cleanPath(String(i.path ?? ""));
  if (!clean || clean.startsWith("/admin")) return fail(400, "Unknown page.");
  const id = i.visitorId;
  const at = now.toISOString();
  return mutate((s) => {
    prune(s, now);
    const today = dayOf(at);
    if (s.views.filter((v) => v.visitorId === id && dayOf(v.at) === today).length >= MAX_VIEWS_PER_DAY) return { ok: true as const, skipped: "Daily limit." };
    const alerts: VisitAlert[] = [];
    // The first view of a new day sends yesterday's summary, once.
    const yesterday = dayOf(new Date(now.getTime() - 86400000).toISOString());
    if (!s.summaries.includes(yesterday) && s.views.some((v) => dayOf(v.at) === yesterday)) {
      s.summaries.push(yesterday);
      alerts.push(addAlert(s, "daily", dailyText(s, yesterday), at));
    }
    let visitor = s.visitors[id];
    const returning = !!visitor;
    if (!visitor) visitor = s.visitors[id] = { id, n: ++s.visitorSeq, firstSeen: at, lastSeen: at, device: deviceOf(i.userAgent) };
    visitor.lastSeen = at;
    const last = s.visits.filter((v) => v.visitorId === id).at(-1);
    let visit = last && now.getTime() - Date.parse(last.lastAt) < SESSION_GAP_MS ? last : undefined;
    // The role as the demo's role picker names it.
    const role = i.sessionUserId ? PUBLIC_DEMO_ROLES.find((r) => r.userId === i.sessionUserId)?.label ?? userById[i.sessionUserId]?.title.split(",")[0] : undefined;
    const page = pageName(clean);
    if (!visit) {
      visit = { id: `V-${++s.seq}`, visitorId: id, start: at, lastAt: at, views: 0 };
      s.visits.push(visit);
      alerts.push(addAlert(s, "new_visit", `${returning ? `Visitor ${visitor.n} is back on the demo` : `New visitor on the demo (Visitor ${visitor.n})`}, on a ${visitor.device}. First page: ${page}${role ? `, as ${role}` : ""}.`, at));
    }
    visit.lastAt = at;
    visit.views++;
    const view: View = { id: `W-${++s.seq}`, visitorId: id, visitId: visit.id, at, path: clean, page, role };
    s.views.push(view);
    return { ok: true as const, viewId: view.id, alerts };
  });
}

/** Time spent on a page, sent when the visitor leaves it. Only active time counts, capped at 30 minutes. */
export function recordLeave(visitorId: unknown, viewId: unknown, seconds: unknown): { ok: true } | Fail {
  if (typeof visitorId !== "string" || typeof viewId !== "string" || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return fail(400, "Unknown view.");
  return mutate((s) => {
    const v = s.views.find((x) => x.id === viewId && x.visitorId === visitorId);
    if (!v) return fail(404, "Unknown view.");
    v.seconds = Math.min(1800, Math.round((v.seconds ?? 0) + seconds));
    return { ok: true as const };
  });
}

/** The visitor said no after saying yes: everything recorded for them is erased. */
export function eraseVisitor(visitorId: unknown): { ok: true; erased: number } | Fail {
  if (typeof visitorId !== "string" || !VISITOR_ID.test(visitorId)) return fail(400, "Unknown visitor.");
  return mutate((s) => {
    const before = s.views.length;
    s.views = s.views.filter((v) => v.visitorId !== visitorId);
    s.visits = s.visits.filter((v) => v.visitorId !== visitorId);
    delete s.visitors[visitorId];
    return { ok: true as const, erased: before - s.views.length };
  });
}

function prune(s: VisitShape, now: Date) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400000).toISOString();
  s.views = s.views.filter((v) => v.at >= cutoff);
  s.visits = s.visits.filter((v) => v.lastAt >= cutoff);
  for (const [id, v] of Object.entries(s.visitors)) if (v.lastSeen < cutoff) delete s.visitors[id];
  s.alerts = s.alerts.slice(-500);
}

// ---- Telling the team ------------------------------------------------------------------------------------------------

const slackUrl = () => process.env.TYLL_SLACK_WEBHOOK_URL;
const emailReady = () => process.env.TYLL_EMAIL_PROVIDER === "resend" && !!process.env.RESEND_API_KEY && !!process.env.TYLL_EMAIL_FROM && !!process.env.TYLL_VISIT_ALERT_EMAIL;

function addAlert(s: VisitShape, kind: VisitAlert["kind"], text: string, at: string): VisitAlert {
  const channel = slackUrl() ? "slack" : emailReady() ? "email" : "log";
  const a: VisitAlert = { id: `A-${++s.seq}`, at, kind, text, channel, status: channel === "log" ? "logged" : "queued", detail: channel === "log" ? "No Slack or email is configured, so nothing was sent. Shown on the visits page." : undefined };
  s.alerts.push(a);
  return a;
}

function dailyText(s: VisitShape, day: string): string {
  const views = s.views.filter((v) => dayOf(v.at) === day);
  const visitors = new Set(views.map((v) => v.visitorId)).size;
  const top = topPages(views, 3).map((p) => `${p.page} (${p.views})`).join(", ");
  return `Demo on ${day}: ${visitors} ${visitors === 1 ? "visitor" : "visitors"}, ${views.length} page ${views.length === 1 ? "view" : "views"}. Most viewed: ${top}.`;
}

/** Hands queued alerts to Slack or email. Runs after the change is saved; the result is recorded either way. */
export async function deliverAlerts(ids: string[]) {
  for (const id of ids) {
    const a = loadVisits().alerts.find((x) => x.id === id);
    if (!a || a.status !== "queued") continue;
    let status: AlertStatus = "failed";
    let detail = "";
    try {
      const r = a.channel === "slack"
        ? await fetch(slackUrl()!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: a.text }) })
        : await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.TYLL_EMAIL_FROM, to: process.env.TYLL_VISIT_ALERT_EMAIL, subject: a.kind === "daily" ? "Tyll demo: daily summary" : "Tyll demo: someone is looking", text: a.text }) });
      status = r.ok ? "sent" : "failed";
      detail = r.ok ? `Accepted by ${a.channel === "slack" ? "Slack" : "the email provider"}.` : `${a.channel === "slack" ? "Slack" : "The email provider"} answered ${r.status}.`;
    } catch {
      detail = `Could not reach ${a.channel === "slack" ? "Slack" : "the email provider"}.`;
    }
    mutate((s) => { const y = s.alerts.find((x) => x.id === id); if (y) { y.status = status; y.detail = detail; } });
  }
}

// ---- What the team sees ----------------------------------------------------------------------------------------------

function topPages(views: View[], n: number) {
  const m = new Map<string, { page: string; views: number; visitors: Set<string>; seconds: number; timed: number }>();
  for (const v of views) {
    const e = m.get(v.page) ?? { page: v.page, views: 0, visitors: new Set(), seconds: 0, timed: 0 };
    e.views++;
    e.visitors.add(v.visitorId);
    if (v.seconds !== undefined) { e.seconds += v.seconds; e.timed++; }
    m.set(v.page, e);
  }
  return [...m.values()].sort((a, b) => b.views - a.views).slice(0, n).map((e) => ({ page: e.page, views: e.views, visitors: e.visitors.size, avgSeconds: e.timed ? Math.round(e.seconds / e.timed) : null }));
}

export function visitReport(days: number, now = new Date()) {
  const s = loadVisits();
  const from = new Date(now.getTime() - days * 86400000).toISOString();
  const today = dayOf(now.toISOString());
  const views = s.views.filter((v) => v.at >= from);
  const visits = s.visits.filter((v) => v.lastAt >= from);
  const seconds = (visitId: string) => s.views.filter((v) => v.visitId === visitId).reduce((t, v) => t + (v.seconds ?? 0), 0);
  const uniq = (vs: View[]) => new Set(vs.map((v) => v.visitorId)).size;
  const byRole = new Map<string, number>();
  for (const v of views) if (v.role) byRole.set(v.role, (byRole.get(v.role) ?? 0) + 1);
  const pages = topPages(views, 100);
  return {
    days,
    totals: {
      visitorsToday: uniq(s.views.filter((v) => dayOf(v.at) === today)),
      viewsToday: s.views.filter((v) => dayOf(v.at) === today).length,
      visitors: uniq(views), visits: visits.length, views: views.length,
      avgVisitSeconds: visits.length ? Math.round(visits.reduce((t, v) => t + seconds(v.id), 0) / visits.length) : 0,
      onNow: new Set(s.visits.filter((v) => now.getTime() - Date.parse(v.lastAt) < LIVE_MS).map((v) => v.visitorId)).size,
    },
    pages,
    roles: [...byRole.entries()].map(([role, n]) => ({ role, views: n })).sort((a, b) => b.views - a.views),
    visits: visits.slice(-60).reverse().map((v) => {
      const who = s.visitors[v.visitorId];
      return {
        id: v.id, visitor: who ? `Visitor ${who.n}` : "Visitor", device: who?.device ?? "computer", returning: !!who && who.firstSeen < v.start,
        start: v.start, lastAt: v.lastAt, seconds: seconds(v.id), live: now.getTime() - Date.parse(v.lastAt) < LIVE_MS,
        path: s.views.filter((x) => x.visitId === v.id).map((x) => ({ page: x.page, role: x.role, at: x.at, seconds: x.seconds ?? null })),
      };
    }),
    alerts: s.alerts.slice(-30).reverse(),
    delivery: slackUrl() ? "Slack" : emailReady() ? "Email" : "Not configured",
    retentionDays: RETENTION_DAYS,
  };
}

export type VisitReport = ReturnType<typeof visitReport>;

/** Every view as CSV, for a spreadsheet. */
export function visitsCsv(days: number, now = new Date()): string {
  const s = loadVisits();
  const from = new Date(now.getTime() - days * 86400000).toISOString();
  const q = (x: string | number | undefined | null) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const rows = s.views.filter((v) => v.at >= from).map((v) => [v.at, `Visitor ${s.visitors[v.visitorId]?.n ?? ""}`, s.visitors[v.visitorId]?.device, v.visitId, v.page, v.path, v.role, v.seconds].map(q).join(","));
  return ["time,visitor,device,visit,page,address,role,seconds", ...rows].join("\n");
}
