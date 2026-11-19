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
      out.push({ ingredientId: l.ingredientId, batch: `${d.supplierId.toUpperCase().slice(0, 4)}-${d.date.slice(2).replace(/-/g, "")}`, expiry: addDays(d.date, ingredientById[l.ingredientId].shelfLifeDays), qty: l.delivered, received: d.date, source: d.id });
    }
  }
  for (const r of s.requests) {
    if (r.propertyId !== propertyId || r.eventId || r.deliveryId) continue;
    for (const rc of r.receipts ?? []) for (const l of rc.lines) {
      if (l.accepted <= 0) continue;
      const day = rc.at.slice(0, 10);
      out.push({ ingredientId: l.ingredientId, batch: l.batch ?? `${poRef(r)}-${rc.id.split("-").at(-1)}`, expiry: l.expiry ?? addDays(day, ingredientById[l.ingredientId].shelfLifeDays), qty: l.accepted, received: day, source: poRef(r) });
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
}

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
      const dish = MENU_ITEMS.filter((m) => (m.recipe ?? []).some((x) => x.ingredientId === r.ingredientId) && outletsOfProperty(propertyId).some((o) => o.menu.some((e) => e.itemId === m.id)))
        .map((m) => ({ m, sold: sold.get(m.id) ?? 0 })).sort((a, b) => b.sold - a.sold)[0]?.m;
      const action = expiryAction({ left: b.left, daysLeft: d, dailyUse: r.avgDaily, unitWord: unitWord(r.ingredientId), transferTo: undefined, dish: dish?.name });
      rows.push({ ingredientId: r.ingredientId, name: ingredientById[r.ingredientId].name, unit: unitWord(r.ingredientId), batch: b.batch, expiry: b.expiry, daysLeft: d, left: b.left, value: round2(b.left * r.valuationCost), received: b.received, source: b.source, first: i === firstOk, action, atRisk: action.kind !== "use_first" && action.kind !== "waste" });
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
