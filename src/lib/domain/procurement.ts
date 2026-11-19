// Purchasing and stock control rules, as plain functions so each one can be tested on its own: par levels, packs, VAT,
// approval limits, purchase order status, receiving, the three way match, credit requests, stock valuation, expiry
// (first expiring, first out), stock take variance and cash checks. No screens, no storage, no AI.
import type { Currency, PurchaseRequest, ReceiptLine, RequestLine, ValuationMethod, VatScheme } from "../types";
export type { ValuationMethod, VatScheme };
import { addDays, round2, weekday } from "../util";

// ---- Packs and units ---------------------------------------------------------------------------------------------

/** Rounds a quantity up to whole packs. A pack of 0 means the item is bought loose. */
export const ceilToPack = (qty: number, pack: number) => (pack > 0 ? Math.round(Math.ceil(qty / pack - 1e-9) * pack * 1000) / 1000 : Math.round(qty * 1000) / 1000);

/** How a supplier sells an item, such as "Case of 12" or "Pack of 5 kg". */
export function packLabelFor(unit: "kg" | "l" | "each", packSize: number): string {
  if (unit === "each") return `Case of ${packSize}`;
  if (unit === "l") return packSize >= 2 ? `Case of ${packSize} × 1 L` : `${packSize} L`;
  return `Pack of ${packSize} kg`;
}

/** "4 × Case of 12 (48)": packs first, the units behind them in brackets. */
export function packsText(qty: number, packSize: number | undefined, packLabel: string | undefined, unitWord: string): string {
  if (!packSize || !packLabel || packSize <= 0) return `${round2(qty)} ${unitWord}`;
  const packs = qty / packSize;
  const whole = Math.abs(packs - Math.round(packs)) < 1e-6;
  return `${whole ? Math.round(packs) : round2(packs)} × ${packLabel} (${round2(qty)} ${unitWord})`;
}

// ---- Par levels --------------------------------------------------------------------------------------------------

export interface Par { min: number; max: number }

/** An item appears in To order once stock is below its minimum. The quantity brings it back to the maximum, less what is already on order, in whole packs. */
export function parTrigger(onHand: number, onOrder: number, par: Par, pack: number): { below: boolean; qty: number; covered: boolean } {
  const below = onHand < par.min - 1e-9;
  if (!below) return { below, qty: 0, covered: false };
  const need = par.max - onHand - onOrder;
  return { below, qty: need > 1e-9 ? ceilToPack(need, pack) : 0, covered: need <= 1e-9 };
}

/** Levels the prediction would set: the minimum covers use until the next delivery arrives plus a safety margin; the maximum adds one order cycle. */
export function suggestPar(avgDaily: number, leadDays: number, orderEveryDays: number, safetyDays: number, pack: number): Par {
  const min = ceilToPack(Math.max(0, avgDaily) * (leadDays + safetyDays), pack);
  const max = ceilToPack(min + Math.max(0, avgDaily) * Math.max(1, orderEveryDays), pack);
  return { min, max: Math.max(max, min) };
}

// ---- VAT and totals ----------------------------------------------------------------------------------------------

export type VatArea = "food" | "drinks" | "inventory";

/** VAT by country and kind of item. Hotels confirm their own rates at onboarding; these are the standard ones. */
export const VAT_SCHEMES: Record<VatScheme, { label: string; currency: Currency; rates: Record<VatArea, number> }> = {
  PT: { label: "Portugal, IVA", currency: "EUR", rates: { food: 0.06, drinks: 0.23, inventory: 0.23 } },
  AE: { label: "United Arab Emirates, VAT", currency: "AED", rates: { food: 0.05, drinks: 0.05, inventory: 0.05 } },
  SA: { label: "Saudi Arabia, VAT", currency: "SAR", rates: { food: 0.15, drinks: 0.15, inventory: 0.15 } },
};

export interface Totals { net: number; vat: number; gross: number; rates: { rate: number; net: number; vat: number }[] }

