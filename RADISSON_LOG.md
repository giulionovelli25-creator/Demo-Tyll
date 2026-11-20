# Radisson feedback build: log

Branch `feature/radisson-feedback`, from `feature/simplify-demo` (3f2e49a), which sits on `feature/late-delivery-prediction`, `feature/overnight-checks` and `fix/critical-audit`. Nothing is pushed to main or deployed. No real external call is made anywhere.

## 2. What already exists (read before building)

Read: AUDIT_LOG.md, REPORT.md, OVERNIGHT_LOG.md, MORNING_REPORT.md, FEATURE_LOG.md, FEATURE_REPORT.md, SIMPLIFY_LOG.md, SIMPLIFY_REPORT.md, and the git log.

| Earlier task | Item | State in the code | What this build does with it |
|---|---|---|---|
| Critical audit | Person switching | Done, tested (one role per session, switcher only) | Reuse |
| Critical audit | Overdue date rules, one business date | Done; simplify added the page date meta | Reuse |
| Critical audit | Order states and approval chain | Draft, purchasing, accounting, F&B director over €2,000, GM over €5,000, approved, sent (logged), received, closed; nobody approves their own order | Reuse; add the sending states below |
| Critical audit | Idempotent sending | Done (send once, confirm before sending, "logged, not emailed") | Reuse inside the new sending step |
| Critical audit | Sending, failed, retry states | **Not built** (AUDIT_LOG F5: "no transport exists") | **Build first** (item 2) |
| Critical audit | Server side validation | Done on every route | Reuse |
| Overnight | Room charges, reopened bills, till rules, covers, hotel guests, bought against used, empty bottle scan | Done, flag types in "What Tyll checks" | Reuse |
| Overnight | Tables with food but no drink, drinks per guest by waiter | Done as a coaching page (`/money?tab=waiters`, `noDrink` in `lib/domain/waiters.ts`); **not** a flag type, not in "What Tyll checks" | Extend into the "Meal with no drink" rule (item 8) |
| Overnight | Save all user input on the server, workspaces | Done | Reuse for every new record |
| Overnight | POS and PMS adapters | **Lightspeed K Series** and **Mews**, sample responses only, behind `PosAdapter` and `PmsAdapter`; Settings > Data sources and `/settings/adapters` | Add **Simphony** as a second POS adapter behind the same interface (item 3) |
| Late delivery | Delivery history, one tap Received, supplier reliability, deliveries at risk | Done (`lib/data/delivery-history.ts`, `lib/server/late-delivery.ts`, `/forecast?tab=reliability`) | Reuse the same delivery record for "Delivered" (item 2) |
| Simplify | Flow and Rooms hidden, previews hidden | Switches in `lib/features.ts` | Keep hidden |
| Simplify | Expiring soon | **Hidden** (`expiry: false`) | Switch back on and make it actionable (item 6) |
| Simplify | Flags merged with the Money Back List; Purchasing as Ordering, Orders, Suppliers, Deliveries and invoices; redirects | Done | Follow these routes |
| Simplify | Overview, one business date, reconciled numbers, guided path | Done | Replace the guided path (section 6) |
| Earlier stages | Stock valuation WAC, FIFO or last price | Setting in Settings > Purchasing; stock values say which method | Extend: prices from approved invoices (item 5) |
| Earlier stages | Ingredient prices | Edited by hand on Recipes and costs, with a price log | Become explained overrides over invoice prices (item 5) |
| Earlier stages | Price history per item from invoices, "above agreed" flag | Done in Suppliers > Catalogue and prices | Reuse for last invoice and contract price (item 5) |
| Earlier stages | Stock takes with variance and approval | Done (`/stock?tab=takes`, the counter cannot approve, month end report); **no seeded stock take** waiting for approval | Add a clear review step and seed one waiting for approval (item 7) |
| Earlier stages | Menu sync, new dish needs a recipe, modifiers | **Not built** (feature checklist: "Planned"); six menu items use a standard cost | Build (item 4) |
| Earlier stages | "Order now" on critical items | **Not built** (To order creates orders in bulk; Stock, alerts and Overview only link to Ordering) | Build (item 1) |
| Earlier stages | Supplier confirmation | **Not built** | Build (item 2) |

## 3. The demo before this build

Measured on the simplify build, public demo, as the Purchasing Manager, F&B Director and Head Chef.

