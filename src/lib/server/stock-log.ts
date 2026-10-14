// Waste, breakage and stock counts saved on the server, so the staff app, Stock, Forecast and Finance read one record.
// Entries made in a browser before Stage 6 are uploaded once by the browser (keyed, so a retry is not saved twice).
import { ingredientById, itemById, outletById } from "../data/catalog";
import { allowedOutlets, allowedProperties, can } from "../domain/access";
import type { CountRecord, SharedCount, SharedWaste, SharedWasteCorrection, User, WasteLog, WasteReason } from "../types";
import { DEMO_TODAY, addDays } from "../util";
import { loadStore, mutateStore, nextNumber, type Shape } from "./purchasing-store";
import { notify, peopleWith, resolve } from "./notify";

type Fail = { ok: false; status: number; error: string };
export type Result<T = object> = ({ ok: true } & T) | Fail;
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const now = () => new Date().toISOString();
const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const REASONS: WasteReason[] = ["waste", "breakage", "spoilage", "damaged", "other"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Shared waste with the latest correction applied. Cancelled entries drop out; the originals stay on record. */
export function sharedWaste(s: Shape = loadStore()): WasteLog[] {
  const { waste, corrections } = s.stockLog;
  return waste.flatMap((w) => {
    const c = corrections.filter((x) => x.wasteId === w.id).sort((a, b) => b.seq - a.seq)[0];
    return !c ? [w] : c.qty > 0 ? [{ ...w, qty: c.qty }] : [];
  });
}

/** Counts that apply to stock: accepted ones only. Submitted counts wait for a manager. */
export function sharedCounts(s: Shape = loadStore()): CountRecord[] {
  return s.stockLog.counts.filter((c) => c.status === "accepted").map((c) => ({ id: c.id, propertyId: c.propertyId, ingredientId: c.ingredientId, date: c.date, kind: "spot", expected: c.expected, counted: c.counted, by: c.by, seq: c.seq, allocation: c.allocation }));
}

/** Keys of browser entries already saved here, so the same entry sent again is not counted twice. */
export function uploadedKeys(s: Shape = loadStore()): Set<string> {
  return new Set([...s.stockLog.waste, ...s.stockLog.counts].map((x) => x.clientKey).filter((k): k is string => !!k));
}

export function sharedFor(user: User): { waste: SharedWaste[]; corrections: SharedWasteCorrection[]; counts: SharedCount[] } {
  const s = loadStore();
  const outlets = new Set(allowedOutlets(user));
  const props = new Set(allowedProperties(user));
  const staff = user.role === "employee" || user.role === "storekeeper";
  // Staff see their own entries; managers see everything at their outlets.
  const waste = s.stockLog.waste.filter((w) => outlets.has(w.outletId) && (!staff || w.byUser === user.id));
  const ids = new Set(waste.map((w) => w.id));
  return {
    waste,
    corrections: s.stockLog.corrections.filter((c) => ids.has(c.wasteId)),
    counts: s.stockLog.counts.filter((c) => props.has(c.propertyId) && (!staff || c.byUser === user.id)),
  };
}

export function logWasteShared(user: User, body: Record<string, unknown>): Result<{ entry: SharedWaste }> {
  const outletId = String(body.outletId ?? "");
  if (!can(user, "stock.logWaste") || !allowedOutlets(user).includes(outletId)) return fail(403, "You cannot log waste for this outlet.");
  const ingredientId = typeof body.ingredientId === "string" && ingredientById[body.ingredientId] ? body.ingredientId : undefined;
  const itemId = typeof body.itemId === "string" && itemById[body.itemId] ? body.itemId : undefined;
  if (!ingredientId && !itemId) return fail(400, "Choose an item.");
  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty <= 0) return fail(400, "Enter a quantity above zero.");
  if (qty > 500) return fail(400, "That quantity looks too large. Check the amount.");
  const reason = REASONS.find((r) => r === body.reason);
  if (!reason) return fail(400, "Choose a reason.");
  const date = typeof body.date === "string" ? body.date : DEMO_TODAY;
  if (!ISO.test(date) || date > DEMO_TODAY || date < addDays(DEMO_TODAY, -7)) return fail(400, "Late entries can go back up to seven days.");
  const clientKey = typeof body.clientId === "string" && body.clientId.length < 60 ? `${user.id}:${body.clientId}` : undefined;
  const s = loadStore();
  const dup = clientKey && s.stockLog.waste.find((w) => w.clientKey === clientKey);
  if (dup) return { ok: true, entry: dup };
  const entry = mutateStore((x) => {
    const n = nextNumber(x, "WS");
    const w: SharedWaste = {
      id: `W-S-${n}`, outletId, propertyId: outletById[outletId].propertyId, date, ingredientId, itemId, qty: Math.round(qty * 1000) / 1000, reason, by: user.staffId ?? user.id, byUser: user.id, at: now(),
      synced: true, seq: 1_000_000 + n, note: text(body.note) || undefined, clientKey, periodId: typeof body.periodId === "string" ? body.periodId : undefined,
    };
    x.stockLog.waste.push(w);
    return w;
  });
  return { ok: true, entry };
}

