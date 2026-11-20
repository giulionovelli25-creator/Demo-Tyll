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

### 3. Simphony as the connected POS (done)
- **Adapter:** `lib/server/integrations/simphony.ts`, `SimphonyPos implements PosAdapter` (`fetchOrders`), plus `readMenu` for the menu sync and `readDay` with each line's modifiers. Built behind the same interface as Lightspeed; shaped after Oracle's published Simphony data (guest checks with detail lines; menu items with prices and condiment groups). Field names are to be confirmed against a sandbox, and the code says so.
- **Recorded samples:** `fixtures/simphony-menu.json` (Mercado's menu, prices, condiment groups Double and No cheese) and `fixtures/simphony-guest-checks.json` (three checks: a burger with No cheese, mojitos with one Double, a void with its reason, a 10% hotel guest discount, a room charge). Replayed by `simphony-sample.ts`; the checks move to the day asked for, other days have no sales.
- **Settings, Data sources:** new row "Oracle Simphony (MICROS)", status **Demo connection**, "Last sync 06:00, demo connection", reading sales (guest checks), menu items and prices, modifiers, voids and discounts. The adapters page (`/settings/adapters`) opens with a Simphony panel: what it reads and this morning's sync. The other sources are unchanged; Simphony was already named in the generic POS row.
- **Decision:** a new connection state, `demo_connection`, so Simphony is neither called live nor "adapter built, unverified". No call leaves the server.

### 4. Menu sync and new dishes (done)
- **Rules:** `lib/domain/menu-sync.ts` (pure): `diffMenu`, `standardCost` (30% of price for food, 22% for drinks, the group standard), `suggestRecipe` (the closest dish in the same category, scored on the rest of the dish, its main ingredient swapped for the one the new name mentions; it says which dish and what was swapped; no AI), `MODIFIER_RULES` and `applyModifiers`.
- **Sync:** `lib/server/menu-sync.ts` runs once per business day at 06:00 from the Simphony adapter (`ensureMenuSync`, called by `/api/menu`). Today: **2 new dishes** (Sea bass with lemon butter, Lobster burger), **1 price change** (Wagyu beef burger €22.00 to €24.00), **1 dish removed** (Kids pasta, archived). Saved in the store (`menuSync`); reset with stock.
- **Recipes and costs:** the status line "Menu synced from Simphony at 06:00: 2 new dishes, 1 price change, 1 dish removed", with each change; margins use the till price ("from Simphony"); archived dishes leave the list. "New dishes from Simphony": standard cost labelled "30% of the price until the recipe is confirmed"; the suggested recipe labelled "Suggested, please check", with its source dish; quantities editable, ingredients added or removed, "Confirm recipe" on the same screen (chef, or whoever sets prices; others see "The chef confirms the recipe"). Confirmed dishes show the recipe cost and margin.
- **Chef alert:** a bell notice to the head chef and the F&B director, "2 new dishes need a recipe", and an alert on Alerts ("Confirm recipes"), which drops to 1 and then clears as recipes are confirmed.
- **Modifiers:** Double doubles the spirit (rum, vodka, coffee liqueur), No cheese takes the cheese out (cheddar, parmesan, mozzarella). Seeded example from last night's recorded checks: Wagyu beef burger with No cheese (none of the recipe's 30 g cheddar used) and Signature mojito with Double (100 ml rum instead of 50 ml). The simulated sales elsewhere carry no modifiers, and the screen says so.
- **Tests:** 10 more in `radisson.test.ts` (adapter mapping, data source row, diff, suggestions, standard cost, modifiers, daily sync with the chef notice once, confirmation permissions and validation, last night's examples).
- **Checked in the browser:** as the Head Chef on Recipes and costs: the line, both dishes, Sea bass from Grilled salmon with Sea bass fillet in place of Salmon fillet (€8.27 against a standard €8.70), confirmed from the screen; the modifiers panel with both examples.

### 5. Ingredient prices from approved supplier invoices (done)
- **Source:** `approvedInvoiceLines` (`lib/server/finance.ts`): lines of supplier invoices approved or recorded as an expense, the dataset's (with accounting's corrections) and those recorded in Tyll. An invoice still to check does not count (tested).
- **Prices:** `lib/server/ingredient-prices.ts`, `priceTable`: per ingredient the weighted average over the last 90 days (quantity times price, over quantity), the last invoice price with its date and supplier, the contract price (preferred catalogue line), and any override. `/api/ingredient-prices`.
- **Explained override:** new record changes `price.override` (price and reason, the reason required) and `price.clear` (the invoice price applies again), run by the same rules in the browser and on the server, permission `stock.editPrices`, each saved with person, role and time. The older `price.set` stays for existing callers and tests.
- **Screens:** Recipes and costs: recipe costs use the override, else the invoice average; the recipes panel and the ingredient list say "Valued at weighted average cost from supplier invoices"; each ingredient shows Average from invoices, Last invoice (with date), Contract, the price used, and an override line with who, when and why plus "Use the invoice price". Stock levels: the value column and the Stock on hand figure carry the same sentence when the hotel values at weighted average cost.
- **Tests:** 4 more (weighted average arithmetic, only approved invoices, override with reason and who, taking it back, the label).