| # | Criterion | Before | Evidence |
|---|---|---|---|
| 1 | Automatic purchasing | 6 | The 06:00 run makes orders, and small ones are approved by rule and "sent (logged)"; but critical stock on Stock or the Overview has no "Order now", nothing is sent after a person approves, and there is no supplier confirmation. |
| 2 | Simphony fit | 3 | Data sources lists Lightspeed and Mews only; Simphony appears only as "Planned" in the checklist. |
| 3 | Menu changes | 2 | No menu sync; six dishes sit on a standard cost with no path to a recipe beyond editing by hand. |
| 4 | Valuation | 6 | WAC, FIFO or last price can be chosen and stock values name the method, but ingredient prices are typed by hand rather than taken from invoices. |
| 5 | Expiry | 3 | Expiring soon is switched off; when on, it lists actions in words but nobody is sent anything to do. |
| 6 | Stock counts | 7 | Stock takes show system against counted with approval by another manager, but none is waiting, so it cannot be shown without counting first. |
| 7 | Trust | 8 | Honest labels and reconciled figures (simplify pass); nothing yet claims Simphony. |
| 8 | Speed and reliability | 8 | Pages ready in 0.1 to 0.3 s locally, no console errors or dead links; the plan is fetched twice on every page and the orders list two or three times. |
| 9 | Clarity | 9 | One question per page, short lists (simplify pass). |
| 10 | Polish | 9 | Consistent design, phone and Arabic checked on the main pages. |

## 4. Bugs: checked first

| Bug | Found | Detail |
|---|---|---|
| Slow load, hundreds of requests | **Not reproduced locally**; duplicates found | Locally (production build): pages ready in 124 to 245 ms; 9 to 12 API calls per page, no 502 or 503. Duplicates on every page: `POST /api/plan/month` twice; `GET /api/purchasing` two or three times on Orders and the Overview; `POST /api/stock` and `POST /api/auto-order` twice on their pages. The 15 s and 502/503 point at the hosted server's cold start: the simulated data (sales, deliveries, counts) is built on the first request of each process. |
| Empty "All" on Orders | **Similar case found** | "All" (`queue=all`) shows every order. But a role's own queue opens by default even when it is empty: the controller opens on "Waiting for accounting", which is empty, and reads "Nothing here" while 3 orders wait elsewhere. |
| Deep links | **Works** | `/forecast?tab=approvals&request=PR-LIS-0008`, `/investigations/EX-MER-1119-301` and `/forecast?risk=…` load directly, with no "Loading Tyll" hang. |

### Bugs: fixed

| Bug | Fix | Before | After |
|---|---|---|---|
| Duplicate requests | Reads that carry this session's entries wait for the saved records (at most 1.5 s), so a page asks once instead of once without and again with them; two parts of a page asking the same thing at the same moment share one request (`readShared` in `lib/api.ts`), cleared after every change | 9 to 12 calls a page; `plan/month` 2x on every page, `purchasing` 2 to 3x, `stock` and `auto-order` 2x | 7 to 10 calls a page, **0 duplicates** on 18 page loads (3 roles x 6 pages) |
| Slow first load | `src/instrumentation.ts` builds the simulated dataset when the server starts, not on the first visitor's page | Locally 124 to 255 ms a page; dataset built on the first request (`/api/data` 342 ms cold) | Locally 112 to 249 ms a page, the first page after a restart included (113 ms) |
| Orders opens empty | `openingQueue` (`lib/domain/order-queues.ts`): Orders opens on the role's own step only when it has orders, otherwise on All; a filter in the address always wins | Controller: "Nothing here" | Controller: All (9) |
| Deep links | Checked, already working | `?request=PR-LIS-0008` opens the order | Same, also measured: 121 to 129 ms |

The 15 s and 502/503 seen on the hosted demo cannot be reproduced locally. The likely causes are the host's cold start (now shortened by the warm-up) and the request count (now lower). Tests: `src/lib/__tests__/radisson.test.ts`, Orders filters (4 tests).

## 5. Features

