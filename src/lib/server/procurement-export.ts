// Procurement export: approved purchase orders, goods receipts and supplier invoices, as CSV (one row per line) and as
// JSON (one record per document, with its lines). Built to be mapped later onto a hotel group's procurement platform.
// The field list below is the contract; docs/procurement-export.md describes it for whoever does the mapping.
import { ingredientById, outletById, propertyById, userById } from "../data/catalog";
import { supplierName } from "../data/purchasing-rules";
import { allowedProperties, can } from "../domain/access";
import { orderTotals, poStatus } from "../domain/procurement";
import type { PurchaseRequest, User } from "../types";
import { round2 } from "../util";
import { catalogueLine, poRef, supplierAccount } from "./procurement";
import { loadStore } from "./purchasing-store";
import type { Result } from "./purchasing";

export type ExportKind = "purchase_orders" | "receipts" | "invoices";
export interface Field { name: string; type: "string" | "number" | "date" | "datetime"; level: "document" | "line"; description: string }

const doc = (name: string, type: Field["type"], description: string): Field => ({ name, type, level: "document", description });
const line = (name: string, type: Field["type"], description: string): Field => ({ name, type, level: "line", description });

export const EXPORT_FIELDS: Record<ExportKind, Field[]> = {
  purchase_orders: [
    doc("po_number", "string", "Purchase order number, as printed on the PDF sent to the supplier."),
    doc("tyll_id", "string", "Tyll's own record id for the order."),
    doc("status", "string", "approved, sent, partly_received, received or closed."),
    doc("property_id", "string", "Hotel id in Tyll."),
    doc("property_name", "string", "Hotel name."),
    doc("supplier_id", "string", "Supplier id in Tyll."),
    doc("supplier_name", "string", "Supplier name."),
    doc("supplier_order_email", "string", "Where the order was sent."),
    doc("deliver_to", "string", "Outlet, or Main store for the hotel store."),
    doc("cost_centre", "string", "Cost centre the order is booked to, such as 4100 F&B food."),
    doc("order_date", "date", "Date the order was approved."),
    doc("delivery_date", "date", "Delivery day agreed with the supplier."),
    doc("approved_by", "string", "Name of the last approver."),
    doc("sent_at", "datetime", "When the order was emailed, local time. Empty if not sent."),
    doc("currency", "string", "ISO 4217 code: EUR, AED or SAR."),
    doc("net_total", "number", "Sum of line net amounts."),
    doc("vat_total", "number", "VAT, worked out per rate."),
    doc("gross_total", "number", "Net plus VAT."),
    doc("notes", "string", "Notes for the supplier."),
    line("line_no", "number", "Line number on the order, from 1."),
    line("item_id", "string", "Item id in Tyll."),
    line("supplier_item_code", "string", "The supplier's code for the item."),
    line("item_name", "string", "Item name."),
    line("quantity", "number", "Ordered quantity in the item's unit."),
    line("unit", "string", "kg, L or units."),
    line("pack_size", "number", "Units of the item per pack."),
    line("pack_label", "string", "The pack, such as Case of 12."),
    line("unit_price", "number", "Agreed price per unit, before VAT."),
    line("vat_rate", "number", "VAT rate as a decimal, such as 0.06."),
    line("net_amount", "number", "Quantity times unit price."),
  ],
  receipts: [
    doc("receipt_id", "string", "Goods receipt id."),
    doc("po_number", "string", "The order it was received against."),
    doc("property_id", "string", "Hotel id in Tyll."),
    doc("supplier_id", "string", "Supplier id in Tyll."),
    doc("supplier_name", "string", "Supplier name."),
    doc("received_at", "datetime", "When it was received, local time."),
    doc("received_by", "string", "Who received it."),
    doc("final", "string", "yes when the receiver closed the order with this delivery."),
    doc("currency", "string", "ISO 4217 code."),
    line("item_id", "string", "Item id in Tyll."),
    line("item_name", "string", "Item name."),
    line("unit", "string", "kg, L or units."),
    line("delivered", "number", "Quantity that arrived."),
    line("damaged", "number", "Quantity refused as damaged."),
    line("accepted", "number", "Delivered less damaged: what entered stock."),
    line("batch", "string", "Supplier batch or lot number, if recorded."),
    line("expiry", "date", "Use-by or best-before date, if recorded."),
    line("unit_price", "number", "Order price per unit, before VAT."),
    line("accepted_value", "number", "Accepted quantity times the order price."),
  ],
  invoices: [
    doc("invoice_id", "string", "Invoice id in Tyll."),
    doc("supplier_invoice_number", "string", "The supplier's invoice number."),
    doc("po_number", "string", "The order the invoice is for."),
    doc("property_id", "string", "Hotel id in Tyll."),
    doc("supplier_id", "string", "Supplier id in Tyll."),
    doc("supplier_name", "string", "Supplier name."),
    doc("invoice_date", "date", "Invoice date."),
    doc("status", "string", "to_check, matched, flagged, correction_requested, approved or posted."),
    doc("currency", "string", "ISO 4217 code."),
    doc("net_total", "number", "Invoice net total."),
    doc("vat_total", "number", "VAT, worked out per rate."),
    doc("gross_total", "number", "Net plus VAT."),
    line("item_id", "string", "Item id in Tyll."),
    line("item_name", "string", "Item name."),
    line("quantity", "number", "Invoiced quantity."),
    line("unit", "string", "kg, L or units."),
    line("unit_price", "number", "Invoiced price per unit, before VAT."),
    line("vat_rate", "number", "VAT rate as a decimal."),
    line("net_amount", "number", "Quantity times unit price."),
    line("ordered", "number", "Quantity on the order."),
    line("received", "number", "Quantity accepted into stock."),
    line("order_price", "number", "Price per unit on the order."),
    line("difference", "number", "Invoiced beyond what was received at the order price. 0 when it matches."),
  ],
};