### 6. Expiry with action (done)
- **Switched on:** `expiry: true` in `lib/features.ts`. Expiring soon is back as a tab of Stock levels, with its alert and the daily bell notice.
- **Use-by dates:** received date plus the item's shelf life; a date typed on receiving that differs is kept as the label's (`useBy: "label"`). The receiving form now fills the use-by date from the shelf life and says "Change it only if the label differs"; only a changed date is sent. Each batch says where its date comes from ("From the label" or "Received plus 3 days shelf life").
- **Actions:** on every batch at risk (Use today and the table): **Make it tonight's special** (at Mercado), **Move to another outlet** (choose one), **Log as waste** (writes a shared waste entry, reason Expired). Saved once per batch with person, role and time (`decideExpiry`, `expiryDecisions` in the store); the batch then shows the decision and who made it and leaves "at risk", so its alert clears. The chef and the outlet's restaurant manager get a bell notice ("Tonight's special at Mercado: use 5.8 kg of Sea bass fillet"); the person who decided is not notified of their own decision. Specials and moves: roles that plan prep (chef, restaurant manager, F&B director); waste: roles that log waste.
- **Demo story:** `ensureExpiryStory` plants one ordinary record when the demo is opened: 14 kg of sea bass delivered this morning for an event lunch for 70 that was cancelled, now in the main store; the supplier's label says use by tomorrow, sooner than the usual 3 days. Normal use leaves about 5.8 kg, so Tyll suggests a special. The stock estimate restarts at each count, so the receipt is dated today (a receipt two days back was already inside the last count).
- **Decision:** a special is for a restaurant, so the suggested dish now prefers the main restaurant's menu (Fish and chips at Mercado), not the conference buffet.
- **Tests:** 7 more (switch on, use-by from shelf life and from the label, the story at risk with a special, the special saved once with the right people told, the reverse notice, waste with reason Expired).
- **Checked in the browser:** Expiring soon, Use today: Sea bass fillet, use by tomorrow, 13.1 kg left, €406, "Use 5.83 kg in a special"; Make it tonight's special: "Tonight's special, 5.83 kg at Mercado ... Marco Bellini", At risk 1 to 0.

### 7. Stock count variance review before approval (done)
- **Existed:** stock takes with system against counted by group and item, approval by a manager who did not count, month-end report (`lib/server/stocktake.ts`, `/stock?tab=takes`). Nothing was waiting.
- **Review:** each difference now has a likely reason by fixed rules (`lib/domain/count-review.ts`): within counting error; more than the system (a delivery not recorded, or stock sent back); a delivery that came short this week; drinks (compare with Over pouring); fresh items (waste not logged, or portions above the recipe); otherwise used without a record. Labelled "Likely reason, to check"; never about a person. Large differences (€50 or more, or 15% of the expected figure when worth €15) are highlighted and badged "Large". The table reads Expected, Counted, Difference, Value, Likely reason. The approval panel ("Review, then approve") now sits after the review and says how many large differences to check first.
- **Seeded:** `ensureStockTakeStory` plants a partial stock take of the main store (walk in fridge, dry store, cellar, bar store), counted this morning by the storekeeper and purchasing and submitted; planted differences: lamb rack −1.8 kg, salmon −1.2 kg, vodka −1.5 L, house wine −2.25 L, cheddar +0.6 kg, flour −0.2 kg. The F&B director, the general manager and the head chef get a bell notice. Purchasing counted it, so purchasing cannot approve it. Demo reset of stock clears it so it is planted again.
- **Tests:** 4 more (waiting take with six differences, reasons and large flags, the rules, counters cannot approve and approval moves stock).
- **Checked in the browser:** as the F&B Director, ST-LIS-0001: lamb rack −€99, vodka −€67 and house wine −€60 marked Large with their reasons; salmon −€39 "Fresh item".

### 8. Meal with no drink (done)
- **Reused:** the overnight work's bill facts (`billFacts`, `noDrink` in `lib/domain/waiters.ts`: food billed, no drink, breakfast buffet excluded because it includes coffee and juice) and the outlet's drink spend per guest.
- **Rule:** `MEAL_NO_DRINK` and `mealWithNoDrink`: a food bill for **2 or more guests** with no drink billed. One guest eating alone is left out.
- **What Tyll checks:** the rule is listed, pinned second after room charges (both asked for by the hotel), with "N in the last 7 days, about €X possible", linking to a new panel on Flagged transactions.
- **Panel "Meal with no drink":** badge "Upsell opportunity"; the last 7 days' tables: when, outlet and table, guests, food billed, food value, possible drink sale. The possible sale is what guests at that outlet and shift usually spend on drinks (an estimate). Not a flag, not money lost, and not counted in Value at risk.
- **Privacy:** no waiter or till login is named or sent (tested: no staff id in the answer); coaching by person stays on Drinks per guest by waiter, for the managers allowed to see names. Roles without Revenue checks (chef, purchasing) are refused on the server.
- **Cases:** the simulated sales already hold about one such table a day at Mercado; the 7 day window shows them. Planting extra bills would have moved every revenue figure the earlier work reconciled, so none were added.
- **Tests:** 3 more.