/** Net, VAT and gross. VAT is worked out per rate on the net of the lines at that rate, as on a supplier invoice. */
export function orderTotals(lines: readonly { qty: number; unitPrice: number; vatRate?: number }[]): Totals {
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.vatRate ?? 0, (byRate.get(l.vatRate ?? 0) ?? 0) + round2(l.qty * l.unitPrice));
  const rates = [...byRate].sort((a, b) => a[0] - b[0]).map(([rate, net]) => ({ rate, net: round2(net), vat: round2(net * rate) }));
  const net = round2(rates.reduce((s, r) => s + r.net, 0));
  const vat = round2(rates.reduce((s, r) => s + r.vat, 0));
  return { net, vat, gross: round2(net + vat), rates };
}

// ---- Approval limits ---------------------------------------------------------------------------------------------

export interface ApprovalLimits {
  /** Above this net total accounting approves. 0 means every order. */
  accountingAbove: number;
  /** Above this net total the F&B director approves. */
  fnbAbove: number;
  /** Above this net total the general manager approves as well. */
  managerAbove: number;
}
export type ApprovalStep = "purchasing" | "accounting" | "fnb" | "manager";

/** The approvals an order of this net value needs, in order. Purchasing always reviews. */
export function approvalStepsFor(total: number, l: ApprovalLimits): ApprovalStep[] {
  const steps: ApprovalStep[] = ["purchasing"];
  if (total > l.accountingAbove) steps.push("accounting");
  if (total > l.fnbAbove) steps.push("fnb");
  if (total > l.managerAbove) steps.push("manager");
  return steps;
}

// ---- Purchase order status ---------------------------------------------------------------------------------------

export type PoStatus = "draft" | "waiting" | "approved" | "sent" | "partly_received" | "received" | "closed" | "rejected" | "changes";

export const PO_STATUS: Record<PoStatus, { label: string; tone: "neutral" | "warn" | "pos" | "neg" | "ink" }> = {
  draft: { label: "Draft", tone: "neutral" },
  waiting: { label: "Waiting for approval", tone: "warn" },
  approved: { label: "Approved, not sent", tone: "ink" },
  sent: { label: "Sent", tone: "ink" },
  partly_received: { label: "Partly received", tone: "warn" },
  received: { label: "Received", tone: "pos" },
  closed: { label: "Closed", tone: "neutral" },
  rejected: { label: "Rejected", tone: "neg" },
  changes: { label: "Changes requested", tone: "neutral" },
};

export function poStatus(r: Pick<PurchaseRequest, "status" | "sent" | "sentAt" | "receipts" | "closed">): PoStatus {
  if (r.closed) return "closed";
  if (r.status === "draft" || r.status === "rejected" || r.status === "changes") return r.status;
  if (r.status === "received") return "received";
  if (r.status !== "approved") return "waiting";
  if (r.receipts?.some((x) => x.lines.some((l) => l.delivered > 0))) return "partly_received";
  return r.sent || r.sentAt ? "sent" : "approved";
}

// ---- Receiving ---------------------------------------------------------------------------------------------------

/** One line of a delivery. Damaged goods are refused at the door; only the rest enters stock. */
export function receiptLine(ingredientId: string, delivered: number, damaged = 0, extra: Pick<ReceiptLine, "batch" | "expiry" | "note"> = {}): ReceiptLine {
  const d = Math.max(0, delivered);
  const bad = Math.min(d, Math.max(0, damaged));
  return { ingredientId, delivered: round3(d), damaged: round3(bad), accepted: round3(d - bad), ...strip(extra) };
}

/** Lines after a delivery: received and damaged add up over every delivery against the order. */
export function applyReceipt(lines: readonly RequestLine[], receipt: readonly ReceiptLine[]): RequestLine[] {
  return lines.map((l) => {
    const x = receipt.find((r) => r.ingredientId === l.ingredientId);
    if (!x) return { ...l };
    return { ...l, received: round3((l.received ?? 0) + x.accepted), damaged: round3((l.damaged ?? 0) + x.damaged) };
  });
}

/** Still to come on a line: ordered less what was accepted. Damaged goods are still owed by the supplier. */
export const outstanding = (l: Pick<RequestLine, "qty" | "received">) => Math.max(0, round3(l.qty - (l.received ?? 0)));
export const fullyReceived = (lines: readonly RequestLine[]) => lines.every((l) => outstanding(l) <= 1e-9);

