// Empty bottle scans on the server: the simulated history (lib/domain/empties.ts) plus the scans people save here,
// in the shared demo store with the user and role that made them. Over pouring reads both through emptyScans().
import { getDataset } from "../data/generate";
import { outletById } from "../data/catalog";
import { allowedOutlets, can } from "../domain/access";
import { POUR_SKUS, pourLog } from "../domain/pour";
import { BOTTLE_BARCODE, emptyOutlets, pourOutlets, scanMoment, scanningFrom, scansEmpties, seedEmptyScans, skuByBarcode, type EmptyScan } from "../domain/empties";
import type { Order, Role, User } from "../types";
import { DEMO_TODAY } from "../util";
import { loadStore, mutateStore, nextNumber } from "./purchasing-store";

type Fail = { ok: false; status: number; error: string };
type Result<T = object> = ({ ok: true } & T) | Fail;
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

const seeds = new WeakMap<readonly Order[], EmptyScan[]>();
/** The simulated scan history, worked out once per dataset. */
export function seededScans(): EmptyScan[] {
  const orders = getDataset().orders;
  const hit = seeds.get(orders);
  if (hit) return hit;
  const out = seedEmptyScans(pourLog(orders));
  seeds.set(orders, out);
  return out;
}

/** Every scan at one hotel: the simulated history and the scans saved here, taken back ones included (they carry withdrawnAt). */
export function emptyScans(propertyId: string): EmptyScan[] {
  return [...seededScans(), ...(loadStore().emptyScans ?? [])].filter((s) => s.propertyId === propertyId);
}

export interface MyScan { id: string; outletId: string; skuId: string; min: number; method: "scan" | "pick" }
export interface EmptiesView {
  /** Outlets this person may log empties at: theirs, where wine or spirits are poured and empties are scanned. */
  outlets: string[];
  bottles: { id: string; name: string; family: "wine" | "spirits"; barcode: string }[];
  /** This person's scans today, newest first, taken back ones left out. */
  mine: MyScan[];
}

const myScans = (user: User): MyScan[] => (loadStore().emptyScans ?? [])
  .filter((s) => s.byUser === user.id && s.date === DEMO_TODAY && !s.withdrawnAt)
  .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))
  .map((s) => ({ id: s.id, outletId: s.outletId, skuId: s.skuId, min: s.min, method: s.method }));

export function emptiesFor(user: User): Result<EmptiesView> {
  if (!can(user, "stock.logEmpty")) return fail(403, "Your role does not log empty bottles.");
  return {
    ok: true, outlets: emptyOutlets(allowedOutlets(user)),
    bottles: POUR_SKUS.map((s) => ({ id: s.id, name: s.name, family: s.family, barcode: BOTTLE_BARCODE[s.id] })),
    mine: myScans(user),
  };
}

/**
 * Saves one empty bottle, by barcode or picked from the list, for the business day and the demo's clock. `counted` says
 * whether Over pouring counts it now (the outlet's bottles come from scans), so the person is never told it counts when it does not.
 */
export function logEmpty(user: User, body: Record<string, unknown>): Result<{ scan: EmptyScan; mine: MyScan[]; counted: boolean }> {
  if (!can(user, "stock.logEmpty")) return fail(403, "Your role does not log empty bottles.");
  const outletId = String(body.outletId ?? "");
  if (!pourOutlets(allowedOutlets(user)).includes(outletId)) return fail(403, "You cannot log empty bottles for this outlet.");
  if (!scansEmpties(outletId)) return fail(409, `${outletById[outletId].name} does not scan its empties. Its bottles on Over pouring are simulated.`);
  const code = typeof body.barcode === "string" ? body.barcode.trim() : "";
  const sku = code ? skuByBarcode(code) : POUR_SKUS.find((s) => s.id === body.skuId);
  if (code && !sku) return fail(404, `No bottle has the barcode ${code.slice(0, 20)}. Tap the bottle instead.`);
  if (!sku) return fail(400, "Choose the bottle.");
  const clientKey = typeof body.clientId === "string" && body.clientId.length < 60 ? `${user.id}:${body.clientId}` : undefined;
  const dup = clientKey && (loadStore().emptyScans ?? []).find((s) => s.clientKey === clientKey);
  const counted = () => scanningFrom(emptyScans(outletById[outletId].propertyId)).has(outletId);
  if (dup) return { ok: true, scan: dup, mine: myScans(user), counted: counted() };
  const scan = mutateStore((x) => {
    const n = nextNumber(x, "ES");
    const s: EmptyScan = {
      id: `ES-${outletById[outletId].code}-${n}`, propertyId: outletById[outletId].propertyId, outletId, skuId: sku.id, ...scanMoment(),
      by: user.staffId ?? user.id, byUser: user.id, role: user.role as Role, method: code ? "scan" : "pick", at: new Date().toISOString(), ...(clientKey ? { clientKey } : {}),
    };
    x.emptyScans = [...(x.emptyScans ?? []), s];
    return s;
  });
  return { ok: true, scan, mine: myScans(user), counted: counted() };
}

/** Takes back one of your own scans from today. It stays on record, marked, and stops counting. */
export function undoEmpty(user: User, body: Record<string, unknown>): Result<{ scan: EmptyScan; mine: MyScan[] }> {
  if (!can(user, "stock.logEmpty")) return fail(403, "Your role does not log empty bottles.");
  const id = String(body.id ?? "");
  const found = (loadStore().emptyScans ?? []).find((s) => s.id === id);
  if (!found || found.byUser !== user.id) return fail(404, "That scan is not one of yours.");
  if (found.withdrawnAt) return fail(409, "That scan was already taken back.");
  if (found.date !== DEMO_TODAY) return fail(409, "Only today's scans can be taken back.");
  const scan = mutateStore((x) => {
    const s = (x.emptyScans ?? []).find((y) => y.id === id)!;
    s.withdrawnBy = user.id;
    s.withdrawnAt = new Date().toISOString();
    return s;
  });
  return { ok: true, scan, mine: myScans(user) };
}