### 1. Order now (done)
- **Server:** `orderNow` in `lib/server/purchasing.ts`, action `order-now` (and `order-now-preview`, which saves nothing) on `/api/plan/month`. One critical or low item at the plan's suggested quantity (`nextQty`, whole packs), from the catalogue's preferred supplier. It joins the person's open draft for that supplier (`openDraftFor`, the same rule To order uses) or starts one, then is submitted to purchasing, so it enters the normal approval chain. A second press finds the item on order and is refused (409). Roles without `purchase.create` are refused (403).
- **Screens:** Stock levels (critical list, with "Order all N now", and every row of the item table, phone and desktop), the stock alerts on Alerts, and the Stock levels card on the Overview. A drawer shows what will happen (quantity, supplier, value, new order or joins your draft) before anything is saved, then "Sent for approval as PR-LIS-0012" with "Open the order".
- **Decision:** items that are critical or low but already covered by an open order show "On order" instead of the button. Today the two critical items (cheddar, flour) are in this morning's automatic order, waiting for approval; the Overview card now says "2 critical ... already on order" instead of "2 to order today", which asked for an order that already exists.
- **Tests:** 6 in `radisson.test.ts` (suggested quantity and usual supplier, preview saves nothing, no double order, joins the open draft, refused for the controller and for an item that is fine).
- **Checked in the browser:** as the Head Chef, Stock levels, Low, Wagyu beef mince: 23.0 kg from Carnes Ribeiro & Filhos, €1,104; sent as PR-LIS-0012; the link opens the order, "Draft purchase order created from Order now", "Submitted to purchasing".

### 2. Sending orders to suppliers (done)
- **State machine first:** `lib/domain/dispatch.ts`: draft, pending approval, approved, sending, sent, failed (`SEND_NEXT`, `canMove`, `sendState`). Failed goes back to sending; sent goes nowhere. Older orders sent before this record read as sent.
- **Idempotent sending, safe retry:** `sendPurchaseOrder` (`lib/server/procurement.ts`) claims the order (approved or failed to sending) in one write, tries, then writes sent or failed. Every try carries one sending reference (`SEND-LIS-0002`). The simulated supplier side (`lib/server/supplier-sim.ts`) keeps the references it has received, so a retry after a lost answer is recognised and never booked twice. A sent order is never sent again (409).
- **Channel per supplier:** `SupplierAccount.channel`: email with the PDF (most), the supplier's ordering system (Mercearia Lusa, Douro Cellars), by phone recorded by purchasing (Horeca Ibérica, Linho Lisboa). Set in Suppliers, Edit ("How approved orders are sent"); purchasing, the F&B director and the general manager may change it.
- **Automatic sending:** `sendApproved` sends every fully approved supplier order not yet sent. It runs right after the last approval (the purchasing route), and whenever orders or the plan are read, so nothing waits. Phone suppliers wait for purchasing ("Record the phone order"); failed orders wait for a person to retry. Settings, Purchasing has "Sending approved orders" (on by default) for purchasing, the F&B director or the general manager. It lives in the route, not in the approval rule, so the existing tests that approve and then send by hand still describe the manual path.
- **Simulated supplier behaviour:** Douro Cellars' system receives the first push but the answer is lost (a 30 second timeout): the order shows Sending failed, purchasing gets a bell notice, Retry finds the order already there ("not sent a second time"). Mercearia Lusa confirms with a change: a third less of its largest line (today dark chocolate 27 kg to 18 kg), for purchasing to accept (the order takes the new quantity and its budget figure moves) or decline with a reason. Everyone else confirms as ordered.
- **Export:** CSV and JSON export unchanged, tested again with a sent order.
- **Delivered:** the order's goods receipt also writes its arrival in the one delivery record (`lateDelivery.arrivals`, key `PR:<id>`), and a one tap Received on an order's key records the goods receipt on the order. Orders (Delivered), goods in and reliability read the same record; a second Received is refused.
- **Decision:** PR-LIS-0002 (Douro Cellars, waiting for purchasing) is now a single supplier order in the seed, so it goes through the new sending. Automatic orders carry the F&B director's name as keeper of the rule; the rule raised them, so the F&B director may approve one (still one step per person). A request the F&B director raised by hand still needs someone else (tested).
- **Store:** `DATA_VERSION` 5, so saved demo stores are rebuilt with the channels and the changed seed.
- **Tests:** 15 more in `radisson.test.ts`.
- **Checked in the browser:** purchasing then the controller approve PR-LIS-0002: Sending failed with the reason and Retry; Retry: Sent, "already had this order under reference SEND-LIS-0002, so it was not sent a second time", the failure notice cleared. PR-LIS-0008 through purchasing, controller and F&B director: sent automatically, Paulo Lusa proposes dark chocolate 27.0 kg to 18.0 kg; Accept: "Change from Mercearia Lusa accepted by Nadia Rahman", budget left moved from €20,774 to €20,987.
