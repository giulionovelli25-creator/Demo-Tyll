# Procurement export: field list

Tyll exports approved purchase orders, goods receipts and supplier invoices for a hotel group's procurement or accounting platform. This list is the contract for mapping the fields to that system.

## How to get it

- In Tyll: Purchasing, Orders, "Procurement export" (purchasing, accounting, the F&B director and the general manager).
- Over HTTP (signed in): `GET /api/procurement/export?kind=purchase_orders|receipts|invoices&propertyId=lis&format=csv|json&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- The field list as JSON: `GET /api/procurement/export?kind=...&fields=1`.

## Formats

- **CSV:** UTF-8 with a byte order mark, comma separated, one row per line, document fields repeated on every row, columns in the order below. Text starting with `=`, `+`, `-` or `@` is prefixed with `'` so a spreadsheet never runs it as a formula.
- **JSON:** `{ "format": "tyll.procurement", "version": 1, "kind", "generated_at", "property": { "id", "name", "currency" }, "count", "documents": [ { ...document fields, "lines": [ { ...line fields } ] } ] }`.
- Dates are `YYYY-MM-DD`; date-times are local hotel time `YYYY-MM-DDTHH:MM`. Amounts are in the hotel's currency (ISO 4217: EUR, AED or SAR), before VAT unless the name says otherwise. VAT rates are decimals (0.06 is 6%).
- Only approved orders are exported (approved, sent, partly received, received, closed). Drafts and orders waiting for approval are not.

## Approved purchase orders (`purchase_orders`)

| Field | Level | Type | Meaning |
|---|---|---|---|
| `po_number` | document | string | Purchase order number, as printed on the PDF sent to the supplier. |
| `tyll_id` | document | string | Tyll's own record id for the order. |
| `status` | document | string | approved, sent, partly_received, received or closed. |
| `property_id` | document | string | Hotel id in Tyll. |
| `property_name` | document | string | Hotel name. |
| `supplier_id` | document | string | Supplier id in Tyll. |
| `supplier_name` | document | string | Supplier name. |
| `supplier_order_email` | document | string | Where the order was sent. |
| `deliver_to` | document | string | Outlet, or Main store for the hotel store. |
| `cost_centre` | document | string | Cost centre the order is booked to, such as 4100 F&B food. |
| `order_date` | document | date | Date the order was approved. |
| `delivery_date` | document | date | Delivery day agreed with the supplier. |
| `approved_by` | document | string | Name of the last approver. |
| `sent_at` | document | datetime | When the order was emailed, local time. Empty if not sent. |
| `currency` | document | string | ISO 4217 code: EUR, AED or SAR. |
| `net_total` | document | number | Sum of line net amounts. |
| `vat_total` | document | number | VAT, worked out per rate. |
| `gross_total` | document | number | Net plus VAT. |
| `notes` | document | string | Notes for the supplier. |
| `line_no` | line | number | Line number on the order, from 1. |
| `item_id` | line | string | Item id in Tyll. |
| `supplier_item_code` | line | string | The supplier's code for the item. |
| `item_name` | line | string | Item name. |
| `quantity` | line | number | Ordered quantity in the item's unit. |
| `unit` | line | string | kg, L or units. |
| `pack_size` | line | number | Units of the item per pack. |
| `pack_label` | line | string | The pack, such as Case of 12. |
| `unit_price` | line | number | Agreed price per unit, before VAT. |
| `vat_rate` | line | number | VAT rate as a decimal, such as 0.06. |
| `net_amount` | line | number | Quantity times unit price. |

## Goods receipts (`receipts`)

| Field | Level | Type | Meaning |
|---|---|---|---|
| `receipt_id` | document | string | Goods receipt id. |
| `po_number` | document | string | The order it was received against. |
| `property_id` | document | string | Hotel id in Tyll. |
| `supplier_id` | document | string | Supplier id in Tyll. |
| `supplier_name` | document | string | Supplier name. |
| `received_at` | document | datetime | When it was received, local time. |
| `received_by` | document | string | Who received it. |
| `final` | document | string | yes when the receiver closed the order with this delivery. |
| `currency` | document | string | ISO 4217 code. |
| `item_id` | line | string | Item id in Tyll. |
| `item_name` | line | string | Item name. |
| `unit` | line | string | kg, L or units. |
| `delivered` | line | number | Quantity that arrived. |
| `damaged` | line | number | Quantity refused as damaged. |
| `accepted` | line | number | Delivered less damaged: what entered stock. |
| `batch` | line | string | Supplier batch or lot number, if recorded. |
| `expiry` | line | date | Use-by or best-before date, if recorded. |
| `unit_price` | line | number | Order price per unit, before VAT. |
| `accepted_value` | line | number | Accepted quantity times the order price. |

## Supplier invoices (`invoices`)

| Field | Level | Type | Meaning |
|---|---|---|---|
| `invoice_id` | document | string | Invoice id in Tyll. |
| `supplier_invoice_number` | document | string | The supplier's invoice number. |
| `po_number` | document | string | The order the invoice is for. |
| `property_id` | document | string | Hotel id in Tyll. |
| `supplier_id` | document | string | Supplier id in Tyll. |
| `supplier_name` | document | string | Supplier name. |
| `invoice_date` | document | date | Invoice date. |
| `status` | document | string | to_check, matched, flagged, correction_requested, approved or posted. |
| `currency` | document | string | ISO 4217 code. |
| `net_total` | document | number | Invoice net total. |
| `vat_total` | document | number | VAT, worked out per rate. |
| `gross_total` | document | number | Net plus VAT. |
| `item_id` | line | string | Item id in Tyll. |
| `item_name` | line | string | Item name. |
| `quantity` | line | number | Invoiced quantity. |
| `unit` | line | string | kg, L or units. |
| `unit_price` | line | number | Invoiced price per unit, before VAT. |
| `vat_rate` | line | number | VAT rate as a decimal. |
| `net_amount` | line | number | Quantity times unit price. |
| `ordered` | line | number | Quantity on the order. |
| `received` | line | number | Quantity accepted into stock. |
| `order_price` | line | number | Price per unit on the order. |
| `difference` | line | number | Invoiced beyond what was received at the order price. 0 when it matches. |

## Mapping notes

- `supplier_id` and `item_id` are Tyll's ids. Map them once to the group's vendor and article numbers; `supplier_item_code` carries the supplier's own code.
- A purchase order can have several receipts (partial deliveries). `accepted` is what entered stock; `damaged` was refused.
- `difference` on an invoice line is what was invoiced beyond what was received at the order price, the basis of a credit request.
- Nothing is pushed to another system from this demo. A live connection would send the same records through the group platform's API, under its own credentials, kept on the server.
