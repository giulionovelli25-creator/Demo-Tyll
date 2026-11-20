// Purchasing master data and the purchase order lifecycle beyond approval: suppliers per hotel and their catalogues,
// par levels and To order, purchase orders by supplier, sending by email as a PDF, the three way match per order,
// credit requests, closing, price history, stock valuation and the procurement export.
// Simulated where it would touch the outside world: emails to suppliers are logged with their PDF, never sent.
import fs from "node:fs";
import path from "node:path";
import { ingredientById, outletById, outletsOfProperty, propertyById, storeOwner, userById } from "../data/catalog";
import { getDataset, getOutletStock } from "../data/generate";
import { APPROVAL_POLICY, supplierName } from "../data/purchasing-rules";
import { STOCK_AREAS, stockAreaOf } from "../data/locations";
import { allowedOutlets, allowedProperties, can } from "../domain/access";
import { usageFromSales } from "../domain/inventory";
import {
  PO_STATUS, VALUATION_LABEL, VAT_SCHEMES, ceilToPack, creditLines, nextDeliveryDate, orderTotals, outstanding, parTrigger, poStatus, suggestPar, threeWay,
  valueOnHand, type Lot, type MatchLineIn, type Par,
} from "../domain/procurement";
import type { CatalogueLine, CreditRequest, OutboxEmail, ParRecord, PurchaseRequest, PurchasingSettings, RequestLine, SupplierAccount, User, ValuationMethod } from "../types";
import { DEMO_NOW_MIN, DEMO_TODAY, fmtMoney, round2, sum, timeIn, unitLabel } from "../util";
import { dataFile } from "./data-file";
import { workspaceFile } from "./workspace";
import { PdfDoc } from "./pdf";
import { canSee, type Result } from "./purchasing";
import { loadStore, mutateStore, nextNumber, type Shape } from "./purchasing-store";
import { issueStep, seedProcurement } from "./procurement-seed";
import { stockFor, type SessionEntries } from "./stock";

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
const now = () => new Date().toISOString();
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const text = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const OPEN_STATUSES = ["purchasing", "accounting", "fnb", "manager", "approved"];
export const poRef = (r: Pick<PurchaseRequest, "poNumber" | "id">) => r.poNumber ?? r.id;

// ---- Master data -------------------------------------------------------------------------------------------------

export const procurementOf = (s: Shape = loadStore()) => s.procurement ?? seedProcurement();

const DEFAULT_SETTINGS: PurchasingSettings = { valuation: "wac", vatScheme: "PT", costCentres: [{ id: "4100", name: "F&B food" }, { id: "4200", name: "F&B beverage" }, { id: "4500", name: "Operating supplies" }] };
export const settingsOf = (propertyId: string, s?: Shape): PurchasingSettings => procurementOf(s).settings[propertyId] ?? DEFAULT_SETTINGS;

export const supplierAccount = (propertyId: string, supplierId: string, s?: Shape): SupplierAccount | undefined =>
  procurementOf(s).suppliers.find((x) => x.propertyId === propertyId && x.id === supplierId);

/** The catalogue lines for an item at a hotel, the preferred supplier first. */
export const catalogueFor = (propertyId: string, ingredientId: string, s?: Shape): CatalogueLine[] =>
  procurementOf(s).catalogue.filter((c) => c.propertyId === propertyId && c.ingredientId === ingredientId).sort((a, b) => Number(b.preferred) - Number(a.preferred));

export const catalogueLine = (propertyId: string, supplierId: string, ingredientId: string, s?: Shape) =>
  procurementOf(s).catalogue.find((c) => c.propertyId === propertyId && c.supplierId === supplierId && c.ingredientId === ingredientId);

/** Who may change suppliers, catalogues, par levels and purchasing settings: purchasing, the F&B director and the general manager. */
export const mayManage = (user: User) => can(user, "purchase.review") || can(user, "purchase.approveFnb") || can(user, "purchase.approveManager");
const mayPar = (user: User) => mayManage(user) || can(user, "stock.review");

const locationName = (location: string) => (location === "main" ? "Main store" : outletById[location]?.name ?? location);
const unitWord = (ingredientId: string) => (ingredientById[ingredientId].unit === "each" ? "units" : unitLabel(ingredientById[ingredientId].unit));

/** Quantity still to arrive on open orders, by item. An order waiting for approval counts in full. */
export function onOrderMap(propertyId: string, s: Shape = loadStore()): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of s.requests) {
    if (r.propertyId !== propertyId || r.eventId || !OPEN_STATUSES.includes(r.status)) continue;
    for (const l of r.lines) out.set(l.ingredientId, (out.get(l.ingredientId) ?? 0) + (r.status === "approved" ? outstanding(l) : l.qty));
  }
  return out;
}

// ---- Price history -----------------------------------------------------------------------------------------------

export interface PricePoint { date: string; ingredientId: string; supplierId: string; price: number; agreed: number | null; above: boolean; ref: string; source: "invoice" }

