// Lightspeed Restaurant K Series, Financial API (v2). Built from the public reference at api-docs.lsk.lightspeed.app
// (OpenAPI "Lightspeed Restaurant K Series API", operation financial-apiGetBusinessLocationSalesOfABusinessDay).
// Tested on sample responses only. Not yet connected to a live account: see transport.ts.
import type { PosAdapter } from "../../adapters";
import { orderTotals } from "../../domain/orders";
import type { Order, OrderLine } from "../../types";
import { round2 } from "../../util";
import { minutesInto, secondsInto } from "./time";
import type { Transport } from "./transport";

// ---- The documented response (financial-apiSalesDailyExportDto). Amounts are strings with up to six decimals. ----

export interface LskLine {
  id?: string;
  parentLineId?: string;
  totalNetAmountWithTax?: string;
  totalNetAmountWithoutTax?: string;
  menuListPrice?: string;
  discountAmount?: string;
  totalDiscountAmount?: string;
  discountName?: string;
  discountCode?: string;
  taxRatePercentage?: string;
  taxAmount?: string;
  itemId?: number;
  sku?: string;
  name?: string;
  nameOverride?: string;
  quantity?: string;
  currency?: string;
  revenueCenter?: string;
  timeOfSale?: string;
  staffId?: number;
  staffName?: string;
  voidReason?: string;
}

export interface LskPayment {
  code?: string;
  description?: string;
  netAmountWithTax?: string;
  tip?: string;
  currency?: string;
  type?: string;
  externalReference?: string;
  staffId?: number;
  fiscDate?: string;
}

export interface LskSale {
  accountReference?: string;
  accountFiscId: string;
  receiptId?: string;
  source?: { initialAccountId?: string; previousAccountId?: string };
  salesLines?: LskLine[];
  payments?: LskPayment[];
  timeOfOpening?: string;
  timeClosed?: string;
  cancelled?: boolean;
  tableNumber?: string;
  tableName?: string;
  ownerName?: string;
  ownerId?: number;
  type?: "SALE" | "VOID" | "RECALL" | "REFUND" | "SPLIT" | "UPDATE" | "TRANSFER" | "FLOAT" | "TRANSITORY" | "CROSS_BL" | "CANCEL";
  nbCovers?: number;
  dineIn?: boolean;
  voidReason?: string;
}

export interface LskSalesDaily {
  sales: LskSale[];
  nextStartOfDayAsIso8601?: string;
  dataComplete?: boolean;
}

// ---- What a hotel agrees at onboarding. Nothing here is a secret. ----

export interface LightspeedConfig {
  propertyId: string;
  timeZone: string;
  /** Tyll outlet id to Lightspeed business location id, and the outlet's short code for bill ids. */
  locations: Record<string, { businessLocationId: number; code: string; roomService?: boolean }>;
  /** Lightspeed SKU to Tyll menu item. A line with an SKU not listed here is kept, under `lsk:<sku>`, and reported. */
  items: Record<string, string>;
  /** Lightspeed staff id (the sale's owner or the line's staff) to Tyll staff id. */
  staff: Record<string, string>;
  /** Payment method codes that charge a bill to a guest room through the PMS link. */
  roomPaymentCodes: string[];
  cashPaymentCodes: string[];
}

/** A bill charged to a room, as the till recorded it: what the PMS adapter matches guest bill postings against. */
export interface PosRoomCharge {
  orderId: string;
  outletId: string;
  /** The receipt id the till gives the bill. The PMS link is expected to carry it on the posting (to confirm in a sandbox). */
  ref: string;
  room: string;
  /** Amount charged to the room, with tax, as the guest signed it. Tips are not included. */
  amount: number;
  /** When the bill was closed, in minutes from the start of the business date. */
  min: number;
  table: string;
  covers: number;
  roomService: boolean;
}

