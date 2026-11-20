# Radisson feedback build: report

Branch `feature/radisson-feedback` (from `feature/simplify-demo`). Nothing was pushed or deployed, and no real system or supplier was contacted. Working notes, with file names, are in `RADISSON_LOG.md`.

## What already existed

The earlier work already had most of the foundations:
- the approval chain (purchasing, accounting, F&B director, general manager) and a send-once rule;
- automatic ordering at 06:00, delivery history, one tap Received and supplier reliability;
- stock takes with approval;
- stock valuation at weighted average, FIFO or last price;
- an Expiring soon page (switched off);
- Lightspeed and Mews adapters on sample responses;
- the tables with food and no drink, as a coaching page.

Missing were:
- **sending:** no sending, failed or retry states;
- **Simphony:** no adapter and no menu sync;
- **Order now:** no button where stock runs low;
- **prices:** ingredient prices were typed by hand rather than taken from invoices;
- **expiry:** no way to act on what expires;
- **stock takes:** none waiting for approval;
- **"Meal with no drink":** no rule.

## Scores

| Criterion | Before | After |
|---|---|---|
| Automatic purchasing | 6 | 9 |
| Simphony fit | 3 | 7 |
| Menu changes | 2 | 8 |
| Valuation | 6 | 9 |
| Expiry | 3 | 8 |
| Stock counts | 7 | 9 |
| Trust | 8 | 9 |
| Speed and reliability | 8 | 9 |
| Clarity | 9 | 9 |
| Polish | 9 | 8 |

Polish went down because the screens touched now show their older English leftovers in Arabic (supplier contact lines, some order details). The sentences on the new screens are translated.

## Each Radisson point, and where to see it