export function correctWasteShared(user: User, id: string, body: Record<string, unknown>): Result<{ correction: SharedWasteCorrection }> {
  const s = loadStore();
  const w = s.stockLog.waste.find((x) => x.id === id);
  if (!w || !allowedOutlets(user).includes(w.outletId)) return fail(404, "This entry is not available.");
  if (!can(user, "stock.logWaste")) return fail(403, "You cannot correct waste entries.");
  // Staff correct their own entries; managers may correct any at their outlets.
  if ((user.role === "employee" || user.role === "storekeeper") && w.byUser !== user.id) return fail(403, "Only the person who logged it, or a manager, can correct it.");
  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty < 0 || qty > 500) return fail(400, "Enter the correct quantity, or zero to cancel the entry.");
  const reason = text(body.reason);
  if (reason.length < 3) return fail(400, "Say why the entry is being corrected.");
  const clientKey = typeof body.clientId === "string" ? `${user.id}:${body.clientId}` : undefined;
  const dup = clientKey && s.stockLog.corrections.find((c) => c.clientKey === clientKey);
  if (dup) return { ok: true, correction: dup };
  const correction = mutateStore((x) => {
    const n = nextNumber(x, "WC");
    const c: SharedWasteCorrection = { id: `WC-S-${n}`, wasteId: id, qty: Math.round(qty * 1000) / 1000, reason, by: user.id, at: now(), seq: n, clientKey };
    x.stockLog.corrections.push(c);
    return c;
  });
  return { ok: true, correction };
}

/** A count from the floor. The expected figure is worked out here, not taken from the device. */
export function submitCount(user: User, body: Record<string, unknown>, expectedOf: (propertyId: string, ingredientId: string) => number | undefined): Result<{ count: SharedCount }> {
  const propertyId = String(body.propertyId ?? "");
  if (!can(user, "stock.count") || !allowedProperties(user).includes(propertyId)) return fail(403, "You cannot count stock at this hotel.");
  const ingredientId = String(body.ingredientId ?? "");
  if (!ingredientById[ingredientId]) return fail(400, "Choose an item to count.");
  const counted = Number(body.counted);
  if (!Number.isFinite(counted) || counted < 0 || counted > 1e6) return fail(400, "Enter the quantity you counted.");
  const expected = expectedOf(propertyId, ingredientId);
  if (expected === undefined) return fail(400, "This item is not held in a store you can count.");
  const clientKey = typeof body.clientId === "string" ? `${user.id}:${body.clientId}` : undefined;
  const s = loadStore();
  const dup = clientKey && s.stockLog.counts.find((c) => c.clientKey === clientKey);
  if (dup) return { ok: true, count: dup };
  const reviewer = can(user, "stock.review");
  const count = mutateStore((x) => {
    const n = nextNumber(x, "CS");
    const c: SharedCount = {
      id: `C-S-${n}`, propertyId, ingredientId, date: DEMO_TODAY, expected: Math.round(expected * 100) / 100, counted: Math.round(counted * 1000) / 1000, by: user.staffId ?? user.id, byUser: user.id, at: now(), seq: 1_000_000 + n,
      status: reviewer ? "accepted" : "submitted", allocation: ingredientById[ingredientId].dept === "glassware" ? {} : (body.allocation as Record<string, number>) ?? {}, note: text(body.note) || undefined, clientKey,
      ...(reviewer ? { reviewedBy: user.id, reviewedAt: now(), reviewNote: "Counted by a manager" } : {}),
    };
    x.stockLog.counts.push(c);
    if (c.status === "submitted") notify(x, { to: peopleWith("stock.review", propertyId, (u) => u.role === "restaurant_manager" || u.role === "purchasing"), type: "count-review", ref: c.id, propertyId, from: user.id, title: `Count to review: ${ingredientById[ingredientId].name}`, body: `${user.name} counted ${c.counted} (${ingredientById[ingredientId].unit}). Accept or reject it.`, href: "/stock?tab=counts" });
    return c;
  });
  return { ok: true, count };
}

export function reviewCount(user: User, id: string, body: Record<string, unknown>): Result<{ count: SharedCount }> {
  const s = loadStore();
  const c = s.stockLog.counts.find((x) => x.id === id);
  if (!c || !allowedProperties(user).includes(c.propertyId)) return fail(404, "This count is not available.");
  if (!can(user, "stock.review")) return fail(403, "Only a manager can accept or reject a count.");
  if (c.byUser === user.id) return fail(403, "Someone else must review your count.");
  if (c.status !== "submitted") return fail(409, "This count has already been reviewed.");
  const decision = body.decision === "accept" ? "accepted" : body.decision === "reject" ? "rejected" : null;
  if (!decision) return fail(400, "Accept or reject the count.");
  const note = text(body.note);
  if (decision === "rejected" && note.length < 3) return fail(400, "Say why, for example: recount needed.");
  const count = mutateStore((x) => {
    const y = x.stockLog.counts.find((z) => z.id === id)!;
    y.status = decision; y.reviewedBy = user.id; y.reviewedAt = now(); y.reviewNote = note || undefined;
    resolve(x, "count-review", y.id);
    return y;
  });
  return { ok: true, count };
}