export interface LightspeedDayReport {
  outletId: string;
  businessDate: string;
  dataComplete: boolean;
  sales: number;
  orders: number;
  lines: number;
  cancelled: number;
  refunds: number;
  /** Lines taken off after they were rung (a negative quantity in Lightspeed). */
  removedLines: number;
  /** Bills with a discount on what was kept. */
  discountedBills: number;
  /** Lines taken off the bill in full by a discount: complimentary. */
  compedLines: number;
  /** Refunds of a bill from another day: shown, not attached to any bill of this day. */
  refundsOtherDay: number;
  /** Net of tax, as Lightspeed totals it, for the sales that became bills in Tyll (cancelled ones excluded). */
  sourceNet: number;
  /** Net of tax, as Tyll totals the same bills (orderTotals). Must equal sourceNet to the cent. */
  tyllNet: number;
  unmappedItems: { sku: string; name: string; lines: number }[];
  unmappedStaff: string[];
  roomCharges: PosRoomCharge[];
}

const num = (s: string | number | undefined) => {
  const n = typeof s === "number" ? s : Number(s ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** What the adapter reads, for the Settings page. */
export const LIGHTSPEED_READS = [
  { method: "GET", path: "/f/v2/business-location/{businessLocationId}/sales-daily", gives: "Bills, lines, voids, discounts, refunds and payments for one business day" },
];

export function salesDailyRequest(businessLocationId: number, businessDate: string) {
  return {
    system: "lightspeed" as const,
    method: "GET" as const,
    path: `/f/v2/business-location/${businessLocationId}/sales-daily`,
    query: { date: businessDate, include: "payments,staff,table" },
  };
}

interface Draft {
  line: OrderLine;
  key: string;
  /** Net of tax after discounts, for the units still kept. */
  netAfter: number;
}

/** One business day of one location, mapped to Tyll bills. Pure: the same response always gives the same bills. */
export function mapSalesDay(cfg: LightspeedConfig, outletId: string, businessDate: string, res: LskSalesDaily): { orders: Order[]; report: LightspeedDayReport } {
  const loc = cfg.locations[outletId];
  const tz = cfg.timeZone;
  const at = (iso: string | undefined, fallback: number) => (iso ? minutesInto(businessDate, iso, tz) : fallback);
  const unmapped = new Map<string, { sku: string; name: string; lines: number }>();
  const unmappedStaff = new Set<string>();
  const staffOf = (id: number | undefined) => {
    if (id === undefined) return "unknown";
    const s = cfg.staff[String(id)];
    if (!s) unmappedStaff.add(String(id));
    return s ?? `lsk:${id}`;
  };
  const itemOf = (l: LskLine) => {
    const sku = l.sku ?? String(l.itemId ?? "");
    const id = cfg.items[sku];
    if (!id) {
      const u = unmapped.get(sku) ?? { sku, name: l.nameOverride || l.name || sku, lines: 0 };
      u.lines += 1;
      unmapped.set(sku, u);
    }
    return id ?? `lsk:${sku}`;
  };

  const sales = [...(res.sales ?? [])].sort((a, b) => (a.timeClosed ?? "").localeCompare(b.timeClosed ?? ""));
  const orders: Order[] = [];
  const byFiscId = new Map<string, Order>();
  const sourceNetOf = new Map<string, number>();
  const roomCharges: PosRoomCharge[] = [];
  let lines = 0;
  let cancelled = 0;
  let refunds = 0;
  let refundsOtherDay = 0;
  let sourceNet = 0;

  for (const sale of sales) {
    if (sale.type === "REFUND") continue;
    const id = `${loc.code}-${sale.accountFiscId}`;
    const openMin = at(sale.timeOfOpening, 0);
    const closeMin = at(sale.timeClosed, openMin);
    const all = sale.salesLines ?? [];
    // Priced modifiers (a line with a parent) are folded into the line they belong to; free ones are dropped.
    const children = new Map<string, LskLine[]>();
    for (const l of all) if (l.parentLineId) children.set(l.parentLineId, [...(children.get(l.parentLineId) ?? []), l]);
    const drafts: Draft[] = [];
    const voids: LskLine[] = [];
    let saleNet = 0;
    for (const l of all) {
      if (l.parentLineId && all.some((p) => p.id === l.parentLineId)) continue;
      const kids = l.id ? children.get(l.id) ?? [] : [];
      const qty = num(l.quantity);
      const withTax = num(l.totalNetAmountWithTax) + kids.reduce((s, k) => s + num(k.totalNetAmountWithTax), 0);
      const without = num(l.totalNetAmountWithoutTax) + kids.reduce((s, k) => s + num(k.totalNetAmountWithoutTax), 0);
      const disc = num(l.totalDiscountAmount ?? l.discountAmount) + kids.reduce((s, k) => s + num(k.totalDiscountAmount ?? k.discountAmount), 0);
      saleNet += without;
      if (qty === 0) continue;
      lines += 1;
      if (qty < 0) {
        voids.push(l);
        continue;
      }
      // Discounts are taken as including tax, like the line total they come off (to confirm in a sandbox).
      const factor = Math.abs(withTax) > 0.004 ? without / withTax : 1 / (1 + num(l.taxRatePercentage) / 100);
      const before = (withTax + disc) * factor;
      const min = at(l.timeOfSale, openMin);
      const sec = l.timeOfSale ? secondsInto(businessDate, l.timeOfSale, tz) - min * 60 : 0;
      const comped = disc > 0 && Math.abs(withTax) < 0.005;
      const line: OrderLine = { itemId: itemOf(l), qty, unitPrice: round2(before / qty), state: comped ? "comped" : "kept", enteredMin: min, enteredSec: sec, sentMin: min };
      if (comped && (l.discountName || l.discountCode)) line.reason = l.discountName || l.discountCode;
      drafts.push({ line, key: l.sku ?? String(l.itemId ?? ""), netAfter: comped ? 0 : without });
    }
    // A line with a negative quantity takes back units already rung: the earliest kept line of the same item.
    for (const v of voids) {
      let left = -num(v.quantity);
      const key = v.sku ?? String(v.itemId ?? "");
      const min = at(v.timeOfSale, closeMin);
      for (const d of drafts) {
        if (left <= 0) break;
        if (d.key !== key || d.line.state !== "kept") continue;
        const take = Math.min(left, d.line.qty);
        const share = take / d.line.qty;
        const removed: OrderLine = { ...d.line, qty: take, state: "removed_post", removedMin: min, removedBy: staffOf(v.staffId), ...(v.voidReason ? { reason: v.voidReason } : {}) };
        if (take === d.line.qty) {
          d.line = removed;
          d.netAfter = 0;
        } else {
          d.line = { ...d.line, qty: d.line.qty - take };
          d.netAfter = d.netAfter * (1 - share);
          drafts.push({ line: removed, key, netAfter: 0 });
        }
        left -= take;
      }
    }
    const kept = drafts.filter((d) => d.line.state === "kept");
    const keptBefore = kept.reduce((s, d) => s + d.line.qty * d.line.unitPrice, 0);
    const keptAfter = kept.reduce((s, d) => s + d.netAfter, 0);
    const off = keptBefore - keptAfter;
    const discountName = all.find((l) => num(l.totalDiscountAmount ?? l.discountAmount) > 0 && num(l.totalNetAmountWithTax) > 0.004)?.discountName;

    const payments = sale.payments ?? [];
    const toRoom = payments.filter((p) => cfg.roomPaymentCodes.includes(p.code ?? ""));
    const cash = payments.some((p) => cfg.cashPaymentCodes.includes(p.code ?? ""));
    const room = toRoom.map((p) => p.externalReference?.trim()).find(Boolean);
    const isCancelled = !!sale.cancelled || sale.type === "VOID" || sale.type === "CANCEL";
    const order: Order = {
      id,
      outletId,
      date: businessDate,
      openMin,
      closeMin,
      covers: Math.max(1, Math.round(sale.nbCovers ?? 1)),
      staffId: staffOf(sale.ownerId),
      table: sale.tableName || (sale.tableNumber ? `Table ${sale.tableNumber}` : "No table"),
      lines: drafts.sort((a, b) => a.line.enteredMin * 60 + (a.line.enteredSec ?? 0) - (b.line.enteredMin * 60 + (b.line.enteredSec ?? 0))).map((d) => d.line),
      // Exact, so Tyll's net equals Lightspeed's to the cent: discounts = round2(kept x pct / 100).
      discountPct: Math.abs(off) > 0.004 && keptBefore > 0 ? (off / keptBefore) * 100 : 0,
      payment: toRoom.length ? "room" : cash ? "cash" : "card",
    };
    if (order.discountPct && discountName) order.discountReason = discountName;
    if (room) order.room = room;
    if (isCancelled) {
      order.voided = { min: closeMin, ...(sale.voidReason ? { reason: sale.voidReason } : {}) };
      cancelled += 1;
    } else {
      sourceNet += saleNet;
      sourceNetOf.set(sale.accountFiscId, saleNet);
      if (toRoom.length && room) {
        roomCharges.push({
          orderId: id, outletId, ref: sale.receiptId ?? sale.accountFiscId, room, min: closeMin, table: order.table, covers: order.covers, roomService: !!loc.roomService,
          amount: round2(toRoom.reduce((s, p) => s + num(p.netAmountWithTax), 0)),
        });
      }
    }
    orders.push(order);
    byFiscId.set(sale.accountFiscId, order);
  }

  // Refunds point at the bill they refund. Tyll keeps a refund on that bill, net of tax.
  for (const sale of sales) {
    if (sale.type !== "REFUND") continue;
    const amount = round2(-(sale.salesLines ?? []).reduce((s, l) => s + num(l.totalNetAmountWithoutTax), 0));
    lines += (sale.salesLines ?? []).length;
    const target = byFiscId.get(sale.source?.initialAccountId ?? "");
    if (!target || target.voided) {
      refundsOtherDay = round2(refundsOtherDay + amount);
      continue;
    }
    refunds += 1;
    const min = at(sale.timeClosed, target.closeMin);
    target.refund = { amount: round2((target.refund?.amount ?? 0) + amount), min, ...(sale.voidReason ? { reason: sale.voidReason } : {}) };
    sourceNet -= amount;
  }

  const live = orders.filter((o) => !o.voided);
  const removedLines = live.reduce((n, o) => n + o.lines.filter((l) => l.state === "removed_post").length, 0);
  const compedLines = live.reduce((n, o) => n + o.lines.filter((l) => l.state === "comped").length, 0);
  const discountedBills = live.filter((o) => o.discountPct > 0).length;
  const tyllNet = round2(orders.filter((o) => !o.voided).reduce((s, o) => s + orderTotals(o).net, 0));
  return {
    orders,
    report: {
      outletId, businessDate, dataComplete: res.dataComplete !== false, sales: sales.length, orders: orders.length, lines, cancelled, refunds, removedLines, discountedBills, compedLines, refundsOtherDay,
      sourceNet: round2(sourceNet), tyllNet, unmappedItems: [...unmapped.values()], unmappedStaff: [...unmappedStaff], roomCharges,
    },
  };
}

export class LightspeedKSeriesPos implements PosAdapter {
  constructor(private readonly transport: Transport, readonly config: LightspeedConfig) {}

  /** One business day of one outlet with the adapter's report: totals on both sides, items and staff not yet mapped. */
  async readDay(outletId: string, businessDate: string) {
    const loc = this.config.locations[outletId];
    if (!loc) throw new Error(`No Lightspeed business location is set up for outlet ${outletId}.`);
    const res = (await this.transport(salesDailyRequest(loc.businessLocationId, businessDate))) as LskSalesDaily;
    if (!res || !Array.isArray(res.sales)) throw new Error("Lightspeed answered without a list of sales.");
    return mapSalesDay(this.config, outletId, businessDate, res);
  }

  async fetchOrders(outletId: string, businessDate: string) {
    return (await this.readDay(outletId, businessDate)).orders;
  }

  /** Bills charged to a room on a business day, across the property's outlets set up in Lightspeed. */
  async roomCharges(propertyId: string, businessDate: string): Promise<PosRoomCharge[]> {
    if (propertyId !== this.config.propertyId) return [];
    const out: PosRoomCharge[] = [];
    for (const outletId of Object.keys(this.config.locations)) out.push(...(await this.readDay(outletId, businessDate)).report.roomCharges);
    return out;
  }
}