// ---- Three way match and credit requests --------------------------------------------------------------------------

export type MatchFlag = "short" | "damaged" | "over_delivered" | "invoiced_not_received" | "price_above_order" | "price_above_agreed";

export const MATCH_FLAG: Record<MatchFlag, string> = {
  short: "Delivered short",
  damaged: "Damaged on arrival",
  over_delivered: "More delivered than ordered",
  invoiced_not_received: "Invoiced but not received",
  price_above_order: "Invoice price above the order",
  price_above_agreed: "Above the agreed price",
};

export interface MatchLineIn { ingredientId: string; ordered: number; received: number; damaged: number; invoiced: number; orderPrice: number; invoicePrice: number; agreedPrice?: number }
export interface MatchLine extends MatchLineIn {
  flags: MatchFlag[];
  /** Units invoiced beyond what was accepted. */
  unitsOver: number;
  /** Money for those units, at the invoice price. */
  qtyMoney: number;
  /** Money from a price above the order, on the units actually accepted. */
  priceMoney: number;
  /** What the hotel would pay beyond what it received at the order price. A difference to check, not a finding of wrongdoing. */
  difference: number;
}

export function threeWayLine(x: MatchLineIn): MatchLine {
  const flags: MatchFlag[] = [];
  if (x.received + x.damaged < x.ordered - 1e-9) flags.push("short");
  if (x.damaged > 1e-9) flags.push("damaged");
  if (x.received > x.ordered + 1e-9) flags.push("over_delivered");
  if (x.invoiced > x.received + 1e-9) flags.push("invoiced_not_received");
  if (x.invoicePrice > x.orderPrice + 0.005) flags.push("price_above_order");
  if (x.agreedPrice !== undefined && x.invoicePrice > x.agreedPrice + 0.005) flags.push("price_above_agreed");
  const unitsOver = Math.max(0, round3(x.invoiced - x.received));
  const qtyMoney = round2(unitsOver * x.invoicePrice);
  const priceMoney = round2(Math.max(0, x.invoicePrice - x.orderPrice) * Math.min(x.invoiced, x.received));
  return { ...x, flags, unitsOver, qtyMoney, priceMoney, difference: round2(qtyMoney + priceMoney) };
}

export function threeWay(lines: readonly MatchLineIn[]) {
  const out = lines.map(threeWayLine);
  return {
    lines: out,
    ordered: round2(out.reduce((s, l) => s + l.ordered * l.orderPrice, 0)),
    received: round2(out.reduce((s, l) => s + l.received * l.orderPrice, 0)),
    invoiced: round2(out.reduce((s, l) => s + l.invoiced * l.invoicePrice, 0)),
    qtyMoney: round2(out.reduce((s, l) => s + l.qtyMoney, 0)),
    priceMoney: round2(out.reduce((s, l) => s + l.priceMoney, 0)),
    difference: round2(out.reduce((s, l) => s + l.difference, 0)),
  };
}

/** The credit to ask for, line by line, from the match. Units invoiced but damaged are claimed as damaged, the rest as short. */
export function creditLines(lines: readonly MatchLine[], name: (id: string) => string, unit: (id: string) => string, money: (n: number) => string) {
  const out: { ingredientId: string; reason: "short" | "damaged" | "price"; qty: number; amount: number; text: string }[] = [];
  for (const l of lines) {
    if (l.unitsOver > 1e-9) {
      const damaged = Math.min(l.unitsOver, l.damaged);
      const short = round3(l.unitsOver - damaged);
      if (damaged > 1e-9) out.push({ ingredientId: l.ingredientId, reason: "damaged", qty: round3(damaged), amount: round2(damaged * l.invoicePrice), text: `${name(l.ingredientId)}: ${round3(damaged)} ${unit(l.ingredientId)} invoiced but refused as damaged, at ${money(l.invoicePrice)}` });
      if (short > 1e-9) out.push({ ingredientId: l.ingredientId, reason: "short", qty: short, amount: round2(short * l.invoicePrice), text: `${name(l.ingredientId)}: ${short} ${unit(l.ingredientId)} invoiced but not delivered, at ${money(l.invoicePrice)}` });
    }
    if (l.priceMoney > 0.004) out.push({ ingredientId: l.ingredientId, reason: "price", qty: round3(Math.min(l.invoiced, l.received)), amount: l.priceMoney, text: `${name(l.ingredientId)}: invoiced at ${money(l.invoicePrice)} against the order price of ${money(l.orderPrice)}, on ${round3(Math.min(l.invoiced, l.received))} ${unit(l.ingredientId)}` });
  }
  return { lines: out, amount: round2(out.reduce((s, l) => s + l.amount, 0)) };
}

