// Expiry: every delivery is a batch with a use-by date (recorded on receiving, or the item's shelf life from the
// delivery day). Stock is used first expiring, first out, so what is on the shelf is the batches that expire last.
// Batches expiring within three days get a suggested action by fixed rules: use it first, transfer it, a special or
// the staff meal. An expired batch is to be logged as waste with the reason Expired.
import { MENU_ITEMS, USERS, ingredientById, outletById, outletsOfProperty, propertyById } from "../data/catalog";
import { getDataset } from "../data/generate";
import { allowedProperties, can } from "../domain/access";
import { daysToExpiry, expiryAction, remainingByFefo, type Batch, type ExpiryAction } from "../domain/procurement";
import type { User } from "../types";
import { DEMO_TODAY, addDays, round2, unitLabel } from "../util";
import { poRef } from "./procurement";
import { notify } from "./notify";
import { loadStore, mutateStore, type Shape } from "./purchasing-store";
import { stockFor, type SessionEntries } from "./stock";

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const unitWord = (g: string) => (ingredientById[g].unit === "each" ? "units" : unitLabel(ingredientById[g].unit));

/** Batches received at a hotel: the dataset's deliveries and deliveries received in Tyll, with their use-by dates. */
export function batchesFor(propertyId: string, s: Shape = loadStore()): Batch[] {
  const out: Batch[] = [];
  for (const d of getDataset().deliveries) {
    if (d.propertyId !== propertyId || d.status !== "delivered") continue;
    for (const l of d.lines) {
      if (l.delivered <= 0) continue;
      out.push({ ingredientId: l.ingredientId, batch: `${d.supplierId.toUpperCase().slice(0, 4)}-${d.date.slice(2).replace(/-/g, "")}`, expiry: addDays(d.date, ingredientById[l.ingredientId].shelfLifeDays), qty: l.delivered, received: d.date, source: d.id, useBy: "shelf_life" });
    }
  }
  for (const r of s.requests) {
    if (r.propertyId !== propertyId || r.eventId || r.deliveryId) continue;
    for (const rc of r.receipts ?? []) for (const l of rc.lines) {
      if (l.accepted <= 0) continue;
      const day = rc.at.slice(0, 10);
      const shelf = addDays(day, ingredientById[l.ingredientId].shelfLifeDays);
      out.push({ ingredientId: l.ingredientId, batch: l.batch ?? `${poRef(r)}-${rc.id.split("-").at(-1)}`, expiry: l.expiry ?? shelf, qty: l.accepted, received: day, source: poRef(r), useBy: l.expiry && l.expiry !== shelf ? "label" : "shelf_life" });
    }
  }
  return out;
}

export interface ExpiryRow {
  ingredientId: string; name: string; unit: string; batch: string; expiry: string; daysLeft: number; left: number; value: number; received: string; source: string;
  /** True for the batch to use first: the one that expires soonest. */
  first: boolean;
  action: ExpiryAction;
  atRisk: boolean;
  /** Where the use-by date comes from, and the item's shelf life. */
  useBy: "shelf_life" | "label";
  shelfLifeDays: number;
  /** What someone decided to do about it: a special, a move to another outlet, or waste. */
  decision?: ExpiryDecision;
  /** The extra quantity normal use will not finish, for a special or a move. */
  extra: number;
  dish?: string;
}

/** What a person decided for a batch at risk, saved with who and when. The chef and the restaurant manager are told. */
export interface ExpiryDecision {
  key: string;
  ingredientId: string;
  batch: string;
  kind: "special" | "move" | "waste";
  qty: number;
  outletId: string;
  dish?: string;
  note?: string;
  by: string;
  role: import("../types").Role;
  at: string;
}

export const batchKey = (ingredientId: string, batch: string) => `${ingredientId}|${batch}`;

