// Stock takes: count one location by area, item by item, on a phone or tablet, by barcode or by hand. Nothing changes
// until a manager has seen the variance report (system against counted, in units and money, by item and group) and
// approved it; approval turns each counted line into a count, and stock follows. Every stock take is kept.
import { ingredientById, outletById, propertyById } from "../data/catalog";
import { COUNT_LOCATIONS, STOCK_GROUPS, locationOf, stockGroupOf } from "../data/locations";
import { allowedProperties, can } from "../domain/access";
import { varianceReport } from "../domain/procurement";
import type { SharedCount, StockTake, StockTakeLine, User } from "../types";
import { DEMO_TODAY, round2 } from "../util";
import { notify, peopleWith, resolve } from "./notify";
import { procurementOf } from "./procurement";
import { loadStore, mutateStore, nextNumber } from "./purchasing-store";
import { stockFor, type SessionEntries } from "./stock";

type Fail = { ok: false; status: number; error: string };
type Result<T = object> = ({ ok: true } & T) | Fail;
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const now = () => new Date().toISOString();
const AREAS = COUNT_LOCATIONS.map((l) => l.id) as string[];
const groupName = (ingredientId: string) => STOCK_GROUPS.find((g) => g.id === stockGroupOf(ingredientId))?.name ?? "Other";
const locationName = (l: string) => (l === "main" ? "Main store" : outletById[l]?.name ?? l);

export const areaName = (id: string) => COUNT_LOCATIONS.find((l) => l.id === id)?.name ?? id;

const mayCount = (user: User, propertyId: string) => can(user, "stock.count") && allowedProperties(user).includes(propertyId);
const mayDecide = (user: User) => can(user, "stock.review");

export function reportOf(t: StockTake) {
  return varianceReport(t.lines.map((l) => ({ ingredientId: l.ingredientId, group: groupName(l.ingredientId), system: l.system, counted: l.counted, unitCost: l.unitCost })));
}

export interface StockTakeView extends StockTake { locationName: string; areaNames: string[]; report: ReturnType<typeof reportOf>; currency: string }
const view = (t: StockTake): StockTakeView => ({ ...t, locationName: locationName(t.location), areaNames: t.areas.map(areaName), report: reportOf(t), currency: propertyById[t.propertyId].currency });

/** Starts a stock take. The system quantity of each item is taken now, so counting against it is fair. */
export function startStockTake(user: User, body: Record<string, unknown>, entries: SessionEntries): Result<{ take: StockTakeView }> {
  const propertyId = String(body.propertyId ?? "");
  if (!mayCount(user, propertyId)) return fail(403, "You cannot count stock at this hotel.");
  const kind = body.kind === "partial" ? "partial" : "full";
  const location = typeof body.location === "string" && body.location ? body.location : "main";
  if (location !== "main" && outletById[location]?.propertyId !== propertyId) return fail(400, "Choose a location at this hotel.");
  const areas = kind === "full" ? AREAS : (Array.isArray(body.areas) ? (body.areas as unknown[]).map(String) : []).filter((a) => AREAS.includes(a));
  if (!areas.length) return fail(400, "Choose at least one area to count.");
  const open = loadStore().stockTakes?.find((t) => t.propertyId === propertyId && t.location === location && t.status === "counting" && t.startedBy === user.id);
  if (open) return { ok: true, take: view(open) };
  const rows = stockFor(user, propertyId, entries).filter((r) => (location === "main" ? r.store === null : r.store === location) && areas.includes(locationOf(r.ingredientId)));
  if (!rows.length) return fail(409, "Nothing is held in those areas at this location.");
  const route = loadStore().countRoutes?.[propertyId] ?? AREAS;
  const order = (g: string) => route.indexOf(locationOf(g));
  const lines: StockTakeLine[] = rows.map((r) => ({ ingredientId: r.ingredientId, system: Math.round(Math.max(0, r.estimated) * 1000) / 1000, counted: null, unitCost: Math.round(r.valuationCost * 10000) / 10000 }))
    .sort((a, b) => order(a.ingredientId) - order(b.ingredientId) || ingredientById[a.ingredientId].name.localeCompare(ingredientById[b.ingredientId].name));
  const take = mutateStore((x) => {
    x.stockTakes ??= [];
    const n = nextNumber(x, `ST-${propertyId.toUpperCase()}`);
    const t: StockTake = { id: `ST-${propertyId.toUpperCase()}-${String(n).padStart(4, "0")}`, propertyId, location, areas, kind, status: "counting", startedBy: user.id, startedAt: now(), date: DEMO_TODAY, lines, history: [{ at: now(), by: user.id, action: `${kind === "full" ? "Full" : "Partial"} stock take started` }] };
    x.stockTakes.push(t);
    return t;
  });
  return { ok: true, take: view(take) };
}