// ---- Stock valuation ---------------------------------------------------------------------------------------------

export const VALUATION_LABEL: Record<ValuationMethod, string> = { wac: "Weighted average cost", fifo: "First in, first out (FIFO)", last: "Last purchase price" };

/** A purchase that entered stock: when, how much and at what price. */
export interface Lot { date: string; qty: number; price: number }

/**
 * Value of the stock on hand under a method.
 * Last purchase price: everything at the latest price. Weighted average: at the average price of the recorded purchases.
 * FIFO: what is left is the newest stock, so it is valued at the newest purchases' prices. Stock beyond the recorded
 * purchases (older stock) is valued at `fallback`, the standard cost.
 */
export function valueOnHand(onHand: number, lots: readonly Lot[], method: ValuationMethod, fallback: number): { value: number; unitCost: number } {
  const q = Math.max(0, onHand);
  const sorted = lots.filter((l) => l.qty > 1e-9).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return { value: round2(q * fallback), unitCost: fallback };
  if (method === "last") {
    const p = sorted[sorted.length - 1].price;
    return { value: round2(q * p), unitCost: p };
  }
  if (method === "wac") {
    const qty = sorted.reduce((s, l) => s + l.qty, 0);
    const avg = sorted.reduce((s, l) => s + l.qty * l.price, 0) / qty;
    return { value: round2(q * avg), unitCost: Math.round(avg * 10000) / 10000 };
  }
  let left = q;
  let value = 0;
  for (let i = sorted.length - 1; i >= 0 && left > 1e-9; i--) {
    const take = Math.min(left, sorted[i].qty);
    value += take * sorted[i].price;
    left -= take;
  }
  value += left * fallback;
  return { value: round2(value), unitCost: q > 0 ? Math.round((value / q) * 10000) / 10000 : sorted[sorted.length - 1].price };
}

// ---- Expiry: first expiring, first out -----------------------------------------------------------------------------

export interface Batch { ingredientId: string; batch: string; expiry: string; qty: number; received: string; source: string }
export interface BatchLeft extends Batch { left: number }

/**
 * What is left of each batch if stock was used first expiring, first out: the batches that expire last are the ones
 * still on the shelf. Stock beyond the recorded batches has no batch recorded and no known expiry.
 */
export function remainingByFefo(onHand: number, batches: readonly Batch[]): { batches: BatchLeft[]; noBatch: number } {
  let left = Math.max(0, onHand);
  const latestFirst = batches.slice().sort((a, b) => b.expiry.localeCompare(a.expiry) || b.received.localeCompare(a.received));
  const out: BatchLeft[] = [];
  for (const b of latestFirst) {
    const take = Math.min(left, b.qty);
    left -= take;
    if (take > 1e-9) out.push({ ...b, left: round3(take) });
  }
  return { batches: out.sort((a, b) => a.expiry.localeCompare(b.expiry)), noBatch: round3(left) };
}

/** Days from today to the expiry date. 0 is today, negative is already expired. */
export const daysToExpiry = (expiry: string, today: string) => Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

export type ExpiryActionKind = "use_first" | "transfer" | "special" | "staff_meal" | "waste";
export interface ExpiryAction { kind: ExpiryActionKind; text: string }

/**
 * What to do with a batch before it expires, by fixed rules in this order: expired, log it as waste; normal use covers
 * it, use it first; another outlet uses enough, transfer it; a dish uses it, put it in a special; otherwise staff meal.
 */
