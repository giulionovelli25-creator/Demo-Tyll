# Simplify, merge and polish: report

Branch `feature/simplify-demo`. Nothing was pushed or deployed. The full working notes are in `SIMPLIFY_LOG.md`.

## Before and after scores

| # | Criterion | Before | After | One line |
|---|---|---|---|---|
| 1 | 5 second clarity | 6 | 9 | Every page has a plain question; Purchasing went from 6 items to 4. Stock levels and Over pouring are still long. |
| 2 | Story | 5 | 9 | The guided path now ends on money recovered and supplier invoices, not on "Coming soon". |
| 3 | Calm | 6 | 8 | Five cases first, one tab row, four Overview cards; Over pouring still has eight sections. |
| 4 | Trust | 5 | 9 | No Preview screens, no profit estimate on the first screen, every repeated figure matches. |
| 5 | Action | 7 | 9 | Each Overview card says what to do ("2 to order today", "€564 to query"). |
| 6 | Consistency | 6 | 9 | One name and one address per thing. The staff phone app and the tours are still English only. |
| 7 | Roles | 7 | 9 | Each role sees only its pages; 24 of 24 role switch checks passed. |
| 8 | Mobile | 8 | 9 | Staff actions stay two taps; tab rows scroll sideways on a phone. |
| 9 | Polish | 7 | 9 | Arabic checked on the five main pages with nothing left in English. |
| 10 | Reliability | 7 | 9 | 0 console errors, 0 dead links, 0 broken redirects; 538 tests pass; build passes. |

## What was hidden, and how to switch it back on

Everything is in one file, `src/lib/features.ts`. Change `false` to `true` and rebuild.

| Hidden | Setting |
|---|---|
| Tyll Flow (live kitchen tickets) | `flow` |
| Rooms and guest experience, and the front office, housekeeping, concierge and bell captain roles | `rooms` |
| Preview screens: Events and staffing, Sales and performance, Tips (and the sales and events roles) | `previews` |
| Expiring soon (batch use-by tracking) | `expiry` |
| Other tools page | `otherTools` |
| The Overview Revenue card with estimated profit | `overviewRevenue` |

Old addresses of hidden pages lead to the Overview (or to Stock or Revenue for the hidden tabs), so no saved link breaks.

## What was merged

| Before | Now |
|---|---|
| Flagged transactions and the Money Back List (`/investigations`) | One page, Flagged transactions (`/money?tab=flags`): the cases with owner, deadline, outcome and money recovered, then the rules |
| To order, Automatic ordering, Predictions (three menu items) | One item, **Ordering** (`/forecast`), with tabs |
| Deliveries and invoices at `/stock?tab=suppliers` and `/finance?tab=invoices` | One address, `/deliveries` (invoices at `/deliveries?tab=invoices`) |
| Room charges hard to find | The room charge rule always shows in "What Tyll checks", and room charge cases sit in the cases list |

## Overview and guided path

- **Overview cards:**
  - **Stock levels:** "2 to order today".
  - **Drinks not billed:** an estimate.
  - **Orders:** "N to approve", or who the orders are waiting on.
  - **Supplier invoices:** "€564 to query", invoiced for goods not delivered.
  - The revenue card with estimated profit is switched off.
- **Guided path:** five steps, all as the F&B Director, each landing on a page where the point is visible without scrolling:
  1. Money found
  2. Ordering
  3. Over pouring
  4. Flagged transactions
  5. Deliveries and invoices

## Bugs fixed

- **Two different "todays".** The date could disagree between labels and charts (19 against 20 November). The server now writes its business date into every page, and the browser uses that.
- **Errors on Stock.** Purchasing and the Head Chef got an error behind the scenes every time they opened Stock.
- **Contradictory figures.** "1 order waiting" on the Overview against "3" on Orders. A second "at risk" figure on Revenue. An amount to query that still counted invoices the supplier had already credited.
- **Wrong Back button.** Deliveries and invoices offered "Back to Other tools".
- **Internal codes in lists.** Codes like PR-LIS-0008 showed in lists; they now appear only on detail pages.

## Navigation now

- Log waste
- Overview
- Alerts
- **Stock and waste:**
  - Stock levels
  - Waste and breakage
  - Stock takes and missing stock
  - Over pouring
- **Purchasing:**
  - Ordering
  - Orders
  - Suppliers
  - Deliveries and invoices
- **Revenue and reconciliation:**
  - Revenue
  - Flagged transactions
  - Reports
- **Settings and help:**
  - Settings
  - Help and tour

## What could not reach 10, and why

- **Stock levels and Over pouring are still long.** Shortening them means redesigning working features, which this pass ruled out.
- **Trust.** All data is simulated. Money lost is €10,912, above the story's target of about €10,000; changing that means re-tuning the simulated data.
- **The staff phone app and the tours are still English.** Translating them is a separate piece of work.
- **The demo server keeps its date until it restarts.** A demo that runs overnight needs a daily restart.

## How to run it

```bash
export PATH=~/.local/share/node-lts/bin:$PATH; unset PORT FORCE_COLOR
node node_modules/next/dist/bin/next build   # run twice if the first stops on the known SecurityFatalError
node node_modules/next/dist/bin/next start -p 3220
```