const findTake = (user: User, id: string) => {
  const t = loadStore().stockTakes?.find((x) => x.id === id);
  return t && allowedProperties(user).includes(t.propertyId) ? t : undefined;
};

/** Records one item's count: typed in, or found by scanning its barcode. A count can be corrected until submitted. */
export function countItem(user: User, id: string, body: Record<string, unknown>): Result<{ take: StockTakeView; ingredientId: string }> {
  const t = findTake(user, id);
  if (!t) return fail(404, "This stock take is not available.");
  if (!mayCount(user, t.propertyId)) return fail(403, "You cannot count stock at this hotel.");
  if (t.status !== "counting") return fail(409, "This stock take has been submitted. Counts can no longer change.");
  let ingredientId = typeof body.ingredientId === "string" ? body.ingredientId : "";
  let method: "scan" | "manual" = "manual";
  if (typeof body.barcode === "string" && body.barcode.trim()) {
    const code = body.barcode.trim();
    const hit = procurementOf().catalogue.find((c) => c.propertyId === t.propertyId && c.barcode === code);
    if (!hit) return fail(404, `No item has the barcode ${code}.`);
    ingredientId = hit.ingredientId;
    method = "scan";
  }
  const line = t.lines.find((l) => l.ingredientId === ingredientId);
  if (!line) return fail(404, ingredientById[ingredientId] ? `${ingredientById[ingredientId].name} is not part of this stock take.` : "Choose an item.");
  if (body.counted === undefined) return { ok: true, take: view(t), ingredientId };
  const counted = body.counted === null ? null : Number(body.counted);
  if (counted !== null && (!Number.isFinite(counted) || counted < 0 || counted > 1e6)) return fail(400, `Enter the quantity of ${ingredientById[ingredientId].name} you counted.`);
  const take = mutateStore((x) => {
    const y = x.stockTakes!.find((z) => z.id === id)!;
    const l = y.lines.find((z) => z.ingredientId === ingredientId)!;
    l.counted = counted === null ? null : Math.round(counted * 1000) / 1000;
    l.by = user.id; l.at = now(); l.method = method;
    return y;
  });
  return { ok: true, take: view(take), ingredientId };
}

/** Sends the stock take to a manager. A full count needs every item; a partial count at least one. */
export function submitStockTake(user: User, id: string): Result<{ take: StockTakeView }> {
  const t = findTake(user, id);
  if (!t) return fail(404, "This stock take is not available.");
  if (!mayCount(user, t.propertyId)) return fail(403, "You cannot count stock at this hotel.");
  if (t.status !== "counting") return fail(409, "This stock take has already been submitted.");
  const missing = t.lines.filter((l) => l.counted === null).length;
  if (t.kind === "full" && missing) return fail(409, `${missing} ${missing === 1 ? "item is" : "items are"} not counted yet. A full stock take needs every item; enter 0 for anything not there.`);
  if (missing === t.lines.length) return fail(409, "Count at least one item first.");
  const r = reportOf(t);
  const take = mutateStore((x) => {
    const y = x.stockTakes!.find((z) => z.id === id)!;
    y.status = "submitted"; y.submittedAt = now();
    y.history.push({ at: y.submittedAt, by: user.id, action: "Submitted for approval", note: `${r.totals.counted} items counted, ${r.totals.withDifference} with a difference, net ${round2(r.totals.net)}` });
    notify(x, { to: peopleWith("stock.review", y.propertyId, (u) => u.id !== user.id && ["restaurant_manager", "fnb_director", "purchasing", "gm"].includes(u.role)), type: "stocktake-review", ref: y.id, propertyId: y.propertyId, from: user.id, title: `Stock take ${y.id} to approve`, body: `${locationName(y.location)}: ${r.totals.counted} items counted, ${r.totals.withDifference} with a difference. Check the variance report, then approve or send it back.`, href: `/stock?tab=counts&take=${y.id}` });
    return y;
  });
  return { ok: true, take: view(take) };
}