export function expiryAction(x: { left: number; daysLeft: number; dailyUse: number; unitWord: string; transferTo?: { name: string; canUse: number }; dish?: string }): ExpiryAction {
  if (x.daysLeft < 0) return { kind: "waste", text: "Expired. Remove it and log it as waste with the reason Expired." };
  const days = Math.max(1, x.daysLeft + 1);
  if (x.dailyUse * days >= x.left - 1e-9) return { kind: "use_first", text: `Normal use covers it (${round2(x.dailyUse)} ${x.unitWord} a day). Use this batch first.` };
  const extra = round2(x.left - x.dailyUse * days);
  if (x.transferTo && x.transferTo.canUse >= extra - 1e-9) return { kind: "transfer", text: `Transfer ${extra} ${x.unitWord} to ${x.transferTo.name}, which can use ${round2(x.transferTo.canUse)} before it expires.` };
  if (x.dish) return { kind: "special", text: `Use ${extra} ${x.unitWord} in a special, such as ${x.dish}.` };
  return { kind: "staff_meal", text: `Use ${extra} ${x.unitWord} in the staff meal.` };
}

// ---- Stock take variance -----------------------------------------------------------------------------------------

export interface TakeLineIn { ingredientId: string; group: string; system: number; counted: number | null; unitCost: number }
export interface VarianceLine extends TakeLineIn { diff: number; value: number }

/** System quantity against counted, in units and money, by item and by group. Items not counted change nothing. */
export function varianceReport(lines: readonly TakeLineIn[]) {
  const out: VarianceLine[] = lines.map((l) => {
    const diff = l.counted === null ? 0 : round3(l.counted - l.system);
    return { ...l, diff, value: round2(diff * l.unitCost) };
  });
  const counted = out.filter((l) => l.counted !== null);
  const groups = [...new Set(out.map((l) => l.group))].map((group) => {
    const g = counted.filter((l) => l.group === group);
    return {
      group, items: out.filter((l) => l.group === group).length, counted: g.length,
      net: round2(g.reduce((s, l) => s + l.value, 0)),
      missing: round2(g.filter((l) => l.value < 0).reduce((s, l) => s + l.value, 0)),
      surplus: round2(g.filter((l) => l.value > 0).reduce((s, l) => s + l.value, 0)),
    };
  });
  return {
    lines: out, groups,
    totals: {
      items: out.length, counted: counted.length, notCounted: out.length - counted.length,
      withDifference: counted.filter((l) => Math.abs(l.diff) > 1e-9).length,
      net: round2(counted.reduce((s, l) => s + l.value, 0)),
      missing: round2(counted.filter((l) => l.value < 0).reduce((s, l) => s + l.value, 0)),
      surplus: round2(counted.filter((l) => l.value > 0).reduce((s, l) => s + l.value, 0)),
      systemValue: round2(counted.reduce((s, l) => s + l.system * l.unitCost, 0)),
      countedValue: round2(counted.reduce((s, l) => s + (l.counted ?? 0) * l.unitCost, 0)),
    },
  };
}

// ---- Cash on hand against cash sales -------------------------------------------------------------------------------

/** A difference is flagged above €10, or above 1% of the shift's cash sales when that is more. */
export const CASH_TOLERANCE = { minimum: 10, share: 0.01 };

export function cashCheck(expected: number, counted: number) {
  const diff = round2(counted - expected);
  const limit = round2(Math.max(CASH_TOLERANCE.minimum, expected * CASH_TOLERANCE.share));
  return { diff, limit, flagged: Math.abs(diff) > limit, kind: diff < 0 ? ("short" as const) : diff > 0 ? ("over" as const) : ("exact" as const) };
}

// ---- Supplier delivery days --------------------------------------------------------------------------------------

/** Minutes after midnight for "HH:MM". */
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The first delivery day the supplier can make for an order placed now: after its cut-off, the order counts from tomorrow. */
export function nextDeliveryDate(today: string, nowMin: number, cutOff: string, leadDays: number, deliveryDays: readonly number[]): string {
  let d = addDays(today, (nowMin > minutesOf(cutOff) ? 1 : 0) + Math.max(0, leadDays));
  if (!deliveryDays.length) return d;
  for (let i = 0; i < 7 && !deliveryDays.includes(weekday(d)); i++) d = addDays(d, 1);
  return d;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
