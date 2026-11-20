# Overnight build log

Branch `feature/overnight-checks`, started from `feature/visit-tracking` (1fdbe6d), which holds all earlier work (purchasing, audit fixes, visit tracking). The brief is in `OVERNIGHT_BRIEF.md`.

## How to work in this repo (for any session picking this up)

- Node: `export PATH=~/.local/share/node-lts/bin:$PATH; unset PORT FORCE_COLOR`
- Checks: `node node_modules/typescript/bin/tsc --noEmit -p .`, `node node_modules/eslint/bin/eslint.js src` (0 errors; 2 old warnings in `domain.test.ts`), `node node_modules/vitest/vitest.mjs run`, build `node node_modules/next/dist/bin/next build` (the first run stops on Next.js's known-vulnerability check; run it again and it succeeds).
- App: the preview server `tyll-platform` serves the last build on http://localhost:3210 (`next start`). After a build, restart it so it serves the new code.
- Screenshots: `node scripts/screenshot.mjs <path> overnight-screenshots/<feature>-desktop.png --width 1440 --role u-fnb`, phone with `--width 375`, Arabic with `--lang ar`. Uses the Chrome installed on this Mac.

## Decisions

- **Screenshots without Playwright:** Playwright is not installed and downloading its browser is not allowed here, so `scripts/screenshot.mjs` drives the installed Chrome through its debugging protocol. Same result: full-page PNGs at 1440 and 375 wide, in any role or language.

- **Screenshots in Arabic (feature 1):** `scripts/screenshot.mjs` captured beyond the viewport, which shifted right to left pages sideways (the background wave reaches past the left edge), so every Arabic shot looked clipped. It now sizes the viewport to the page and captures that, and prints `missing` (untranslated text from `window.__tyllMissing`) for any language other than English.

- **Learn the demo first (feature 0):** this summary was put together from five read-only passes over the code (pages, flags, data, access, UI). Line numbers are as of commit aae77a3 and will drift.

## What the demo is made of

### Page pattern
- Every page: `PageHeader` (src/components/ui.tsx) with `title`, `question` (the manager question, shown as the subtitle) and `lead` (one line, usually ending "Simulated data."). Example: src/app/drinks/page.tsx.
- KPI tiles: `SummaryBar` (ui.tsx) with `items: StripItem[]` ({label, value, tone "pos"|"warn"|"neg"|"money", note, compare {text, good}, href, onClick}), plus optional `trend` (a `StripTrend`, 340px on lg) and `action` (a `linkButton("primary")`). Example: src/app/money/page.tsx.
- Chart card with the "Open" larger view: `StripTrend` (src/components/charts.tsx) {title, points: {date, value, predicted?}[], format, summary (screen reader), note, series (extra lines, same `axis` key shares a chart), explain, goodWhen}. "Open" opens the internal `TrendExplorer` drawer. Other charts (no Open view): `TrendChart`, `AreaTrend`, `ColumnChart`, `BarList` (rows {key, label, sub, value, onClick}, tone "ink"|"warn"), `Spark`. Recharts is forced left to right in Arabic.
- "Show all N": `Section` in src/components/disclosure.tsx {id (open state remembered as "section.<id>"), title, summary, forceOpen, defaultOpen, flush (tables)}. Inline "top 5, then Show all" toggle with `textLink`: src/components/finance/finance.tsx:120 and stock/suppliers.tsx:131. "Show all {0} ..." strings already exist in messages.json.
- Tabs: `Tabs` (in page, stateful), `useSection(base, valid, fallback)` in src/components/module-hub.tsx (reads and writes `?tab=`), `PageTabs` (separate pages), `Segmented` (pill toggle, use for 7 or 30 days). Other blocks: `Panel`, `Badge` (tone neutral|pos|warn|neg|ink|accent), `Note`, `TableWrap`/`Th`/`Td`/`useSort`, `EmptyState`, `Drawer`, `linkButton`, `textLink`. All links use `prefetch={false}`.
- Navigation: src/lib/nav.ts. Sections stock (5 items, at cap), purchasing (6, at cap), revenue (3: Revenue `/money` also `/money?tab=outlets`; Flagged transactions `/money?tab=flags` also mistakes, cash; Reports). A new page plugs in as a tab added to an item's `also` (or the `SUB` map for a sub path), never a new item. Caps tested in src/lib/__tests__/reorganise.test.ts. `/money?tab=rooms`, `orders` and `tips` are sub pages of /money with no nav entry of their own.

### Flags system (and how to add a flag type)
- Types: `ExceptionType` union (src/lib/types.ts, 12 types: removed_after_dispatch, prepared_not_charged, bill_mismatch, unusual_discount, excessive_comp, unusual_refund, unexplained_void, room_charge_missing/duplicate/incorrect, stock_shortfall, usage_variance). `Exception` carries exposure (euros), headline, comparedWith, basis, orderId, chargeId, period.
- Rules: src/lib/domain/detect.ts holds `POLICY` thresholds, `TYPE_LABEL` (Record, so tsc forces a label per type), `REMOVAL_TYPES`, `ROOM_TYPES`, `detectOrderException` (one flag per order, order: void, removal, refund, discount, comp), `detectRoomChargeException`, `detectExceptions`, `detectPatterns`.
- Built in `getDataset()` (src/lib/data/generate.ts): `detectExceptions` plus `varianceExceptions`; each gets a state from `seedInvestigation`. Session cases (stock_shortfall, usage_variance) come from `stockCases` in src/lib/store.ts.
- Public demo trims cases in `demoCases()` (src/lib/data/demo-cases.ts, called from src/lib/server/snapshot.ts): hero case, all usage_variance, 3 largest other open per hotel, 12 newest closed per hotel. Staff and purchasing roles get no exceptions.
- Where flags show: /money?tab=flags `Mistakes()` (worked example Section "flags.example" linking to `/investigations/${HERO_EXCEPTION_ID}`, "Flagged by type" BarList, "Flags per 1,000 orders" via `adjustmentRate()` on `computeTotals` in src/lib/domain/metrics.ts, "What Tyll checks" hard-coded `<ul>` built from `POLICY`, "Repeated patterns", "Flagged orders" top 8). Money Back List: src/app/investigations/page.tsx (type filter from `TYPE_LABEL` plus "room"). Case page: src/app/investigations/[id]/page.tsx with `explain()` (src/lib/domain/explain.ts, one branch per type). Alerts and Home "Needs you today" (src/components/home/home.tsx, `topAlerts`) come from `buildIssues` (src/lib/domain/issues.ts) through `AlertFeedProvider` (src/lib/alert-feed.tsx): every open case becomes an issue ranked by exposure (`ISSUE_RULES` 75 / 15 EUR), so new types arrive there with no extra work.
- Room charge types are left out of the Mistakes list, byType, "New this week" and per 1,000 orders (money/page.tsx `ROOM_TYPES` filters, metrics.ts `startsWith("room_charge")`), but are in Open flags, Value at risk, Alerts, the Money Back List and the home ledger. Any new type must make the same choice in all of these places so totals reconcile.
- **To add a flag type:** (1) add it to `ExceptionType`; (2) in detect.ts add `TYPE_LABEL`, a `POLICY` threshold and a pure detector, called from `detectExceptions` or pushed in `getDataset`; (3) give every case a `seedInvestigations[id]` entry (`computeTotals` reads `st.status` unguarded and crashes otherwise); (4) set `outletId` (or `propertyId` for whole hotel cases) so scoping works; (5) make sure the story case survives `demoCases` (add to `keep`); (6) decide the room or not room treatment consistently (room checks use the `room_charge_` prefix and join `ROOM_TYPES`); (7) add an `<li>` to "What Tyll checks"; (8) add a branch in explain.ts; (9) translate label, headline and comparedWith; (10) detector tests in src/lib/__tests__/domain.test.ts including cases that must not flag.

### Data story
- One property `lis`, Grand Hotel Lumière, Lisbon, EUR, 250 rooms (src/lib/data/catalog.ts). Outlets: Mercado `lis-terrace` MER (all day dining, 86 base orders, 35% to room, the only reservable outlet), Bar Azulejo `lis-lobby` AZU (lobby bar, 74, 25%), Banquets and Events `lis-banquets` BQT (14, 5%), In-Room Dining `lis-ird` IRD (28, 94%, tables are "Room N").
- `getDataset()` is deterministic and cached (`rng(seed)` in util.ts). Business date `DEMO_TODAY` (env TYLL_DEMO_DATE, then cookie, else today in the demo time zone; 2026-11-19 for this build), `DEMO_NOW_MIN` 20:55, 60 days of history (`DATA_START = rel(-59)`).
- Story: Mercado drifts over the last 21 days (more removals, comps, discounts, refunds, voids), removals cluster under MER-S2 and MER-S4 in the evening. Worked examples in src/lib/data/constants.ts: `HERO_ORDER_ID` (a Coke removed after it was sent), `HERO_INVOICE_ID` (4 kg tenderloin short but invoiced in full), Mercearia Lusa invoiced 180 EUR above delivered.
- Staff: `${code}-S1..S9` per outlet (S1 to S4 servers, S5 bartender, S6 supervisor, S7 manager, S8 chef, S9 steward). One waiter per bill (`Order.staffId`). Simulated rota in src/lib/domain/rota.ts.
- Orders: `Order` {id `${code}-MMDD-seq`, outletId, date, openMin, closeMin, covers (about lines/2.2), staffId, table, lines, discountPct, refund, voided, payment card|cash|room, room}. `OrderLine` {itemId, qty, unitPrice, state kept|removed_pre|removed_post|comped, entered/sent/completed/removed minutes, removedBy, reason, approvedBy}. Totals in src/lib/domain/orders.ts. No bill reopen, misc item or price override events exist yet (needed for feature 5).
- Room charges: `RoomCharge` {id, propertyId, outletId, date, min, room, source restaurant|room_service|minibar|spa|laundry, orderId, expected, posted: number[]} from `buildRoomCharges`; checks only missing, duplicate and wrong amount. No folio entity, no checkout times, no rate plans or breakfast included flag (needed for features 1 and 7). Rooms have status "departure_due".
- Occupancy: `OccupancyDay {occupancy 0..1}` from DATA_START to today+7; guests are derived only in src/lib/server/purchasing.ts `occupancyAhead` as 1.6 x rooms x occupancy (the brief's 304 to 366 guests a night). Reservations: `ReservationDay` aggregate covers per day, Mercado only, no per booking records. One hotel event EV-1 (180 guests); editable events in `loadStore().events`.
- Deliveries: `Delivery` with lines {ingredientId, ordered, delivered, invoiced, poPrice, invoicePrice}, invoice embedded in the line, last 30 days. Recipes on `MenuItem.recipe`; sales roll up into `DayItem`/`DayOutlet`. Waste: `WasteLog`. Pour: src/lib/domain/pour.ts `pourLog` (glasses sold from POS, bottles opened simulated through pour factors; Bar Azulejo heavy), server view src/lib/server/pour.ts.

### Adapters
- src/lib/adapters.ts: interfaces `PosAdapter.fetchOrders`, `PmsAdapter.fetchRoomCharges`/`fetchOccupancy`, `ReservationsAdapter.fetchCovers`, `InventoryAdapter.fetchDeliveries`/`fetchCounts`/`fetchWaste`, `AccountingAdapter.fetchPostedLabor` (null). `DATA_SOURCES` drives Settings > Data sources with `ConnectionState` simulated | not_connected | planned.
- src/lib/server/adapters.ts: `simulatedPos`, `simulatedPms`, `simulatedReservations`, `simulatedInventory`, `unconnectedAccounting`, each filtering `getDataset()`.

### Roles and access
- src/lib/domain/access.ts: `MODULES` (pages per role) and `PERMISSIONS` (actions per role); a new permission means editing the `Permission` union and the per role arrays. Helpers `canOpen`, `can`, `homePath`, `allowedOutlets`, `canSeeOutlet`, `assertCan`.
- Server: `guard(req, {module?, permission?})` in src/lib/server/guard.ts (401 no session, 403 not allowed), `sameOrigin(req)` on POST. Many routes call `guard(req, {})` and check `can()` plus outlet scope in the domain function (example src/lib/server/stock-log.ts). Pages: src/proxy.ts sends a role that cannot open a page to its `homePath`.
- Public demo (TYLL_PUBLIC_DEMO=on): roles u-buy purchasing, u-fnb fnb_director, u-chef chef, u-fc controller, plus fallback u-gm, u-emp. `RoleSwitcher` (src/components/shell/app-shell.tsx) POSTs /api/auth/demo, then signs out, clears the dataset and reloads. Sessions in `.data/auth.json`.
- Privacy precedent: over pouring names people only when `canOpen(user,"investigations") && role !== "employee"` (src/lib/server/pour.ts); otherwise the server strips names. Client shows roles first and names behind "Show who was on" with a "not proof" note.

### Server versus browser storage
- Server shared records: one JSON file `.data/purchasing.json` (src/lib/server/purchasing-store.ts). `loadStore()` seeds, migrates on `DATA_VERSION`, moves dates to DEMO_TODAY; `mutateStore(fn)` writes atomically; `nextNumber` for ids. A new section needs an optional `Shape` field, backfill in `loadStore`, a seed in `empty()` and a case in `resetDemo` (src/lib/server/demo.ts, POST /api/demo/reset, owner or gm only; `freshenPublicDemo()` resets "all" at most hourly). All visitors share this one file.
- Browser only: zustand persist "tyll-demo-v1" in src/lib/store.ts (investigations, stockCases, recounts, recipeChanges, receiptCorrections, priceOverrides, approvals, dismissedAlerts, forecastInputs, roomState, audit and more). Only waste, counts and waste corrections sync to the server (src/lib/shared-stock.ts, every 30 s to /api/stock/waste and /api/stock/counts, read back from /api/stock/shared). Settings and the Data sources note still say decisions and price changes stay in this browser (feature 8 must change that text).

### Translations
- Text matching, not keys: screens are written in English; src/lib/i18n/dom.ts (MutationObserver) rewrites text nodes and placeholder, aria-label, title using src/lib/i18n/messages.json (English template to [de, it, ar], numbers, money, dates and codes lifted to {0}). Skips `translate="no"`. Add strings with `python3 scripts/i18n-add.py file.txt` (lines `English | Deutsch | Italiano | العربية`). Untranslated lines appear in `window.__tyllMissing`. Test: src/lib/__tests__/translate.test.ts.
- Arabic sets `dir="rtl"`; use logical classes only (ms, me, ps, pe, start, end). The old waste kiosk (src/components/stock/waste-logger.tsx) has its own en/ar table.

### Charts and tokens
- Charts from src/components/charts.tsx only (see Page pattern). Colours from src/app/tokens.css as Tailwind classes: neutrals ink, graphite, steel, fog, mist, cloud, paper, line, hair; accent, accent-ink, accent-soft, money, money-soft (remapped per section by `data-mod`, set from the nav section tone: stock teal, purchasing blue, revenue violet); status pos, warn, neg and -soft; chart-a, chart-b, chart-grid, chart-axis; radius-panel, radius-control; shadow-panel. Dark theme defined in the same file.

### Phone and staff flows
- Staff app: src/components/staff/staff-app.tsx `staffActions(user)` tiles routed by `/staff?do=<id>`, reusing `Screen` and `Big`. Waste: `BreakageFlow` (src/components/shell/breakage.tsx, tap item then tap quantity, undo in the toast) on /waste and in the staff app, saved through POST /api/stock/waste to `stockLog.waste`. Barcode: `CameraScan` in src/components/stock/take-count.tsx (BarcodeDetector, not exported) and catalogue `barcode` lookup in src/lib/server/stocktake.ts.

## Where each feature plugs in

1. **Room charge check:** extend the existing `/money?tab=rooms` (`RoomCharges()` in money/page.tsx) rather than a new page, give it the header question, a matched against mismatched SummaryBar with a StripTrend, and a worked example. Add `room_charge_wrong_room` and `room_charge_after_checkout` with the `room_charge_` prefix into `ROOM_TYPES`; add checkout times to the simulated PMS data. Reach it from Revenue (add `/money?tab=rooms` to an `also` list or a card), keep it away from the housekeeping Rooms module.
2. **Bought against sold:** a new tab next to "Stock takes" and "Missing stock" in the Counts tab group on /stock (`countTabs` in src/app/stock/page.tsx, nav item "missing" `also`). Data from deliveries, recipes x `DayItem` units and waste. BarList of top items by gap; Coca Cola story case. Labelled an estimate a count confirms.
3. **Drinks per guest by waiter:** a sub page of /money (Revenue section), next to outlet performance, because it is a revenue and coaching question built from POS bills. Names follow the src/lib/server/pour.ts rule on the server. Coach action and a "food but no drink" drill down per waiter.
4. **Empty bottle scan:** a staff app tile in `staffActions` plus a card next to `BreakageFlow` on /waste; saved through a new guarded route into a new `loadStore` section; src/lib/server/pour.ts prefers scanned bottles, simulated fallback stays labelled on /drinks.
5. **Till rule flags:** new `ExceptionType`s and detectors in detect.ts, new simulated POS events on orders (reopen after payment, misc or open price, override, duplicate ring) in generate.ts, an `<li>` each in "What Tyll checks", explain.ts branches, tests. They are not room types, so they count in per 1,000 orders and byType.
6. **Booked against billed covers:** a section on /money?tab=outlets near outlet performance, using `ReservationDay` (Mercado) and `DayOutlet` covers per service; ColumnChart or StripTrend per service.
7. **Hotel guests against outlet charges:** next to the room charge check in Revenue (a section or sub tab on `/money?tab=rooms`), using occupancy and guests (1.6 per room) with a simulated breakfast included rate share so included guests are not flagged.
8. **Save everything to the server:** extend `SharedStockSync` and the shared records store to investigation decisions and price changes, each record carrying user id and role; handle `resetDemo`, and update the Settings and Data sources text.
9. **POS and PMS adapters:** new files under src/lib/server/adapters/ implementing `PosAdapter` and `PmsAdapter` from recorded JSON fixtures, a new `ConnectionState` for "Adapter built, not yet connected to a live account" in `DATA_SOURCES`, tests on the fixtures. Simulated adapters stay the default.

## Progress

| # | Feature | Status | Notes |
|---|---|---|---|
| 0 | Learn the demo | done | Summary above, under "What the demo is made of" |
| 1 | Room charge check | DONE | `/money?tab=rooms` (F&B Director u-fnb, also gm, fc, owner, restaurant manager for own outlets; worked example opens with `&open=example`). Story: last night's Mercado dinner for 3, signed to room 1412, posted to room 1421; 1412 checked out this morning. Case `EX-RC-MER-<yesterday MMDD>-299`. Screenshots `overnight-screenshots/01-room-charges-*.png`. |
| 2 | Bought against sold, per item | to do | |
| 3 | Drinks per guest by waiter | to do | |
| 4 | Empty bottle scan | to do | |
| 5 | Till rule flags | to do | |
| 6 | Booked against billed covers | to do | |
| 7 | Hotel guests against outlet charges | to do | |
| 8 | Save everything to the server | to do | |
| 9 | First real POS and PMS adapters | to do | |

## Feature 1: Room charge check (done)

**Where:** Revenue and reconciliation > Flagged transactions > "Room charge check" row (`/money?tab=rooms`, now in the flags item's `also`, so the sidebar lights Flagged transactions). Roles: owner, gm, controller, fnb_director, restaurant_manager (own outlets only, no hotel wide minibar, spa, laundry). Chef, purchasing, staff and departments are sent to their home page by the proxy, and the API refuses them (403).

**What it does:** PageHeader question "Did every room charge reach the guest's bill?"; period toggle; SummaryBar (charges checked, posted correctly %, not matched with money involved, open to check = open room flags, same as the Money Back List) with a 30 day StripTrend (value not matched per day, plus count and checked lines in the Open view); a closed "Worked example" Section like the Coke one; "Why charges did not match" BarList by reason; "What Tyll checks" for room charges; "Charges to check" (open first, largest first, top 5, then "Show all N charges"; each row ends in Review or View on its case; phones get one card per charge); a closed "By source" Section with the per source table and the counted once note.

**Rules (src/lib/domain/detect.ts):** `classifyRoomCharge` checks in a fixed order, the first that applies wins, so one charge raises one flag: missing, wrong room (`folioRoom` differs), after check-out (`postedMin > checkoutMin`, only when both are known), posted twice, different amount (beyond `POLICY.roomChargeTolerance`). `detectRoomChargeException` builds the flag from it. New flag types `room_charge_wrong_room` and `room_charge_after_checkout` (in `ROOM_TYPES`, `TYPE_LABEL`, explain.ts branches, ChargeEvidence shows the folio room, posting time and check-out). Totals and charts come from `src/lib/domain/room-charges.ts` (summary, by day, by source), which reuses the same rule, so the check and the flags agree to the cent.

**Data (src/lib/data/generate.ts):** `RoomCharge` gained `folioRoom`, `postedMin` and `checkoutMin` (the PMS side), drawn by `withFolio` from its own random stream so earlier postings are unchanged. Wrong room: about 1 in 400 outlet till charges (one key off). After check-out: about 3% of minibar charges (found when servicing a departure room) and a few breakfast postings held in the interface queue. Story order `MER-<yesterday>-299` (`roomStoryOrder`, mezze, lamb chops, risotto, fondant, sparkling water, no Coke, wagyu or wine so the stock stories are untouched).

**Server and API:** `src/lib/server/room-charges.ts` `roomCheckFor(user, {from, to, outlets, whole})` and `GET /api/money/rooms` behind `guard({ module: "money", permission: "roomcharge.view" })`. New permission `roomcharge.view` in the matrix; the snapshot now sends room charges (room numbers, check-out times) only to roles with it.

**Decisions and why:**
- Extended the existing `/money?tab=rooms` sub page and `detectRoomChargeException` rather than building a second system; the page sits beside "Cash on hand against cash sales" because both are reconciliation checks reached from Flagged transactions. No new menu item. The Reports link to room charges was removed, because CLAUDE.md says Reports lists only records with no place in the sidebar and the page now has one.
- No new user input: the actions are the existing case actions (review, assign, record the outcome), so nothing new needed saving. Investigation decisions are still browser held; feature 8 moves them to the server.
- Server computed check (like the cash check) so the guest data and the scope rules are enforced on the server; the flags still come from the snapshot, and both read the same rule.
- Room charge flags now count everywhere a flag counts: Flagged by type, Flagged orders, New this week, and Flags per 1,000 orders when they belong to an outlet bill (`orderId`); minibar, spa and laundry have no order to count against. Before, room types were left out of these lists, so the open count and the by type list did not add up. "Flagged by type" now shows the five largest with "Show all N types".
- Seeds: room charge differences are closed after the night audit (any case from before today), except the story, which survived it because nothing failed. Closing notes match the kind (moved to the right room, charged to the card on file as a late charge).
- Public demo (`demoCases`): keeps every open room charge case (the check lists each one, so each needs a case to review) and the story, then up to three other large open cases while the hotel stays within twelve open (the existing test caps it at 12). On 20 Nov: 12 open, 5 of them room charges, EUR 309 of EUR 572.

**Checks:** tsc clean; eslint 0 errors (2 known warnings); vitest 26 files, 270 tests passed (14 new in `src/lib/__tests__/room-charges.test.ts`: rules and must not flag cases, order of checks, reconciliation of check against flags and by day and by source, story, demo keep rule, night audit seeds, server permission and scope, outlet selector, sidebar); build passed on the second run as expected.

**Known, not part of this feature:** several older screens still have English text in Arabic (sidebar "Flagged transactions", "Predict", the case page's "Manage this case" panel, the cash page). The flags page lead still says "Voids, refunds, discounts and items removed from bills"; it could mention room charges.

**Next:** feature 2, Bought against sold, per item.