/** Prices actually invoiced, item by item: the dataset's supplier invoices and invoices recorded in Tyll. */
export function pricePoints(propertyId: string, s: Shape = loadStore()): PricePoint[] {
  const out: PricePoint[] = [];
  const add = (date: string, ingredientId: string, supplierId: string, price: number, ref: string) => {
    const agreed = catalogueLine(propertyId, supplierId, ingredientId, s)?.agreedPrice ?? null;
    out.push({ date, ingredientId, supplierId, price: round2(price), agreed, above: agreed !== null && price > agreed + 0.005, ref, source: "invoice" });
  };
  for (const d of getDataset().deliveries) {
    if (d.propertyId !== propertyId || d.status !== "delivered") continue;
    for (const l of d.lines) if (l.invoiced > 0) add(d.date, l.ingredientId, d.supplierId, l.invoicePrice, `INV-${d.id.replace(/^PO-/, "")}`);
  }
  for (const i of s.finance.invoices) {
    if (i.propertyId !== propertyId) continue;
    for (const l of i.lines) if (l.qty > 0) add(i.date, l.ingredientId, i.supplierId, l.unitPrice, i.id);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
}

/** The latest invoiced price for an item from a supplier: purchase prices follow the invoices. */
export function lastPrice(propertyId: string, supplierId: string, ingredientId: string, points = pricePoints(propertyId)): PricePoint | undefined {
  return points.filter((p) => p.supplierId === supplierId && p.ingredientId === ingredientId).at(-1);
}

export function priceHistoryFor(user: User, propertyId: string, ingredientId?: string): Result<{ points: PricePoint[]; above: PricePoint[] }> {
  if (!can(user, "purchase.create") && !can(user, "finance.view")) return fail(403, "Your role cannot see purchase prices.");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const points = pricePoints(propertyId).filter((p) => !ingredientId || p.ingredientId === ingredientId);
  return { ok: true, points, above: points.filter((p) => p.above) };
}

// ---- Suppliers and catalogues ------------------------------------------------------------------------------------

export interface CatalogueView extends CatalogueLine { name: string; unit: string; lastPrice: number | null; lastDate: string | null; aboveAgreed: boolean }
export interface SupplierView extends SupplierAccount { items: number; openOrders: number; openValue: number; spend30: number; aboveAgreed: number }

export function suppliersFor(user: User, propertyId: string): Result<{ suppliers: SupplierView[]; catalogue: CatalogueView[]; mayEdit: boolean; currency: string }> {
  if (!can(user, "purchase.create")) return fail(403, "Your role cannot see suppliers.");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const s = loadStore();
  const p = procurementOf(s);
  const points = pricePoints(propertyId, s);
  const catalogue: CatalogueView[] = p.catalogue.filter((c) => c.propertyId === propertyId).map((c) => {
    const last = lastPrice(propertyId, c.supplierId, c.ingredientId, points);
    return { ...c, name: ingredientById[c.ingredientId].name, unit: unitWord(c.ingredientId), lastPrice: last?.price ?? null, lastDate: last?.date ?? null, aboveAgreed: !!last?.above };
  });
  const from = DEMO_NOW_MIN >= 0 ? new Date(Date.parse(`${DEMO_TODAY}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10) : DEMO_TODAY;
  const suppliers: SupplierView[] = p.suppliers.filter((x) => x.propertyId === propertyId).map((x) => {
    const open = s.requests.filter((r) => r.propertyId === propertyId && OPEN_STATUSES.includes(r.status) && (r.supplierId ?? r.lines[0]?.supplierId) === x.id);
    const spend = getDataset().deliveries.filter((d) => d.propertyId === propertyId && d.supplierId === x.id && d.status === "delivered" && d.date >= from).reduce((t, d) => t + sum(d.lines, (l) => l.invoiced * l.invoicePrice), 0);
    return { ...x, items: catalogue.filter((c) => c.supplierId === x.id).length, openOrders: open.length, openValue: round2(sum(open, (r) => sum(r.lines, (l) => l.qty * l.unitPrice))), spend30: round2(spend), aboveAgreed: catalogue.filter((c) => c.supplierId === x.id && c.aboveAgreed).length };
  }).sort((a, b) => b.spend30 - a.spend30 || a.name.localeCompare(b.name));
  return { ok: true, suppliers, catalogue, mayEdit: mayManage(user), currency: propertyById[propertyId].currency };
}

const DAYS = [0, 1, 2, 3, 4, 5, 6];
/** Changes a supplier's terms at one hotel. Other hotels keep their own terms with the same company. */
export function saveSupplier(user: User, propertyId: string, body: Record<string, unknown>): Result<{ supplier: SupplierAccount }> {
  if (!mayManage(user)) return fail(403, "Only purchasing, the F&B director or the general manager can change suppliers.");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const cur = supplierAccount(propertyId, String(body.id ?? ""));
  if (!cur) return fail(404, "This supplier is not set up at this hotel.");
  const next: SupplierAccount = { ...cur };
  if (body.contact !== undefined) next.contact = text(body.contact, 80);
  if (body.phone !== undefined) next.phone = text(body.phone, 40);
  if (body.orderEmail !== undefined) {
    const e = text(body.orderEmail, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return fail(400, "Enter a valid order email address.");
    next.orderEmail = e;
  }
  if (body.deliveryDays !== undefined) {
    if (!Array.isArray(body.deliveryDays) || !body.deliveryDays.length || body.deliveryDays.some((d) => !DAYS.includes(d as number))) return fail(400, "Choose at least one delivery day.");
    next.deliveryDays = [...new Set(body.deliveryDays as number[])].sort();
  }
  if (body.cutOff !== undefined) {
    if (typeof body.cutOff !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.cutOff)) return fail(400, "Enter the cut-off time as HH:MM.");
    next.cutOff = body.cutOff;
  }
  if (body.minOrderValue !== undefined) {
    const v = Number(body.minOrderValue);
    if (!Number.isFinite(v) || v < 0 || v > 100000) return fail(400, "Enter a minimum order value.");
    next.minOrderValue = round2(v);
  }
  if (body.paymentTerms !== undefined) next.paymentTerms = text(body.paymentTerms, 80) || cur.paymentTerms;
  if (body.leadDays !== undefined) {
    const v = Number(body.leadDays);
    if (!Number.isInteger(v) || v < 0 || v > 30) return fail(400, "Enter the lead time in whole days.");
    next.leadDays = v;
  }
  if (body.active !== undefined) next.active = body.active === true;
  const supplier = mutateStore((x) => {
    x.procurement ??= seedProcurement();
    const i = x.procurement.suppliers.findIndex((y) => y.propertyId === propertyId && y.id === cur.id);
    x.procurement.suppliers[i] = next;
    return next;
  });
  return { ok: true, supplier };
}

/** Changes a catalogue line: agreed price, pack, VAT rate, or which supplier is preferred for the item. */
export function saveCatalogueLine(user: User, propertyId: string, body: Record<string, unknown>): Result<{ line: CatalogueLine }> {
  if (!mayManage(user)) return fail(403, "Only purchasing, the F&B director or the general manager can change the catalogue.");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const cur = catalogueLine(propertyId, String(body.supplierId ?? ""), String(body.ingredientId ?? ""));
  if (!cur) return fail(404, "This item is not in the supplier's catalogue.");
  const next: CatalogueLine = { ...cur };
  if (body.agreedPrice !== undefined) {
    const v = Number(body.agreedPrice);
    if (!Number.isFinite(v) || v <= 0 || v > 100000) return fail(400, "Enter the agreed price per unit.");
    next.agreedPrice = round2(v);
  }
  if (body.packSize !== undefined) {
    const v = Number(body.packSize);
    if (!Number.isFinite(v) || v <= 0 || v > 10000) return fail(400, "Enter the pack size.");
    next.packSize = r3(v);
  }
  if (body.packLabel !== undefined) next.packLabel = text(body.packLabel, 40) || cur.packLabel;
  if (body.vatRate !== undefined) {
    const v = Number(body.vatRate);
    if (!Number.isFinite(v) || v < 0 || v > 0.3) return fail(400, "Enter the VAT rate, for example 0.06 for 6%.");
    next.vatRate = v;
  }
  const line = mutateStore((x) => {
    x.procurement ??= seedProcurement();
    if (body.preferred === true) for (const c of x.procurement.catalogue) if (c.propertyId === propertyId && c.ingredientId === cur.ingredientId) c.preferred = c.supplierId === cur.supplierId;
    const i = x.procurement.catalogue.findIndex((c) => c.propertyId === propertyId && c.supplierId === cur.supplierId && c.ingredientId === cur.ingredientId);
    x.procurement.catalogue[i] = { ...next, preferred: body.preferred === true ? true : x.procurement.catalogue[i].preferred };
    return x.procurement.catalogue[i];
  });
  return { ok: true, line };
}

// ---- Par levels and To order -------------------------------------------------------------------------------------

export interface ParRow {
  ingredientId: string; name: string; unit: string; location: string; locationName: string; area: string;
  /** The main store orders from suppliers; an outlet is topped up from the main store. */
  action: "order" | "issue";
  onHand: number; onHandAt: string | null; onOrder: number; min: number; max: number; source: ParRecord["source"]; suggested: Par; avgDaily: number;
  below: boolean; qty: number; covered: boolean;
  supplierId: string; supplierName: string; packSize: number; packLabel: string; unitPrice: number; vatRate: number; value: number;
  /** A draft purchase order of this user's that already has the item. Drafts are not orders yet, so they do not count as on order. */
  inDraft?: string;
}

/** Every par level the user can see, with stock against it: the main store from the stock position, an outlet from its last count. */
export function parRows(user: User, propertyId: string, entries: SessionEntries): ParRow[] {
  const s = loadStore();
  const p = procurementOf(s);
  const onOrder = onOrderMap(propertyId, s);
  const stock = new Map(stockFor(user, propertyId, entries).map((r) => [r.ingredientId, r]));
  const drafts = s.requests.filter((r) => r.propertyId === propertyId && r.status === "draft" && r.createdBy === user.id && r.supplierId);
  const draftOf = (g: string) => drafts.find((r) => r.lines.some((l) => l.ingredientId === g && l.qty > 0))?.id;
  const outlets = new Set(allowedOutlets(user));
  const checks = getOutletStock().checks;
  const lastCheck = (outletId: string, ingredientId: string) => checks.filter((c) => c.outletId === outletId && c.ingredientId === ingredientId).sort((a, b) => a.date.localeCompare(b.date) || a.min - b.min).at(-1);
  const from = new Date(Date.parse(`${DEMO_TODAY}T00:00:00Z`) - 28 * 86400000).toISOString().slice(0, 10);
  const useCache = new Map<string, Map<string, number>>();
  const outletUse = (outletId: string, ingredientId: string) => {
    let m = useCache.get(outletId);
    if (!m) useCache.set(outletId, (m = usageFromSales(getDataset().dayItems, (r) => r.outletId === outletId && r.date >= from && r.date < DEMO_TODAY)));
    return (m.get(ingredientId) ?? 0) / 28;
  };
  return p.pars.filter((x) => x.propertyId === propertyId && (x.location === "main" || outlets.has(x.location))).flatMap((par): ParRow[] => {
    const line = catalogueFor(propertyId, par.ingredientId, s)[0];
    const row = stock.get(par.ingredientId);
    if (!line || !row) return [];
    const base = { ingredientId: par.ingredientId, name: ingredientById[par.ingredientId].name, unit: unitWord(par.ingredientId), location: par.location, locationName: locationName(par.location), area: stockAreaOf(par.ingredientId), min: par.min, max: par.max, source: par.source, supplierId: line.supplierId, supplierName: supplierName(line.supplierId), packSize: line.packSize, packLabel: line.packLabel, unitPrice: line.agreedPrice, vatRate: line.vatRate };
    if (par.location === "main") {
      const acct = supplierAccount(propertyId, line.supplierId, s);
      const cycle = acct ? Math.max(1, Math.round(7 / acct.deliveryDays.length)) : 3;
      const onHand = Math.max(0, row.estimated);
      const ordered = onOrder.get(par.ingredientId) ?? 0;
      const t = parTrigger(onHand, ordered, par, line.packSize);
      return [{ ...base, action: "order", inDraft: draftOf(par.ingredientId), onHand: r3(onHand), onHandAt: null, onOrder: r3(ordered), suggested: suggestPar(row.avgDaily, acct?.leadDays ?? ingredientById[par.ingredientId].leadDays, cycle, 1, line.packSize), avgDaily: r3(row.avgDaily), below: t.below, qty: t.qty, covered: t.covered, value: round2(t.qty * line.agreedPrice) }];
    }
    const check = lastCheck(par.location, par.ingredientId);
    const onHand = check?.counted ?? 0;
    const step = issueStep(par.ingredientId);
    const t = parTrigger(onHand, 0, par, step);
    const use = outletUse(par.location, par.ingredientId);
    return [{ ...base, action: "issue", onHand: r3(onHand), onHandAt: check ? `${check.date}T${hhmm(check.min)}` : null, onOrder: 0, suggested: { min: Math.max(step, Math.ceil(use / step - 1e-9) * step), max: Math.max(step, Math.ceil((use * 2.5) / step - 1e-9) * step) }, avgDaily: r3(use), below: t.below, qty: t.qty, covered: t.covered, value: round2(t.qty * row.unitCost) }];
  });
}

export function parsFor(user: User, propertyId: string, entries: SessionEntries): Result<{ rows: ParRow[]; mayEdit: boolean }> {
  if (!can(user, "purchase.create") && !can(user, "stock.review")) return fail(403, "Your role cannot see par levels.");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  return { ok: true, rows: parRows(user, propertyId, entries), mayEdit: mayPar(user) };
}

/** Sets an item's minimum and maximum, or takes the levels the prediction suggests for a list of items. */
export function savePar(user: User, propertyId: string, body: Record<string, unknown>, entries: SessionEntries): Result<{ pars: ParRecord[] }> {
  if (!mayPar(user)) return fail(403, "Only a manager or purchasing can change par levels.");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const rows = new Map(parRows(user, propertyId, entries).map((r) => [`${r.location}|${r.ingredientId}`, r]));
  const changes: { location: string; ingredientId: string; min: number; max: number; source: ParRecord["source"] }[] = [];
  if (body.apply === "suggested") {
    // Keys are "location|item"; a bare item id means its main store level.
    const keys = Array.isArray(body.keys) ? (body.keys as unknown[]).map(String) : [...rows.keys()];
    for (const k of keys.slice(0, 500)) {
      const r = rows.get(k.includes("|") ? k : `main|${k}`);
      if (r && r.suggested.max > 0) changes.push({ location: r.location, ingredientId: r.ingredientId, min: r.suggested.min, max: r.suggested.max, source: "suggested" });
    }
  } else {
    const id = String(body.ingredientId ?? "");
    const location = String(body.location ?? "main");
    if (!rows.has(`${location}|${id}`)) return fail(404, "This item has no par level you can change.");
    const min = Number(body.min), max = Number(body.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0 || max > 1e5) return fail(400, "Enter a minimum and a maximum.");
    if (max < min) return fail(400, "The maximum must be at least the minimum.");
    changes.push({ location, ingredientId: id, min: r3(min), max: r3(max), source: "set" });
  }
  if (!changes.length) return fail(400, "Nothing to change.");
  const at = now();
  const pars = mutateStore((x) => {
    x.procurement ??= seedProcurement();
    for (const c of changes) {
      const p = x.procurement.pars.find((y) => y.propertyId === propertyId && y.location === c.location && y.ingredientId === c.ingredientId);
      if (p) Object.assign(p, { min: c.min, max: c.max, source: c.source, by: user.id, at });
    }
    return x.procurement.pars.filter((y) => y.propertyId === propertyId && changes.some((c) => c.location === y.location && c.ingredientId === y.ingredientId));
  });
  return { ok: true, pars };
}

export function toOrderFor(user: User, propertyId: string, entries: SessionEntries): Result<{ rows: ParRow[]; mayCreate: boolean }> {
  const all = parsFor(user, propertyId, entries);
  if (!all.ok) return all;
  return { ok: true, rows: all.rows.filter((r) => r.below).sort((a, b) => a.action.localeCompare(b.action) || Number(a.covered) - Number(b.covered) || b.value - a.value), mayCreate: can(user, "purchase.create") };
}

// ---- Purchase orders by supplier ---------------------------------------------------------------------------------

export const costCentreFor = (lines: { ingredientId: string }[], settings: PurchasingSettings) => {
  const areas = lines.map((l) => stockAreaOf(l.ingredientId));
  const id = areas.every((a) => a === "drinks") ? "4200" : areas.every((a) => a === "inventory") ? "4500" : "4100";
  return settings.costCentres.find((c) => c.id === id) ? `${id} ${settings.costCentres.find((c) => c.id === id)!.name}` : settings.costCentres[0] ? `${settings.costCentres[0].id} ${settings.costCentres[0].name}` : undefined;
};

export interface CreateLine { ingredientId: string; qty: number; supplierId?: string; available?: number; incoming?: number; requirement?: number; suggested?: number }

/**
 * One click from To order or the recommended list: draft purchase orders, one per supplier and delivery location, at the
 * catalogue's agreed prices and packs, for the supplier's next delivery day. A draft already open for the same supplier
 * and location is updated rather than duplicated.
 */
export function createPurchaseOrders(user: User, propertyId: string, raw: unknown, opts: { source: "par" | "prediction" | "manual"; notes?: string } = { source: "manual" }): Result<{ orders: PurchaseRequest[]; warnings: string[] }> {
  if (!can(user, "purchase.create")) return fail(403, "Your role cannot create purchase orders.");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  if (!Array.isArray(raw) || !raw.length) return fail(400, "Choose at least one item to order.");
  if (raw.length > 300) return fail(400, "That is too many items for one go.");
  const s = loadStore();
  const settings = settingsOf(propertyId, s);
  const groups = new Map<string, { supplierId: string; location: string; lines: RequestLine[] }>();
  const rounded: string[] = [];
  for (const x of raw as CreateLine[]) {
    const g = ingredientById[String(x?.ingredientId)];
    if (!g) return fail(400, "Unknown item on the order.");
    const qty = Number(x.qty);
    if (!Number.isFinite(qty) || qty < 0 || qty > 100000) return fail(400, `Enter a quantity for ${g.name}.`);
    if (qty === 0) continue;
    const line = x.supplierId ? catalogueLine(propertyId, x.supplierId, g.id, s) : catalogueFor(propertyId, g.id, s)[0];
    if (!line) return fail(400, `${g.name} is not in any supplier's catalogue at this hotel.`);
    const owner = storeOwner(propertyId, g.id);
    if (owner && !allowedOutlets(user).includes(owner)) return fail(403, `${g.name} is held in another outlet's own store.`);
    const location = owner ?? "main";
    const key = `${line.supplierId}|${location}`;
    const grp = groups.get(key) ?? { supplierId: line.supplierId, location, lines: [] };
    if (grp.lines.some((l) => l.ingredientId === g.id)) return fail(400, `${g.name} appears twice.`);
    const packed = ceilToPack(qty, line.packSize);
    if (packed - qty > 1e-6) rounded.push(`${g.name}: ${r3(qty)} rounded up to ${packed} ${unitWord(g.id)}, whole packs of ${line.packLabel.toLowerCase()}.`);
    grp.lines.push({ ingredientId: g.id, qty: packed, suggested: r3(Number.isFinite(Number(x.suggested)) && x.suggested !== undefined ? Number(x.suggested) : qty), requirement: r3(Number(x.requirement) || 0), available: r3(Number(x.available) || 0), incoming: r3(Number(x.incoming) || 0), safety: 0, supplierId: line.supplierId, unitPrice: line.agreedPrice, vatRate: line.vatRate, packSize: line.packSize, packLabel: line.packLabel });
    groups.set(key, grp);
  }
  if (!groups.size) return fail(400, "Every quantity is zero, so there is nothing to order.");
  const warnings: string[] = [...rounded];
  const money = (n: number) => fmtMoney(n, propertyById[propertyId].currency);
  const stamp = now();
  const from = { par: "To order", prediction: "the recommended order on Predictions", manual: "a manual order" }[opts.source];
  const orders = mutateStore((st) => {
    const made: PurchaseRequest[] = [];
    for (const grp of groups.values()) {
      const acct = supplierAccount(propertyId, grp.supplierId, st);
      const lead = Math.max(acct?.leadDays ?? 1, ...grp.lines.map((l) => ingredientById[l.ingredientId].leadDays));
      const deliveryDate = nextDeliveryDate(DEMO_TODAY, DEMO_NOW_MIN, acct?.cutOff ?? "14:00", lead, acct?.deliveryDays ?? []);
      const open = st.requests.find((r) => r.propertyId === propertyId && r.createdBy === user.id && r.status === "draft" && r.supplierId === grp.supplierId && (grp.location === "main" ? r.outletIds.length !== 1 || outletsOfProperty(propertyId).length === 1 : r.outletIds[0] === grp.location) && !r.eventId && !r.deptId);
      if (open) {
        for (const l of grp.lines) {
          const i = open.lines.findIndex((x) => x.ingredientId === l.ingredientId);
          if (i >= 0) open.lines[i] = l; else open.lines.push(l);
        }
        open.deliveryDate = deliveryDate;
        open.updatedAt = stamp;
        open.history.push({ at: stamp, by: user.id, action: `Draft updated from ${from}`, status: "draft" });
        made.push(open);
        continue;
      }
      st.seq += 1;
      const id = `PR-${propertyId.toUpperCase()}-${String(st.seq).padStart(4, "0")}`;
      const r: PurchaseRequest = {
        id, propertyId, outletIds: grp.location === "main" ? outletsOfProperty(propertyId).map((o) => o.id) : [grp.location], period: { from: deliveryDate, to: deliveryDate },
        createdBy: user.id, createdAt: stamp, updatedAt: stamp, status: "draft", lines: grp.lines, supplierId: grp.supplierId, deliveryDate,
        costCentre: costCentreFor(grp.lines, settings), comment: opts.notes ? text(opts.notes, 600) : undefined,
        history: [{ at: stamp, by: user.id, action: `Draft purchase order created from ${from}`, status: "draft" }],
      };
      st.requests.push(r);
      made.push(r);
    }
    return made;
  });
  for (const r of orders) {
    const acct = supplierAccount(propertyId, r.supplierId!);
    const t = orderTotals(r.lines);
    if (acct && t.net < acct.minOrderValue) warnings.push(`${acct.name}: this order is ${money(t.net)}, below the supplier's minimum order of ${money(acct.minOrderValue)}.`);
  }
  return { ok: true, orders, warnings };
}

/** The author changes a draft: delivery date, cost centre, notes and quantities. */
export function updatePurchaseOrder(user: User, id: string, body: Record<string, unknown>): Result<{ request: PurchaseRequest }> {
  const r = loadStore().requests.find((x) => x.id === id);
  if (!r || !canSee(user, r)) return fail(404, "This order is not available.");
  if (r.createdBy !== user.id || !["draft", "changes"].includes(r.status)) return fail(403, "Only the author can change an order, and only before it is submitted or when changes are requested.");
  const settings = settingsOf(r.propertyId);
  const patch: Partial<PurchaseRequest> = {};
  if (body.deliveryDate !== undefined) {
    if (typeof body.deliveryDate !== "string" || !ISO.test(body.deliveryDate) || body.deliveryDate <= DEMO_TODAY) return fail(400, "Choose a delivery date after today.");
    patch.deliveryDate = body.deliveryDate;
  }
  if (body.costCentre !== undefined) {
    const c = settings.costCentres.find((x) => `${x.id} ${x.name}` === body.costCentre);
    if (!c) return fail(400, "Choose one of the hotel's cost centres.");
    patch.costCentre = `${c.id} ${c.name}`;
  }
  if (body.comment !== undefined) patch.comment = text(body.comment, 600) || undefined;
  let lines: RequestLine[] | undefined;
  if (body.lines !== undefined) {
    if (!Array.isArray(body.lines)) return fail(400, "Send the lines as a list.");
    lines = r.lines.map((l) => {
      const x = (body.lines as { ingredientId?: string; qty?: number }[]).find((y) => y.ingredientId === l.ingredientId);
      return x && Number.isFinite(Number(x.qty)) && Number(x.qty) >= 0 ? { ...l, qty: ceilToPack(Number(x.qty), l.packSize ?? 0) } : l;
    });
    if (!lines.some((l) => l.qty > 0)) return fail(400, "Keep a quantity on at least one item.");
  }
  const request = mutateStore((s) => {
    const x = s.requests.find((y) => y.id === id)!;
    Object.assign(x, patch);
    if (lines) x.lines = lines;
    if (patch.deliveryDate) x.period = { from: patch.deliveryDate, to: patch.deliveryDate };
    x.updatedAt = now();
    x.history.push({ at: x.updatedAt, by: user.id, action: "Draft updated", status: x.status });
    return x;
  });
  return { ok: true, request };
}

// ---- The purchase order document and sending ---------------------------------------------------------------------

/** The purchase order as a PDF, from the record as it stands. */
export function purchaseOrderPdf(r: PurchaseRequest): Buffer {
  const prop = propertyById[r.propertyId];
  const sup = r.supplierId ?? r.lines[0]?.supplierId ?? "";
  const acct = supplierAccount(r.propertyId, sup);
  const currency = prop.currency;
  const money = (n: number, d = true) => fmtMoney(n, currency, { decimals: d });
  const settings = settingsOf(r.propertyId);
  const t = orderTotals(r.lines);
  const doc = new PdfDoc();
  const L = 48, R = doc.width - 48;
  doc.text(L, 48, prop.name, { size: 11, bold: true });
  doc.text(L, 64, `Purchasing, ${prop.city}`, { size: 9, gray: 0.35 });
  doc.text(R, 46, "Purchase order", { size: 20, bold: true, align: "right" });
  doc.text(R, 72, poRef(r), { size: 11, align: "right" });
  doc.line(L, 92, R, 92, 0.8, 0.2);
  const approvedAt = r.history.find((h) => h.status === "approved")?.at;
  const field = (x: number, y: number, k: string, v: string) => { doc.text(x, y, k, { size: 8, gray: 0.4 }); doc.fit(x, y + 11, v, 230, { size: 10 }); };
  field(L, 104, "Supplier", acct?.name ?? supplierName(sup));
  field(L, 132, "Contact", [acct?.contact, acct?.phone].filter(Boolean).join(", ") || "Not recorded");
  field(L, 160, "Order email", acct?.orderEmail ?? "Not recorded");
  field(L, 188, "Payment terms", acct?.paymentTerms ?? "As agreed");
  field(310, 104, "Order date", (approvedAt ?? r.createdAt).slice(0, 10));
  field(310, 132, "Delivery date", r.deliveryDate ?? r.period.from);
  field(310, 160, "Deliver to", r.outletIds.length === 1 ? `${outletById[r.outletIds[0]].name}, ${prop.name}` : `Receiving, ${prop.name}`);
  field(310, 188, "Cost centre", r.costCentre ?? "Not set");
  let y = 226;
  // Right edges for the figures, so they line up and never touch.
  const cols = { code: L, item: L + 60, pack: L + 200, qty: L + 352, price: L + 412, vat: L + 444, net: R };
  doc.rect(L, y - 4, R - L, 18, 0.93);
  doc.text(cols.code + 4, y, "Code", { size: 8, bold: true });
  doc.text(cols.item, y, "Item", { size: 8, bold: true });
  doc.text(cols.pack, y, "Pack", { size: 8, bold: true });
  doc.text(cols.qty, y, "Quantity", { size: 8, bold: true, align: "right" });
  doc.text(cols.price, y, "Unit price", { size: 8, bold: true, align: "right" });
  doc.text(cols.vat, y, "VAT", { size: 8, bold: true, align: "right" });
  doc.text(cols.net - 4, y, "Net", { size: 8, bold: true, align: "right" });
  y += 22;
  for (const l of r.lines) {
    if (y > doc.height - 150) { doc.addPage(); y = 60; }
    const g = ingredientById[l.ingredientId];
    const c = catalogueLine(r.propertyId, l.supplierId, l.ingredientId);
    doc.text(cols.code + 4, y, c?.code ?? "", { size: 8, gray: 0.35 });
    doc.fit(cols.item, y, g.name, 134, { size: 9 });
    doc.fit(cols.pack, y, l.packLabel ?? "", 96, { size: 8, gray: 0.35 });
    doc.text(cols.qty, y, `${r3(l.qty)} ${unitWord(l.ingredientId)}`, { size: 9, align: "right" });
    doc.text(cols.price, y, money(l.unitPrice), { size: 9, align: "right" });
    doc.text(cols.vat, y, `${Math.round((l.vatRate ?? 0) * 100)}%`, { size: 9, align: "right" });
    doc.text(cols.net - 4, y, money(l.qty * l.unitPrice), { size: 9, align: "right" });
    y += 16;
    doc.line(L, y - 4, R, y - 4, 0.3, 0.88);
  }
  y += 8;
  const total = (label: string, value: string, bold = false) => { doc.text(R - 120, y, label, { size: 9, bold, align: "right" }); doc.text(R - 4, y, value, { size: bold ? 11 : 9, bold, align: "right" }); y += bold ? 20 : 15; };
  total("Net", money(t.net));
  for (const v of t.rates) total(`VAT ${Math.round(v.rate * 100)}% on ${money(v.net)}`, money(v.vat));
  total(`Total (${currency})`, money(t.gross), true);
  y += 6;
  if (r.comment) { doc.text(L, y, "Notes", { size: 8, gray: 0.4 }); doc.fit(L, y + 11, r.comment, R - L, { size: 9 }); y += 30; }
  const approver = [...r.history].reverse().find((h) => h.status === "approved");
  doc.text(L, y, `Approved by ${approver ? userById[approver.by]?.name ?? approver.by : "Not approved"}. Prices are the agreed prices in ${currency}, before VAT unless stated.`, { size: 8, gray: 0.35 });
  doc.text(L, y + 12, `Please quote ${poRef(r)} on the delivery note and the invoice. VAT: ${VAT_SCHEMES[settings.vatScheme].label}.`, { size: 8, gray: 0.35 });
  doc.line(L, doc.height - 56, R, doc.height - 56, 0.5, 0.8);
  doc.text(L, doc.height - 48, "Made with Tyll. Demo document: the hotel, supplier and prices are fictional.", { size: 7, gray: 0.5 });
  return doc.toBuffer({ title: `Purchase order ${poRef(r)}`, author: prop.name });
}

/** Purchase order PDFs belong to the workspace whose order they print, so one visitor never opens another's. */
const pdfPath = (name: string) => workspaceFile(`po/${name}`, () => dataFile(`po/${name}`));
export function readPurchaseOrderPdf(user: User, id: string): Result<{ name: string; bytes: Buffer }> {
  const r = loadStore().requests.find((x) => x.id === id);
  if (!r || !canSee(user, r)) return fail(404, "This order is not available.");
  if (r.sent?.pdf && fs.existsSync(pdfPath(r.sent.pdf))) return { ok: true, name: r.sent.pdf, bytes: fs.readFileSync(pdfPath(r.sent.pdf)) };
  // Not sent yet: a preview from the record as it stands.
  return { ok: true, name: `${poRef(r)}-preview.pdf`, bytes: purchaseOrderPdf(r) };
}

/** Emails the approved order to the supplier's order address with the PDF, and keeps both. In this demo the email is logged, not sent. */
export function sendPurchaseOrder(user: User, id: string): Result<{ request: PurchaseRequest; email: OutboxEmail }> {
  const s = loadStore();
  const r = s.requests.find((x) => x.id === id);
  if (!r || !canSee(user, r)) return fail(404, "This order is not available.");
  if (!(can(user, "purchase.review") || r.createdBy === user.id)) return fail(403, "Purchasing or the person who raised the order sends it.");
  if (r.status !== "approved") return fail(409, "Only an approved order can be sent.");
  if (r.sent) return fail(409, `Already sent to ${r.sent.to} on ${r.sent.at.slice(0, 10)}.`);
  const sup = r.supplierId ?? r.lines[0]?.supplierId;
  const acct = sup ? supplierAccount(r.propertyId, sup, s) : undefined;
  if (!acct) return fail(409, "This supplier has no order email at this hotel. Add it under Suppliers first.");
  const po = poRef(r);
  const bytes = purchaseOrderPdf(r);
  const name = `${po}.pdf`;
  fs.mkdirSync(path.dirname(pdfPath(name)), { recursive: true });
  fs.writeFileSync(pdfPath(name), bytes, { mode: 0o600 });
  const prop = propertyById[r.propertyId];
  const t = orderTotals(r.lines);
  const date = r.deliveryDate ?? r.period.from;
  // The time it was sent, in the hotel's local time, so it agrees with the order's history.
  const at = `${DEMO_TODAY}T${timeIn(propertyById[r.propertyId].timeZone)}`;
  const email: OutboxEmail = {
    id: "", at: now(), by: user.id, propertyId: r.propertyId, ref: r.id, to: acct.orderEmail,
    subject: `Purchase order ${po} from ${prop.name}, delivery ${date}`,
    body: [`Hello ${acct.contact.split(" ")[0] || ""},`.trim(), "", `Please find attached purchase order ${po} for delivery on ${date} to ${prop.name}.`, `${r.lines.length} items, ${fmtMoney(t.net, prop.currency, { decimals: true })} before VAT.`, "", "Please quote the order number on the delivery note and the invoice.", "", `${userById[user.id]?.name ?? "Purchasing"}`, prop.name].join("\n"),
    attachments: [{ name, file: `po/${name}`, bytes: bytes.length }], status: "logged", note: "Logged with its PDF. This demo never emails suppliers.",
  };
  const out = mutateStore((x) => {
    // Checked again inside the write, against the store as saved: a second send never logs a second email.
    const y = x.requests.find((z) => z.id === id)!;
    if (y.sent || y.status !== "approved") return null;
    x.procurement ??= seedProcurement();
    email.id = `MAIL-${String(nextNumber(x, "MAIL")).padStart(5, "0")}`;
    x.procurement.outbox.push(email);
    y.sent = { at, by: user.id, to: acct.orderEmail, subject: email.subject, pdf: name, emailId: email.id };
    y.sentAt = at;
    y.expectedAt = `${date}T07:30`;
    y.updatedAt = now();
    y.history.push({ at: y.updatedAt, by: user.id, action: `Order logged for ${acct.name} (${acct.orderEmail}) with ${name}`, status: "approved", comment: "In this demo nothing is emailed. The PDF is kept with the order." });
    return y;
  });
  if (!out) return fail(409, "This order has already been sent.");
  return { ok: true, request: out, email };
}

// ---- Three way match, credit requests and closing ----------------------------------------------------------------

export function matchFor(user: User, id: string) {
  const s = loadStore();
  const r = s.requests.find((x) => x.id === id);
  if (!r || !canSee(user, r)) return fail(404, "This order is not available.");
  const invoices = s.finance.invoices.filter((i) => i.requestId === r.id);
  const lines: MatchLineIn[] = r.lines.map((l) => {
    const inv = invoices.flatMap((i) => i.lines.filter((x) => x.ingredientId === l.ingredientId));
    const invoiced = r3(sum(inv, (x) => x.qty));
    return {
      ingredientId: l.ingredientId, ordered: l.qty, received: l.received ?? 0, damaged: l.damaged ?? 0, invoiced,
      orderPrice: l.unitPrice, invoicePrice: inv.length ? inv[inv.length - 1].unitPrice : l.unitPrice,
      agreedPrice: catalogueLine(r.propertyId, l.supplierId, l.ingredientId, s)?.agreedPrice,
    };
  });
  return { ok: true as const, request: r, invoices: invoices.map((i) => ({ id: i.id, supplierRef: i.supplierRef, status: i.status, date: i.date })), match: threeWay(lines) };
}

/** Drafts the credit request from the match: units invoiced but not accepted, and prices above the order. Nothing is sent. */
export function draftCredit(user: User, id: string): Result<{ credit: CreditRequest }> {
  if (!(can(user, "purchase.review") || can(user, "finance.review") || can(user, "purchase.approveFnb"))) return fail(403, "Purchasing, accounting or the F&B director drafts credit requests.");
  const m = matchFor(user, id);
  if (!m.ok) return m;
  if (!m.invoices.length) return fail(409, "Record the supplier's invoice first, so the three figures can be compared.");
  const r = m.request;
  const currency = propertyById[r.propertyId].currency;
  const money = (n: number) => fmtMoney(n, currency, { decimals: true });
  const c = creditLines(m.match.lines, (g) => ingredientById[g].name, unitWord, money);
  if (c.amount <= 0) return fail(409, "The invoice matches what arrived at the order prices. There is nothing to claim.");
  const sup = r.supplierId ?? r.lines[0].supplierId;
  const acct = supplierAccount(r.propertyId, sup);
  const inv = m.invoices[m.invoices.length - 1];
  const credit: CreditRequest = {
    id: "", at: now(), by: user.id, status: "draft", invoiceId: inv.id, lines: c.lines, amount: c.amount,
    to: acct?.orderEmail ?? "", subject: `Credit request for ${poRef(r)}, invoice ${inv.supplierRef}`,
    body: ["Hello,", "", `For our order ${poRef(r)} and your invoice ${inv.supplierRef}, please issue a credit note for ${money(c.amount)}:`, "", ...c.lines.map((l) => `- ${l.text}: ${money(l.amount)}`), "", "These are the differences between what we ordered, what we received and what was invoiced.", "", userById[user.id]?.name ?? "Purchasing", propertyById[r.propertyId].name].join("\n"),
  };
  const out = mutateStore((x) => {
    const y = x.requests.find((z) => z.id === id)!;
    // One above the highest number used, so a redrafted request never reuses the id of one already sent.
    credit.id = `CR-${poRef(y).replace(/^PO-/, "")}-${Math.max(0, ...(y.credits ?? []).map((k) => Number(k.id.split("-").pop()) || 0)) + 1}`;
    y.credits = [...(y.credits ?? []).filter((k) => k.status !== "draft"), credit];
    y.updatedAt = now();
    y.history.push({ at: y.updatedAt, by: user.id, action: `Credit request drafted for ${money(c.amount)}`, status: y.status });
    return credit;
  });
  return { ok: true, credit: out };
}

/** Marks a drafted credit request as sent. Logged in this demo, not emailed. */
export function sendCredit(user: User, id: string, creditId: string): Result<{ credit: CreditRequest }> {
  if (!(can(user, "purchase.review") || can(user, "finance.review") || can(user, "purchase.approveFnb"))) return fail(403, "Purchasing, accounting or the F&B director sends credit requests.");
  const r = loadStore().requests.find((x) => x.id === id);
  if (!r || !canSee(user, r)) return fail(404, "This order is not available.");
  const c = r.credits?.find((x) => x.id === creditId);
  if (!c) return fail(404, "This credit request does not exist.");
  if (c.status === "sent") return fail(409, "Already sent.");
  const credit = mutateStore((x) => {
    x.procurement ??= seedProcurement();
    const y = x.requests.find((z) => z.id === id)!;
    const k = y.credits!.find((z) => z.id === creditId)!;
    k.status = "sent";
    k.sentAt = now();
    x.procurement.outbox.push({ id: `MAIL-${String(nextNumber(x, "MAIL")).padStart(5, "0")}`, at: k.sentAt, by: user.id, propertyId: y.propertyId, ref: y.id, to: k.to, subject: k.subject, body: k.body, attachments: [], status: "logged", note: "Logged. This demo never emails suppliers." });
    y.history.push({ at: k.sentAt, by: user.id, action: `Credit request ${k.id} sent to the supplier`, status: y.status, comment: "Logged in this demo, not sent." });
    return k;
  });
  return { ok: true, credit };
}

/** Closes a received order. Without an approved invoice, a reason is needed. */
export function closePurchaseOrder(user: User, id: string, body: Record<string, unknown>): Result<{ request: PurchaseRequest }> {
  if (!(can(user, "purchase.review") || can(user, "finance.review"))) return fail(403, "Purchasing or accounting closes orders.");
  const s = loadStore();
  const r = s.requests.find((x) => x.id === id);
  if (!r || !canSee(user, r)) return fail(404, "This order is not available.");
  if (r.closed) return fail(409, "This order is already closed.");
  if (r.status !== "received") return fail(409, "Record the delivery first. An order still waiting for goods cannot be closed.");
  const note = text(body.note, 300);
  const settled = s.finance.invoices.some((i) => i.requestId === r.id && ["approved", "posted"].includes(i.status));
  if (!settled && note.length < 3) return fail(400, "No approved invoice yet. Say why the order is closed.");
  const request = mutateStore((x) => {
    const y = x.requests.find((z) => z.id === id)!;
    y.closed = { at: now(), by: user.id, note: note || "Invoice approved" };
    y.updatedAt = y.closed.at;
    y.history.push({ at: y.closed.at, by: user.id, action: "Order closed", status: y.status, comment: y.closed.note });
    return y;
  });
  return { ok: true, request };
}

// ---- Stock valuation ---------------------------------------------------------------------------------------------

/** Purchases that entered stock, by item: dataset deliveries at their invoiced price and deliveries received in Tyll. */
export function purchaseLots(propertyId: string, s: Shape = loadStore()): Map<string, Lot[]> {
  const out = new Map<string, Lot[]>();
  const add = (g: string, lot: Lot) => out.set(g, [...(out.get(g) ?? []), lot]);
  for (const d of getDataset().deliveries) {
    if (d.propertyId !== propertyId || d.status !== "delivered") continue;
    for (const l of d.lines) if (l.delivered > 0) add(l.ingredientId, { date: d.date, qty: l.delivered, price: l.invoiced > 0 ? l.invoicePrice : l.poPrice });
  }
  for (const r of s.requests) {
    if (r.propertyId !== propertyId || r.eventId || r.deliveryId) continue;
    for (const rc of r.receipts ?? []) for (const l of rc.lines) {
      if (l.accepted <= 0) continue;
      const inv = s.finance.invoices.filter((i) => i.requestId === r.id).flatMap((i) => i.lines).filter((x) => x.ingredientId === l.ingredientId).at(-1);
      add(l.ingredientId, { date: rc.at.slice(0, 10), qty: l.accepted, price: inv?.unitPrice ?? r.lines.find((x) => x.ingredientId === l.ingredientId)?.unitPrice ?? 0 });
    }
  }
  return out;
}

export function valuationMethod(propertyId: string): ValuationMethod { return settingsOf(propertyId).valuation; }

export function valueRows<T extends { ingredientId: string; estimated: number; unitCost: number }>(propertyId: string, rows: T[]): (T & { value: number; valuationCost: number })[] {
  const lots = purchaseLots(propertyId);
  const method = valuationMethod(propertyId);
  return rows.map((r) => {
    const v = valueOnHand(r.estimated, lots.get(r.ingredientId) ?? [], method, r.unitCost);
    return { ...r, value: v.value, valuationCost: v.unitCost };
  });
}

/** Purchasing settings: the valuation method is the controller's or general manager's choice. */
export function purchasingSettingsFor(user: User, propertyId: string) {
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const s = settingsOf(propertyId);
  const policy = APPROVAL_POLICY[propertyId];
  return {
    ok: true as const, settings: s, valuationLabel: VALUATION_LABEL[s.valuation], currency: propertyById[propertyId].currency,
    vat: { scheme: s.vatScheme, label: VAT_SCHEMES[s.vatScheme].label, rates: STOCK_AREAS.map((a) => ({ area: a.name, rate: VAT_SCHEMES[s.vatScheme].rates[a.id] })) },
    limits: policy, mayChange: can(user, "finance.review") || can(user, "purchase.approveManager"),
    statuses: Object.entries(PO_STATUS).map(([id, v]) => ({ id, label: v.label })),
  };
}

export function savePurchasingSettings(user: User, propertyId: string, body: Record<string, unknown>): Result<{ settings: PurchasingSettings }> {
  if (!(can(user, "finance.review") || can(user, "purchase.approveManager"))) return fail(403, "Only the financial controller or the general manager can change how stock is valued.");
  if (!allowedProperties(user).includes(propertyId)) return fail(403, "This hotel is outside your access.");
  const method = (["wac", "fifo", "last"] as const).find((m) => m === body.valuation);
  if (!method) return fail(400, "Choose weighted average cost, FIFO or last purchase price.");
  const settings = mutateStore((x) => {
    x.procurement ??= seedProcurement();
    x.procurement.settings[propertyId] = { ...settingsOf(propertyId, x), valuation: method };
    return x.procurement.settings[propertyId];
  });
  return { ok: true, settings };
}

export { poStatus };