type Row = Record<string, string | number | null>;
/** A document: its own fields, and its lines. */
export type ExportDoc = { [k: string]: string | number | null | Row[] } & { lines: Row[] };
const unitOf = (g: string) => (ingredientById[g].unit === "each" ? "units" : ingredientById[g].unit === "l" ? "L" : "kg");
const name = (id?: string) => (id ? userById[id]?.name ?? id : "");
const approvedAt = (r: PurchaseRequest) => r.history.find((h) => h.status === "approved")?.at.slice(0, 10) ?? "";
const approver = (r: PurchaseRequest) => [...r.history].reverse().find((h) => h.status === "approved")?.by;
const supplierOf = (r: PurchaseRequest) => r.supplierId ?? r.lines[0]?.supplierId ?? "";
const within = (date: string, from?: string, to?: string) => (!from || date >= from) && (!to || date <= to);

/** Documents and their lines, ready for JSON. */
export function exportDocuments(user: User, propertyId: string, kind: ExportKind, from?: string, to?: string): Result<{ documents: ExportDoc[] }> {
  if (!(can(user, "purchase.review") || can(user, "finance.review") || can(user, "purchase.approveManager") || can(user, "purchase.approveFnb"))) return { ok: false, status: 403, error: "Only purchasing, accounting or senior managers can export procurement records." };
  if (!allowedProperties(user).includes(propertyId)) return { ok: false, status: 403, error: "This hotel is outside your access." };
  const s = loadStore();
  const prop = propertyById[propertyId];
  const currency = prop.currency;
  const requests = s.requests.filter((r) => r.propertyId === propertyId && !r.deliveryId);
  if (kind === "purchase_orders") {
    const docs = requests.filter((r) => ["approved", "received"].includes(r.status) && within(approvedAt(r), from, to)).map((r) => {
      const t = orderTotals(r.lines);
      const sup = supplierOf(r);
      return {
        po_number: poRef(r), tyll_id: r.id, status: poStatus(r), property_id: propertyId, property_name: prop.name, supplier_id: sup, supplier_name: supplierName(sup),
        supplier_order_email: supplierAccount(propertyId, sup, s)?.orderEmail ?? "", deliver_to: r.outletIds.length === 1 ? outletById[r.outletIds[0]].name : "Main store",
        cost_centre: r.costCentre ?? "", order_date: approvedAt(r), delivery_date: r.deliveryDate ?? r.period.from, approved_by: name(approver(r)), sent_at: r.sent?.at ?? r.sentAt ?? "",
        currency, net_total: t.net, vat_total: t.vat, gross_total: t.gross, notes: r.comment ?? "",
        lines: r.lines.map((l, i) => ({
          line_no: i + 1, item_id: l.ingredientId, supplier_item_code: catalogueLine(propertyId, l.supplierId, l.ingredientId, s)?.code ?? "", item_name: ingredientById[l.ingredientId].name,
          quantity: l.qty, unit: unitOf(l.ingredientId), pack_size: l.packSize ?? null, pack_label: l.packLabel ?? "", unit_price: l.unitPrice, vat_rate: l.vatRate ?? null, net_amount: round2(l.qty * l.unitPrice),
        })),
      };
    });
    return { ok: true, documents: docs };
  }
  if (kind === "receipts") {
    const docs = requests.flatMap((r) => (r.receipts ?? []).filter((rc) => within(rc.at.slice(0, 10), from, to)).map((rc) => ({
      receipt_id: rc.id, po_number: poRef(r), property_id: propertyId, supplier_id: supplierOf(r), supplier_name: supplierName(supplierOf(r)), received_at: rc.at, received_by: name(rc.by), final: rc.final ? "yes" : "no", currency,
      lines: rc.lines.map((l) => {
        const price = r.lines.find((x) => x.ingredientId === l.ingredientId)?.unitPrice ?? 0;
        return { item_id: l.ingredientId, item_name: ingredientById[l.ingredientId].name, unit: unitOf(l.ingredientId), delivered: l.delivered, damaged: l.damaged, accepted: l.accepted, batch: l.batch ?? "", expiry: l.expiry ?? "", unit_price: price, accepted_value: round2(l.accepted * price) };
      }),
    })));
    return { ok: true, documents: docs };
  }
  const docs = s.finance.invoices.filter((i) => i.propertyId === propertyId && within(i.date, from, to)).map((i) => {
    const r = s.requests.find((x) => x.id === i.requestId);
    const lines = i.lines.map((l) => {
      const o = r?.lines.find((x) => x.ingredientId === l.ingredientId);
      const vat = o?.vatRate ?? catalogueLine(propertyId, i.supplierId, l.ingredientId, s)?.vatRate ?? 0;
      const received = o?.received ?? 0;
      const orderPrice = o?.unitPrice ?? l.unitPrice;
      const difference = round2(Math.max(0, l.qty * l.unitPrice - Math.min(l.qty, received) * orderPrice));
      return { item_id: l.ingredientId, item_name: ingredientById[l.ingredientId].name, quantity: l.qty, unit: unitOf(l.ingredientId), unit_price: l.unitPrice, vat_rate: vat, net_amount: round2(l.qty * l.unitPrice), ordered: o?.qty ?? 0, received, order_price: orderPrice, difference };
    });
    const t = orderTotals(lines.map((l) => ({ qty: l.quantity, unitPrice: l.unit_price, vatRate: l.vat_rate })));
    return { invoice_id: i.id, supplier_invoice_number: i.supplierRef, po_number: i.poNumber, property_id: propertyId, supplier_id: i.supplierId, supplier_name: supplierName(i.supplierId), invoice_date: i.date, status: i.status, currency, net_total: t.net, vat_total: t.vat, gross_total: t.gross, lines };
  });
  return { ok: true, documents: docs };
}

/** One row per line, document fields repeated, columns in the order of the field list. */
export function toCsv(kind: ExportKind, documents: ExportDoc[]): string {
  const fields = EXPORT_FIELDS[kind];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Neutralise spreadsheet formula injection as well as quoting.
    const safe = /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : s;
    return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = documents.flatMap((d) => (d.lines.length ? d.lines : [{}]).map((l) => fields.map((f) => esc(f.level === "document" ? (d[f.name] as Row[string]) : (l as Row)[f.name])).join(",")));
  return [fields.map((f) => f.name).join(","), ...rows].join("\n");
}

export function toJson(kind: ExportKind, propertyId: string, documents: ExportDoc[]) {
  const p = propertyById[propertyId];
  return { format: "tyll.procurement", version: 1, kind, generated_at: new Date().toISOString(), property: { id: p.id, name: p.name, currency: p.currency }, count: documents.length, documents };
}