/** Batches on the shelf that expire within `days` (or already have), with what to do about each. */
export function expiringFor(user: User, propertyId: string, entries: SessionEntries, days = 3) {
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  if (!(can(user, "stock.count") || can(user, "stock.review") || can(user, "purchase.create"))) return fail(403, "Your role cannot see stock batches.");
  const s = loadStore();
  const batches = batchesFor(propertyId, s);
  const from = addDays(DEMO_TODAY, -28);
  const rows: ExpiryRow[] = [];
  const sold = new Map<string, number>();
  for (const d of getDataset().dayItems) if (d.date >= from && d.date < DEMO_TODAY && outletById[d.outletId]?.propertyId === propertyId) sold.set(d.itemId, (sold.get(d.itemId) ?? 0) + d.units);
  let noBatch = 0;
  for (const r of stockFor(user, propertyId, entries)) {
    const mine = batches.filter((b) => b.ingredientId === r.ingredientId);
    if (!mine.length) continue;
    const left = remainingByFefo(Math.max(0, r.estimated), mine);
    noBatch += left.noBatch > 0 && ingredientById[r.ingredientId].shelfLifeDays <= 7 ? 1 : 0;
    // The batch to use first is the first one that has not already expired.
    const firstOk = left.batches.findIndex((b) => daysToExpiry(b.expiry, DEMO_TODAY) >= 0);
    left.batches.forEach((b, i) => {
      const d = daysToExpiry(b.expiry, DEMO_TODAY);
      if (d > days) return;
      // Stock in the hotel store is drawn by every outlet already, so moving it between them uses nothing up: no transfer is offered.
      // The dish that sells most among those using it: the easiest special to push.
      // A special is served in a restaurant, so dishes on the main restaurant's menu come first (Mercado at Lisbon).
      const restaurant = outletsOfProperty(propertyId).find((o) => o.id === `${propertyId}-terrace`) ?? outletsOfProperty(propertyId)[0];
      const dish = MENU_ITEMS.filter((m) => (m.recipe ?? []).some((x) => x.ingredientId === r.ingredientId) && outletsOfProperty(propertyId).some((o) => o.menu.some((e) => e.itemId === m.id)))
        .map((m) => ({ m, sold: sold.get(m.id) ?? 0, here: restaurant?.menu.some((e) => e.itemId === m.id) ? 1 : 0 })).sort((a, b) => b.here - a.here || b.sold - a.sold)[0]?.m;
      const action = expiryAction({ left: b.left, daysLeft: d, dailyUse: r.avgDaily, unitWord: unitWord(r.ingredientId), transferTo: undefined, dish: dish?.name });
      const decision = (s.expiryDecisions ?? []).find((x) => x.key === batchKey(r.ingredientId, b.batch));
      const extra = d < 0 ? round2(b.left) : round2(Math.max(0, b.left - r.avgDaily * Math.max(1, d + 1)));
      rows.push({ ingredientId: r.ingredientId, name: ingredientById[r.ingredientId].name, unit: unitWord(r.ingredientId), batch: b.batch, expiry: b.expiry, daysLeft: d, left: b.left, value: round2(b.left * r.valuationCost), received: b.received, source: b.source, first: i === firstOk, action, atRisk: action.kind !== "use_first" && action.kind !== "waste" && !decision, useBy: b.useBy ?? "shelf_life", shelfLifeDays: ingredientById[r.ingredientId].shelfLifeDays, decision, extra, dish: dish?.name });
    });
  }
  rows.sort((a, b) => a.daysLeft - b.daysLeft || Number(b.atRisk) - Number(a.atRisk) || b.value - a.value);
  const atRisk = rows.filter((x) => x.atRisk);
  return {
    ok: true as const, days, currency: propertyById[propertyId].currency, rows,
    totals: { batches: rows.length, atRisk: atRisk.length, value: round2(rows.reduce((t, x) => t + x.value, 0)), atRiskValue: round2(atRisk.reduce((t, x) => t + x.value, 0)), expired: rows.filter((x) => x.daysLeft < 0).length },
    noBatchItems: noBatch,
    outlets: outletsOfProperty(propertyId).map((o) => outletById[o.id].name),
  };
}

/** Who hears each morning what to use today: the kitchen, outlet managers, the F&B director and the storekeeper. */
const EXPIRY_ROLES = new Set(["chef", "restaurant_manager", "fnb_director", "storekeeper"]);
const NO_ENTRIES: SessionEntries = { waste: [], counts: [], overrides: [], recipes: [], receipts: [] };
const qty = (r: ExpiryRow) => `${r.left % 1 ? r.left.toFixed(1) : r.left} ${r.unit}`;