/** A manager approves (stock adjusts to what was counted) or rejects (nothing changes) the stock take. */
export function decideStockTake(user: User, id: string, body: Record<string, unknown>): Result<{ take: StockTakeView }> {
  const t = findTake(user, id);
  if (!t) return fail(404, "This stock take is not available.");
  if (!mayDecide(user)) return fail(403, "Only a manager can approve a stock take.");
  if (t.status !== "submitted") return fail(409, "This stock take is not waiting for approval.");
  if (t.startedBy === user.id || t.lines.some((l) => l.by === user.id)) return fail(403, "Someone who did not count must approve it.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  if (body.decision !== "approve" && body.decision !== "reject") return fail(400, "Approve or reject the stock take.");
  if (body.decision === "reject" && note.length < 3) return fail(400, "Say why, for example: recount the cellar.");
  const take = mutateStore((x) => {
    const y = x.stockTakes!.find((z) => z.id === id)!;
    y.decidedBy = user.id; y.decidedAt = now(); y.note = note || undefined;
    resolve(x, "stocktake-review", y.id);
    if (body.decision === "reject") {
      y.status = "rejected";
      y.history.push({ at: y.decidedAt, by: user.id, action: "Rejected. Stock is unchanged.", note });
      return y;
    }
    y.status = "approved";
    y.countIds = [];
    for (const l of y.lines) {
      if (l.counted === null) continue;
      const n = nextNumber(x, "CS");
      const c: SharedCount = { id: `C-S-${n}`, propertyId: y.propertyId, ingredientId: l.ingredientId, date: DEMO_TODAY, expected: l.system, counted: l.counted, by: l.by ?? y.startedBy, byUser: l.by ?? y.startedBy, at: l.at ?? y.startedAt, seq: 1_000_000 + n, status: "accepted", allocation: {}, note: `Stock take ${y.id}`, reviewedBy: user.id, reviewedAt: y.decidedAt, reviewNote: "Approved with the stock take" };
      x.stockLog.counts.push(c);
      y.countIds.push(c.id);
    }
    y.history.push({ at: y.decidedAt, by: user.id, action: "Approved. Stock now follows the counts.", note: note || undefined });
    return y;
  });
  return { ok: true, take: view(take) };
}

export function stockTakesFor(user: User, propertyId: string): Result<{ takes: StockTakeView[]; mayDecide: boolean; mayCount: boolean }> {
  if (!allowedProperties(user).includes(propertyId) || !(can(user, "stock.count") || can(user, "stock.review") || can(user, "finance.view"))) return fail(403, "Your role cannot see stock takes.");
  const takes = (loadStore().stockTakes ?? []).filter((t) => t.propertyId === propertyId).map(view).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { ok: true, takes, mayDecide: mayDecide(user), mayCount: can(user, "stock.count") };
}

export function stockTakeFor(user: User, id: string): Result<{ take: StockTakeView; mayDecide: boolean }> {
  const t = findTake(user, id);
  if (!t) return fail(404, "This stock take is not available.");
  return { ok: true, take: view(t), mayDecide: mayDecide(user) && t.startedBy !== user.id };
}

/** Month end: approved stock takes in the month, their variance by group, and the totals accounting books. */
export function monthEnd(user: User, propertyId: string, month: string) {
  const all = stockTakesFor(user, propertyId);
  if (!all.ok) return all;
  if (!/^\d{4}-\d{2}$/.test(month)) return fail(400, "Choose a month as YYYY-MM.");
  const takes = all.takes.filter((t) => t.status === "approved" && t.date.startsWith(month));
  const groups = new Map<string, { group: string; net: number; missing: number; surplus: number; items: number }>();
  for (const t of takes) for (const g of t.report.groups) {
    const cur = groups.get(g.group) ?? { group: g.group, net: 0, missing: 0, surplus: 0, items: 0 };
    cur.net = round2(cur.net + g.net); cur.missing = round2(cur.missing + g.missing); cur.surplus = round2(cur.surplus + g.surplus); cur.items += g.counted;
    groups.set(g.group, cur);
  }
  return {
    ok: true as const, month, currency: propertyById[propertyId].currency, takes: takes.map((t) => ({ id: t.id, date: t.date, location: t.locationName, kind: t.kind, counted: t.report.totals.counted, net: t.report.totals.net, missing: t.report.totals.missing, surplus: t.report.totals.surplus, systemValue: t.report.totals.systemValue, countedValue: t.report.totals.countedValue, approvedBy: t.decidedBy })),
    groups: [...groups.values()].sort((a, b) => a.net - b.net),
    totals: { net: round2(takes.reduce((s, t) => s + t.report.totals.net, 0)), missing: round2(takes.reduce((s, t) => s + t.report.totals.missing, 0)), surplus: round2(takes.reduce((s, t) => s + t.report.totals.surplus, 0)), countedValue: round2(takes.reduce((s, t) => s + t.report.totals.countedValue, 0)) },
  };
}

/** Whether an approved stock take on or after a date counted this item: stock based losses are confirmed only then. */
export function confirmedByStockTake(propertyId: string, ingredientId: string, date: string): string | null {
  const t = (loadStore().stockTakes ?? []).find((x) => x.propertyId === propertyId && x.status === "approved" && x.date >= date && x.lines.some((l) => l.ingredientId === ingredientId && l.counted !== null));
  return t?.id ?? null;
}
