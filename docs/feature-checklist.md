# Tyll feature checklist (draft for the RFP)

Prepared 19 November 2026 from the Tyll demo (branch `feature/purchasing-stock-control`). Every status below describes **the demo**, because that is what was built and tested here. The live product's code was not available, so **no line says "live in production"**: confirm each one against the live product before the answer goes to the hotel group.

**Status words**

- **Working and tested**: works in the demo, covered by automated tests, and clicked through in a browser.
- **Working, logic tested**: works in the demo and its rules are covered by automated tests; not every screen was clicked through.
- **In progress**: partly built; what is missing is said.
- **Planned**: designed or requested, not built.

"Simulated" means the demo uses made-up records where a real hotel would connect its own systems.

## Stock and waste

| Feature | Status | Notes |
|---|---|---|
| Stock levels: last count plus deliveries, less what recipes say was used, less waste | Working and tested | Simulated sales and deliveries. |
| Stock valuation per hotel: weighted average cost, FIFO or last purchase price, from invoiced prices | Working and tested | The controller or general manager chooses; every stock value says which method. |
| Par levels: minimum and maximum per item and location, with suggestions from the prediction | Working and tested | Main store levels drive purchase orders. |
| Outlet par levels and top-ups from the main store | In progress | Top-ups are listed per outlet from its last count; recording the issue as a transfer is not built. |
| Stock take by location and area, full or partial, on a phone or tablet | Working and tested | Counted by typing or by a barcode scanner that types into the scan field. |
| Camera barcode scanning | In progress | Built with the browser's barcode reader (Chrome on Android and desktop); not tested on a real device; not available in Safari. |
| Variance report before stock changes: system against counted, units and money, by item and group | Working and tested | |
| Manager approval of a stock take, then stock adjusts | Working and tested | The person who counted cannot approve. |
| Every stock take kept; month-end report with CSV | Working and tested | |
| Batches with use-by dates from deliveries and receiving | Working, logic tested | Earlier deliveries get the item's shelf life as their use-by date. |
| Expiring soon: own menu item, a "Use today" list at the top, and a daily bell notice to the chef, outlet managers, F&B director and storekeeper | Working and tested | Actions by fixed rules: use first, transfer, special, staff meal. The notice is worked out when someone opens the demo that day, not on a server timer. |
| First expiring, first out | Working, logic tested | Used to work out what is left of each batch and which to use first; not enforced when stock is issued. |
| "Expired" waste reason | Working, logic tested | |
| Waste and breakage logging in two taps | Working and tested | Existing feature. |
| Over pouring: wine and spirits sold against bottles opened | Working and tested | Bottles opened are simulated; the POS does not record them. |

## Purchasing

| Feature | Status | Notes |
|---|---|---|
| Suppliers per hotel: contact, order email, delivery days, cut-off, minimum order, payment terms | Working and tested | Fictional suppliers. The same company can have other terms at another hotel. |
| Supplier catalogue: codes, barcodes, packs (case of 6, 12, 24), agreed prices, VAT | Working and tested | |
| Price history per item from invoices; flag when above the agreed price | Working and tested | |
| To order: items below minimum with the quantity back to maximum | Working and tested | |
| One click: draft purchase orders grouped by supplier, with delivery date, cost centre and notes | Working and tested | Delivery date follows the supplier's days and cut-off; a minimum order shortfall is flagged. |
| Purchase orders from the recommended order (Predictions) | Working, logic tested | Same per-supplier drafts. |
| Approval limits: purchasing, accounting, F&B director above €2,000, general manager above €5,000 | Working and tested | Nobody approves their own order. Limits are per hotel in the code; editing them on screen is not built. |
| Statuses: draft, waiting for approval, approved, sent, partly received, received, closed | Working and tested | Full history on each order. |
| Purchase order PDF, kept with the order | Working and tested | |
| Email to the supplier | In progress | The email is prepared and logged with its PDF; the demo never sends it. Sending needs an email provider. |
| Receiving per line: delivered, damaged, batch, use-by; partial deliveries; stock updates | Working and tested | |
| Three way match: order, receipt and invoice, differences in units and money | Working and tested | |
| Draft credit request from the match | Working and tested | Sending it is logged, not emailed. |
| Closing an order | Working, logic tested | |
| Automatic ordering each morning with stated rules | Working and tested | Runs when the demo is opened that day, not on a server timer. |
| Procurement export: CSV and JSON for orders, receipts and invoices, with a field list | Working, logic tested | Field list: `docs/procurement-export.md`. Not connected to any group platform. |
| Currencies EUR, AED and SAR per hotel; VAT for Portugal, UAE (5%) and Saudi Arabia (15%) | In progress | Formatting and VAT are built and tested; the demo hotel is in EUR, so no AED or SAR hotel is shown. |
| Oracle Simphony, Lightspeed and SumUp connections; menu sync with "Needs a recipe" | Planned | Waiting for approval of the plan. |

## Revenue and reconciliation

| Feature | Status | Notes |
|---|---|---|
| Flags for voids, refunds, comps and discounts without a reason or above a limit | Working and tested | Each flag says what it was compared against. |
| Items removed from a bill after they were sent to the kitchen or bar | Working and tested | |
| Room charges missing, doubled, different, on the wrong room or posted after check-out on the guest folio | Working and tested | Simulated PMS. Room charge check at /money?tab=rooms. |
| Cash on hand against cash sales, per outlet and shift | Working and tested | Flagged above €10 or 1%. Past counts are simulated; new ones are entered in Tyll. |
| Stock losses marked as estimates until a stock take confirms them | Working and tested | |
| Card payments | Not checked | Reconciled by the payment provider. |

## Platform and Middle East readiness

| Feature | Status | Notes |
|---|---|---|
| Runs in any modern browser on laptop, tablet or phone; nothing to install | Working and tested | |
| Roles: purchasing manager, F&B director, head chef, financial controller (and more) | Working and tested | Server checks every action. |
| Arabic interface with right-to-left layout | In progress | Main screens and the new purchasing and stock screens' titles and buttons are translated; longer explanations on the new screens are still English. |
| Predictions from Tyll's own model; no AI chooses a quantity | Working and tested | Stated on the Predictions page. |
| Demo visit tracking with consent: pages opened, time spent, role; team page at /admin/visits with GitHub sign-in or an admin key; Slack or email alerts | Working and tested | Only after a yes in the banner; Global Privacy Control counts as no; erased when turned off in Settings; kept 90 days. Alerts are logged, not sent, until Slack or email is configured. GitHub sign-in is tested against a simulated GitHub; not yet tried with a real GitHub app. |
| Feedback button, privacy policy, Impressum | Planned | Waiting for approval of the plan and the company details. |

## Not covered by this checklist

- The live product: every line needs confirming there.
- Hosting, data protection agreements and security reviews for a production rollout.