/** Once a day per hotel: a bell notice listing the batches to use today or tomorrow, and any expired on the shelf. */
export function ensureExpiryNotice(propertyId: string) {
  if (loadStore().expiryChecks?.[propertyId] === DEMO_TODAY) return;
  const reader = USERS.find((u) => u.role === "gm" && allowedProperties(u).includes(propertyId)) ?? USERS.find((u) => u.role === "owner");
  const r = reader ? expiringFor(reader, propertyId, NO_ENTRIES, 1) : null;
  mutateStore((x) => {
    x.expiryChecks = { ...x.expiryChecks, [propertyId]: DEMO_TODAY };
    if (!r?.ok || !r.rows.length) return;
    const soon = r.rows.filter((b) => b.daysLeft >= 0);
    const expired = r.rows.length - soon.length;
    const listed = soon.slice(0, 3).map((b) => `${b.name}, ${qty(b)} ${b.daysLeft === 0 ? "today" : "by tomorrow"}`).join("; ");
    const title = soon.length ? `${soon.length} ${soon.length === 1 ? "batch" : "batches"} to use today or tomorrow` : `${expired} expired ${expired === 1 ? "batch" : "batches"} on the shelf`;
    const body = [soon.length ? `Use first: ${listed}${soon.length > 3 ? `, and ${soon.length - 3} more` : ""}.` : "", expired ? `${expired} ${expired === 1 ? "batch has" : "batches have"} expired: log ${expired === 1 ? "it" : "them"} as waste, reason Expired.` : ""].filter(Boolean).join(" ");
    const to = USERS.filter((u) => EXPIRY_ROLES.has(u.role) && allowedProperties(u).includes(propertyId));
    notify(x, { to, type: "expiry", ref: `EXP-${propertyId}-${DEMO_TODAY}`, propertyId, title, body, href: "/stock?tab=expiry" });
  });
}

// ---- Decisions on batches at risk ------------------------------------------------------------------------------------

/** Make a batch at risk tonight's special, move it to another outlet, or log it as waste. Saved once per batch, with
 * who and when; the chef and the outlet's restaurant manager are told on the bell. Logging as waste writes a shared
 * waste entry with the reason Expired. */
export function decideExpiry(user: User, propertyId: string, body: Record<string, unknown>): { ok: true; decision: ExpiryDecision } | Fail {
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const kind = (["special", "move", "waste"] as const).find((k) => k === body.kind);
  if (!kind) return fail(400, "Choose a special, a move to another outlet, or waste.");
  if (kind === "waste" ? !can(user, "stock.logWaste") : !can(user, "prep.plan")) return fail(403, kind === "waste" ? "Your role cannot log waste." : "The chef or a manager decides what to do with stock about to expire.");
  const ingredientId = String(body.ingredientId ?? "");
  const batch = String(body.batch ?? "");
  const g = ingredientById[ingredientId];
  if (!g) return fail(400, "Unknown item.");
  const reader = USERS.find((u) => u.role === "gm" && allowedProperties(u).includes(propertyId)) ?? user;
  const row = expiringFor(reader, propertyId, NO_ENTRIES, 7);
  const found = row.ok ? row.rows.find((x) => x.ingredientId === ingredientId && x.batch === batch) : undefined;
  if (!found) return fail(404, "This batch is not expiring.");
  if (found.decision) return fail(409, "Someone already decided what to do with this batch.");
  const outletId = String(body.outletId ?? "lis-terrace");
  if (!outletsOfProperty(propertyId).some((o) => o.id === outletId)) return fail(400, "Choose an outlet at this hotel.");
  const qty = round2(kind === "waste" ? found.left : found.extra > 0 ? found.extra : found.left);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
  const decision: ExpiryDecision = { key: batchKey(ingredientId, batch), ingredientId, batch, kind, qty, outletId, dish: kind === "special" ? (typeof body.dish === "string" && body.dish.trim() ? body.dish.trim().slice(0, 80) : found.dish) : undefined, note: note || undefined, by: user.id, role: user.role, at: new Date().toISOString() };
  const where = outletById[outletId].name;
  const amount = `${qty % 1 ? qty.toFixed(1) : qty} ${found.unit}`;
  const useBy = found.daysLeft <= 0 ? "today" : found.daysLeft === 1 ? "tomorrow" : `in ${found.daysLeft} days`;
  const out = mutateStore((x) => {
    x.expiryDecisions ??= [];
    if (x.expiryDecisions.some((d) => d.key === decision.key)) return null;
    x.expiryDecisions.push(decision);
    if (kind === "waste") {
      x.stockLog.waste.push({ id: `W-EXP-${batch}-${ingredientId}`, outletId, propertyId, date: DEMO_TODAY, ingredientId, qty, reason: "expired", by: user.staffId ?? user.id, byUser: user.id, role: user.role, at: decision.at, synced: true, seq: 999_000 + x.expiryDecisions.length, note: `Batch ${batch}, from Expiring soon.` });
    }
    const chef = USERS.filter((u) => u.role === "chef" && allowedProperties(u).includes(propertyId));
    const managers = USERS.filter((u) => u.role === "restaurant_manager" && allowedProperties(u).includes(propertyId) && (u.outletIds ?? []).includes(outletId));
    const title = kind === "special" ? `Tonight's special at ${where}: use ${amount} of ${g.name}` : kind === "move" ? `${amount} of ${g.name} moved to ${where}` : `${amount} of ${g.name} logged as waste`;
    const body2 = kind === "special" ? `${decision.dish ? `In ${decision.dish}. ` : ""}Batch ${batch}, use by ${useBy}. Set by ${user.name}.` : kind === "move" ? `Batch ${batch}, use by ${useBy}. Use it there first. Set by ${user.name}.` : `Batch ${batch} had expired or could not be used in time. Reason Expired. Logged by ${user.name}.`;
    notify(x, { to: [...chef, ...managers], type: "expiry-decision", ref: decision.key, propertyId, from: user.id, title, body: body2, href: "/stock?tab=expiry" });
    return decision;
  });
  if (!out) return fail(409, "Someone already decided what to do with this batch.");
  return { ok: true, decision: out };
}