| Point | What it does now | Address |
|---|---|---|
| Order now | On critical and low items (Stock levels, the stock alerts, the Overview card). It orders the suggested quantity from the usual supplier, adds it to your open draft for that supplier or starts one, and sends it into the approval chain. You see what will happen first, then a link to the order. Items already on order say "On order". | `/stock?show=low`, `/alerts`, `/` |
| Sending orders | Draft, waiting for approval, approved, sending, sent or failed. A fully approved order goes on its own, by the supplier's channel: email with the PDF, the supplier's ordering system, or phone (recorded by purchasing). Each order has one sending reference, so a retry never orders twice. Douro Cellars' system times out once, then a retry succeeds safely. Mercearia Lusa answers with less chocolate, which purchasing accepts or declines. CSV and JSON export are unchanged. Delivered comes from the goods receipt, which is the same record as Received at goods in. | `/forecast?tab=approvals&request=PR-LIS-0002`, Settings > Purchasing, Suppliers > Edit |
| Simphony | A Simphony adapter behind the same POS interface. It reads sales, menu items and prices, modifiers, voids and discounts from recorded samples. Settings > Data sources shows "Last sync 06:00, demo connection". | `/settings`, `/settings/adapters` |
| Menu sync, new dishes | "Menu synced from Simphony at 06:00: 2 new dishes, 1 price change, 1 dish removed". The new burger price feeds the margins, and Kids pasta is archived. The chef gets an alert that 2 new dishes need a recipe. Each new dish carries a labelled standard cost (30% of price) and a suggested recipe, marked "please check", which the chef confirms on one screen. Modifiers apply too: Double doubles the spirit and No cheese removes it, with last night's example. | `/stock?tab=recipes` |
| Prices from invoices | Each ingredient shows the weighted average of approved invoices over 90 days, the last invoice price and the contract price. A price typed by hand is an override, with who, when and why, and it can be taken back. Recipes and Stock levels say "Valued at weighted average cost from supplier invoices". | `/stock?tab=recipes`, `/stock` |
| Expiry with action | Switched back on. Use-by is the received date plus shelf life, and changes only when the label differs. For stock at risk, three actions: tonight's special, move to another outlet, or log as waste. Each is saved with who, and the chef and restaurant manager are told. Demo case: 14 kg of sea bass from a cancelled lunch, use by tomorrow. | `/stock?tab=expiry` |
| Stock count review | Expected, counted, the difference in units and euros, a likely reason for each, and large differences highlighted, all shown before approval. A stock take counted this morning is waiting; whoever counted cannot approve it. | `/stock?tab=takes&take=ST-LIS-0001` |
| Meal with no drink | A rule in What Tyll checks: food bills for 2 or more guests with no drink. It is shown as an upsell opportunity (the last 7 days' tables and the possible drink sale, an estimate), never as a loss, and never with a waiter's name. | `/money?tab=flags#meal-no-drink` |

## The guided path, and a 10 minute presentation

"Start guided path" on the Overview starts from a fresh copy of the demo, so every story is where it begins, and opens each step as the right person. Six steps:

1. **Predictions** (F&B Director, 2 min). What to order to month end, worked out by Tyll's own model from sales, bookings, events and occupancy, with the reasoning beside each quantity and the deliveries likely to come too late (Wagyu, tomorrow). No AI chooses a quantity.
2. **Critical stock, then Order now** (Head Chef, 1 min). Cheddar and flour are critical but already on this morning's order; Wagyu beef mince is low: **Order now**, 23 kg from Carnes Ribeiro & Filhos, sent for approval.
3. **Approval, sending, the supplier's answer** (Purchasing, 3 min). Open Douro Cellars' order and approve it; **Approve as Priya Raman (demo)** signs accounting. It is sent on its own, the supplier's system times out, **Retry** shows it was not sent twice. On the automatic Mercearia Lusa order, approve and press "Approve as" twice; Mercearia Lusa proposes 18 kg of chocolate instead of 27 kg: **Accept**. No switching person.
4. **Stock count review** (F&B Director, 2 min). Lamb rack, vodka and house wine marked Large, each with a likely reason; approve with a note.
5. **Menu from Simphony** (Head Chef, 1 min). Opens on New dishes: Sea bass with lemon butter, suggested from Grilled salmon; confirm it.
6. **Tonight's special** (Head Chef, 1 min). Sea bass from the cancelled lunch: **Make it tonight's special**; the restaurant manager is told.

The other money stories (drinks not billed, supplier invoices, flagged bills, Meal with no drink) stay one tap from the Overview and Alerts.

## What Radisson asked for in the call, and where it is

| Asked in the call | In the demo now | Where |
|---|---|---|
| Menu changes pulled from the POS, not typed twice | Yes: the morning sync reads Simphony's menu (new dishes, prices, dishes taken off) | Recipes and costs |
| Press "order" on a critical item and a purchase order goes to the supplier | Yes: Order now, approval chain, automatic sending, supplier confirmation | Stock levels, Orders |
| Purchase orders issued from the tool, not only exported | Yes, sent by the supplier's channel (simulated); CSV and JSON export kept for accounting | Orders, Settings > Purchasing |
| Direct connection to accounting software | No: export file only (CSV, JSON, field list) | Orders > Procurement export |
| Stock value from what was paid (first, last, average), not a fixed price | Yes: from approved supplier invoices; method chosen per hotel; hand-set prices are explained overrides | Recipes and costs, Stock levels, Settings > Purchasing |
| Expiry: know what goes off and sell it first (a special) | Yes: batches with use-by dates, tonight's special, move or waste | Expiring soon |
| Stock take with a variance against the system before stock changes | Yes: expected, counted, difference, value, likely reason, approval by someone who did not count | Stock takes |
| Counting with codes or a scanner | Yes: barcode scanner or typing; camera scanning in progress | Count |
| Many people and several outlets updating stock | Yes: roles per outlet, server checks every action; web based, nothing to install | Settings > Roles |
| Flags without waiting for a stock count, such as a meal with no drink | Yes: Meal with no drink and the till rules work from sales alone | Flagged transactions |
| Cash against cash sales | Yes; cards are reconciled by the payment provider | Revenue > Cash |
| Works with Simphony (Materials Control is no longer available) | Demo connection on recorded responses; needs an Oracle sandbox to go live | Settings > Data sources |
| How predictions work, AI or not | Predictions come from Tyll's own model; no AI chooses a quantity, and the screens say so | Ordering |
| A list for the RFP | `docs/feature-checklist.md`, updated with every point above and an honest status | |

One thing to correct in the follow-up: in the call the product was described as a desktop application. The demo is web based (any browser, laptop, tablet or phone, nothing to install), which is what Radisson's IT lead said suits a hotel with several outlets.

## Bugs, with timings

- **Slow load and duplicate requests.**
  - The 15 s and the 502/503 errors could not be reproduced locally; the likely causes are the hosting cold start and the number of calls.
  - Fixed:
    - pages asked twice for the plan and the orders; they now ask once;
    - the simulated data is now built when the server starts, not on the first visit.
  - Before: 9 to 12 calls a page, with the plan requested twice on every page. After: 7 to 12 calls, **0 duplicates**, pages ready in **0.12 to 0.23 s** (first page after a restart: 0.11 s).
- **Orders opening empty.** The Financial Controller opened on an empty "Waiting for accounting" list. Orders now opens on All when your own step is empty, and on your step when something is waiting. A test covers it.
- **Deep links** such as `?request=PR-LIS-0008` already opened directly. This was checked again and timed at 0.12 s.

## Decisions

- **Plants:** the demo cases are planted as ordinary records when the demo opens, as the late delivery story was:
  - the cancelled-lunch sea bass;
  - the stock take waiting for approval.

  Changing the generated sales would have moved every reconciled figure.
- **Automatic sending:** it runs after the last approval, outside the approval rule itself, so the existing tests for sending by hand still hold. It can be switched off in Settings > Purchasing.
- **Automatic orders:** they carry the F&B director's name as the keeper of the rule. The rule raised them, so the F&B director may approve one; one step per person still applies.
- **Price overrides:** these are a new record type that requires a reason. The old price change stays, for compatibility.
- **Specials:** a special belongs in a restaurant, so suggestions prefer Mercado's own dishes.
- **Meal with no drink:** it uses the last 7 days; the data holds about one such table a day.
- **Expiring soon:** it is hidden from roles that cannot see batches (the Financial Controller).

## What is simulated, and what real connections need

- **Simulated:**
  - Simphony replays two recorded responses, the menu and one night of checks.
  - Supplier email is logged with its PDF, never sent.
  - The supplier ordering systems and their answers are simulated.
  - Phone orders are recorded by hand.
- **For real Simphony:**
  - an Oracle Simphony account with API access for the hotel's organisation and location;
  - confirmation of the field names against a sandbox;
  - mapping of menu item numbers to Tyll dishes, and condiments to modifier rules;
  - a scheduled job at 06:00 in place of the "on first read" sync.
- **For real suppliers:**
  - an email provider, for PDF orders;
  - each supplier's ordering API or EDI for push orders, carrying our sending reference so retries stay safe;
  - a way to receive their confirmations (an inbound mailbox or the API).

## Not finished

- **Translations:** some older order and supplier screens still show English names and terms in Arabic.
- **Phone layout:** wide tables scroll sideways on a phone.
- **Menu sync:** only Mercado is synced.
- **Modifiers:** they apply to the Simphony checks, not yet to the rest of the simulated sales.
- **Older figures:** Revenue and Menu performance still use the list price curve for costs.

## How to run it

```bash
export PATH=~/.local/share/node-lts/bin:$PATH; unset PORT FORCE_COLOR
node node_modules/next/dist/bin/next build   # run twice if the first stops on the known SecurityFatalError
node node_modules/next/dist/bin/next start -p 3220
```
