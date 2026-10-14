// Stock and forecast figures are worked out here, on complete data, because a shared store is drawn on
// by every outlet. Each user then receives only the rows and detail their access allows.
import { ingredientById, itemById, storeOwner } from "../data/catalog";
import { getDataset } from "../data/generate";
import { receivedDeliveries } from "./purchasing-store";
import { allowedOutlets, allowedProperties, can, hasWholeProperty } from "../domain/access";
import { buildForecast, defaultInputs, type Forecast, type ForecastInputs } from "../domain/forecast";
import { receivedAsCorrected, stockPosition, varianceAllocation, type StockInputs, type StockRow } from "../domain/inventory";
import type { CountRecord, PriceChange, ReceiptCorrection, RecipeChange, User, WasteLog, WasteReason } from "../types";
import { DEMO_TODAY } from "../util";

/** Entries the user made in this session. They are held in the browser until actions move to the server. */
export interface SessionEntries {
  waste: WasteLog[];
  counts: CountRecord[];
  overrides: PriceChange[];
  recipes: RecipeChange[];
  receipts: ReceiptCorrection[];
}

const REASONS: WasteReason[] = ["waste", "breakage", "spoilage", "damaged", "other"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

/** Keeps only well-formed entries the user was allowed to make. Anything else is ignored. */
export function cleanEntries(user: User, body: unknown): SessionEntries {
  const b = (body ?? {}) as Partial<Record<keyof SessionEntries, unknown>>;
  const outlets = new Set(allowedOutlets(user));
  const props = new Set(allowedProperties(user));
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 500) : []);
  const waste = list(b.waste).filter((w): w is WasteLog => {
    const x = w as WasteLog;
    return can(user, "stock.logWaste") && outlets.has(x.outletId) && ISO.test(x.date) && num(x.qty, 0.001, 500) && REASONS.includes(x.reason) && (!!ingredientById[x.ingredientId ?? ""] || typeof x.itemId === "string") && num(x.seq, 1, 1e9);
  });
  const counts = list(b.counts).filter((c): c is CountRecord => {
    const x = c as CountRecord;
    return can(user, "stock.count") && props.has(x.propertyId) && !!ingredientById[x.ingredientId] && ISO.test(x.date) && num(x.counted, 0, 1e6) && num(x.expected, -1e6, 1e6) && num(x.seq, 1, 1e9);
  });
  const overrides = can(user, "stock.editPrices")
    ? list(b.overrides).filter((p): p is PriceChange => !!ingredientById[(p as PriceChange).id] && ISO.test((p as PriceChange).from) && num((p as PriceChange).value, 0.01, 100000))
    : [];
  const recipes = can(user, "stock.editPrices")
    ? list(b.recipes).filter((c): c is RecipeChange => {
      const x = c as RecipeChange;
      const base = itemById[x.itemId]?.recipe?.find((l) => l.ingredientId === x.ingredientId)?.qty;
      return base !== undefined && ISO.test(x.from) && num(x.qty, base * 0.5, base * 2) && num(x.seq, 1, 1e9);
    })
    : [];
  const receipts = can(user, "stock.count")
    ? list(b.receipts).filter((c): c is ReceiptCorrection => {
      const x = c as ReceiptCorrection;
      const d = getDataset().deliveries.find((dl) => dl.id === x.deliveryId);
      return !!d && props.has(d.propertyId) && d.lines.some((l) => l.ingredientId === x.ingredientId) && num(x.received, 0, 1e5) && num(x.seq, 1, 1e9);
    })
    : [];
  return { waste: waste.map((w) => ({ ...w, synced: true })), counts, overrides, recipes, receipts };
}

export const fullInputs = (e: SessionEntries): StockInputs => {
  const d = getDataset();
  return { dayItems: d.dayItems, counts: [...d.counts, ...e.counts], deliveries: [...receivedAsCorrected(d.deliveries, e.receipts), ...receivedDeliveries()], transfers: d.transfers, waste: [...d.wasteLogs, ...e.waste], recipes: e.recipes };
};

/** An outlet-only store is visible only to people with access to that outlet. */
const mayseeStore = (user: User, store: string | null) => store === null || allowedOutlets(user).includes(store);

export interface StockRowOut extends StockRow {
  /** How a count difference for this item is shared out, limited to the outlets this user may see. */
  allocation: Record<string, number>;
}

export function stockFor(user: User, propertyId: string, e: SessionEntries): StockRowOut[] {
  const d = getDataset();
  const mine = new Set(allowedOutlets(user));
  return stockPosition(propertyId, fullInputs(e), e.overrides)
    .filter((r) => mayseeStore(user, r.store))
    .map((r) => {
      // Counts recorded now are shared out by each outlet's use of the item over the past week.
      const full = varianceAllocation(d.dayItems, propertyId, r.ingredientId, DEMO_TODAY);
      const allocation = Object.fromEntries(Object.entries(full).filter(([id]) => mine.has(id)));
      return { ...r, allocation };
    });
}

export interface ForecastOut {
  forecast: Forecast;
  baseline: Forecast;
  defaults: ForecastInputs;
}

export function forecastFor(user: User, propertyId: string, raw: Partial<ForecastInputs> | undefined, e: SessionEntries): ForecastOut {
  const d = getDataset();
  const defaults = defaultInputs(d, propertyId);
  const inputs: ForecastInputs = {
    occupancy: num(raw?.occupancy, 0, 1) ? raw!.occupancy! : defaults.occupancy,
    reservations: num(raw?.reservations, 0, 100000) ? Math.round(raw!.reservations!) : defaults.reservations,
    eventAttendance: num(raw?.eventAttendance, 0, 100000) ? Math.round(raw!.eventAttendance!) : defaults.eventAttendance,
    safetyDays: num(raw?.safetyDays, 0, 14) ? raw!.safetyDays! : defaults.safetyDays,
    stockOverride: Object.fromEntries(Object.entries(raw?.stockOverride ?? {}).filter(([id, v]) => !!ingredientById[id] && num(v, 0, 1e6))),
  };
  const stock = fullInputs(e);
  const forecast = buildForecast(d, stock, propertyId, inputs, e.overrides);
  const baseline = buildForecast(d, stock, propertyId, { ...defaults, stockOverride: inputs.stockOverride }, e.overrides);
  const whole = hasWholeProperty(user, propertyId);
  // Purchase plans cover the shared store; an outlet-only store is shown only to that outlet's people.
  const trim = (f: Forecast): Forecast => {
    const plans = f.plans.filter((p) => mayseeStore(user, storeOwner(propertyId, p.ingredientId)));
    if (whole) return { ...f, plans, totalCost: plans.reduce((s, p) => s + p.cost, 0) };
    // Item-level sales forecasts are detail about other outlets, so they are worked out from the user's outlets alone.
    const own = buildForecast({ ...d, dayItems: d.dayItems.filter((r) => allowedOutlets(user).includes(r.outletId)) }, stock, propertyId, inputs, e.overrides);
    return { ...f, plans, totalCost: plans.reduce((s, p) => s + p.cost, 0), items: own.items.filter((i) => i.history > 0) };
  };
  return { forecast: trim(forecast), baseline: trim(baseline), defaults };
}