// ---- The demo's batch at risk -----------------------------------------------------------------------------------------

export const EXPIRY_STORY_PREFIX = "PR-LIS-EXP-";
/** Planted when the demo is opened, as an ordinary record: sea bass delivered this morning for an event lunch that was
 * cancelled went to the main store. The supplier's label says use by tomorrow, sooner than the usual shelf life, so the
 * use-by date was changed on receiving: the one case where it is typed by hand. */
export function ensureExpiryStory(propertyId = "lis") {
  if (propertyId !== "lis") return;
  const day = DEMO_TODAY.replace(/-/g, "");
  const id = `${EXPIRY_STORY_PREFIX}${day}`;
  const s = loadStore();
  if (s.requests.some((r) => r.id === id)) return;
  const g = ingredientById.hammour;
  const received = DEMO_TODAY;
  const label = addDays(DEMO_TODAY, 1);
  const price = round2(g.cost);
  mutateStore((x) => {
    if (x.requests.some((r) => r.id === id)) return;
    x.requests = x.requests.filter((r) => !r.id.startsWith(EXPIRY_STORY_PREFIX));
    const at = `${received}T07:40`;
    x.requests.push({
      id, propertyId, outletIds: outletsOfProperty(propertyId).map((o) => o.id), period: { from: received, to: received }, createdBy: "u-events", createdAt: `${addDays(received, -2)}T10:00:00.000Z`, updatedAt: `${received}T07:40:00.000Z`,
      status: "received", supplierId: "sea", deliveryDate: received, poNumber: `PO-LIS-EXP-${day}`, sentAt: `${addDays(received, -1)}T11:00`, expectedAt: `${received}T07:30`,
      comment: "Sea bass for the Atlântico Foundation lunch for 70. The lunch was cancelled this morning, so the fish went to the main store.",
      lines: [{ ingredientId: "hammour", qty: 14, suggested: 14, requirement: 14, available: 0, incoming: 0, safety: 0, supplierId: "sea", unitPrice: price, received: 14 }],
      receipts: [{ id: `GR-LIS-EXP-${day}-1`, at, by: "u-store", final: true, lines: [{ ingredientId: "hammour", delivered: 14, damaged: 0, accepted: 14, batch: `PA-${received.slice(2).replace(/-/g, "")}-EV`, expiry: label, note: `Label says use by ${label}, sooner than the usual ${g.shelfLifeDays} days.` }] }],
      history: [{ at: `${addDays(received, -2)}T10:00:00.000Z`, by: "u-events", action: "Request created", status: "draft" }, { at: `${received}T07:40:00.000Z`, by: "u-store", action: "Delivery received", status: "received", comment: "The lunch was cancelled this morning: the fish is in the main store. Use-by taken from the label." }],
    });
  });
}
