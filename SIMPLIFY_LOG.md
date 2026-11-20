# Simplify, merge and polish: log

Branch `feature/simplify-demo`, from `feature/late-delivery-prediction` (the most recent feature branch, itself on the finished `feature/overnight-checks`). Nothing is pushed to main or deployed. Every hidden part stays in the code behind one switch file, `src/lib/features.ts`.

## How the "before" was measured

- **Screenshots:** 46 addresses × 3 roles (F&B Director `u-fnb`, Purchasing Manager `u-buy`, Head Chef `u-chef`) × 2 widths (1440 and 375): 276 screenshots in `simplify-screenshots/before/`, taken on the unchanged build before any edit was built. Playwright is not installed here; `scripts/screenshot.mjs` drives the installed Chrome, as on the earlier branches.
- **Crawl:** the same 46 addresses as each of the three roles, recording the final address, the page text, every link and button, console errors and failed requests (a headless Chrome script, kept outside the repo).

## 2. The demo before this pass

### Navigation tree (sidebar, public demo)

- Log waste (button, opens the logging sheet)
- Overview `/`
- Alerts `/alerts`
- **Stock and waste**
  - Stock levels `/stock` (Stock / Analysis switch)
  - Expiring soon `/stock?tab=expiry`
  - Waste and breakage `/waste`
  - Stock takes and missing stock `/stock?tab=takes`, with tabs Missing stock `?tab=where`, Bought against used `?tab=bought`, Count records `?tab=counts`
  - Over pouring `/drinks`
- **Purchasing** (6 items)
  - To order `/forecast?tab=toorder`, tab Par levels `?tab=pars`
  - Automatic ordering `/forecast?tab=auto`
  - Predictions `/forecast`, tabs Plan the prep `?tab=prep`, Next 7 days `?tab=outlook`
  - Orders `/forecast?tab=approvals`, tab Order by hand `?tab=buy`
  - Suppliers `/forecast?tab=suppliers`, tabs Catalogue `?tab=catalogue`, Reliability `?tab=reliability`
  - Deliveries and invoices `/stock?tab=suppliers`, tab Invoice approval `/finance?tab=invoices` (two different addresses for one item)
- **Revenue and reconciliation**
  - Revenue `/money`, with Outlet performance `?tab=outlets`, All transactions `?tab=orders`, Drinks per guest by waiter `?tab=waiters`, Booked against billed covers `?tab=covers`
  - Flagged transactions `/money?tab=flags`, with Till rule check `?tab=till`, Cash `?tab=cash`, Room charge check `?tab=rooms`, Hotel guests `?tab=guests`
  - Reports `/reports`, linking to Recipes, Item history, the Money Back List `/investigations`, Tips `/money?tab=tips` (Preview), Menu `/menu`, Sales and performance `/performance` (Preview)
- **Settings and help:** Settings `/settings` (and POS and PMS adapters `/settings/adapters`), Other tools `/more` (hidden in the public demo, but the guided path's last stop opened it), Help and tour
- **Outside the sidebar:** Tyll Flow `/flow`, Rooms `/rooms`, Events and staffing `/events` (all three marked Preview or a different product), My tasks `/tasks`, Tyll Staff `/staff`, full screen count `/count`, case pages `/investigations/<id>`, order pages `/money/orders/<id>`.

### Each page's purpose

| Page | Purpose |
|---|---|
| Overview | Money lost and saved in 30 days, the three things that need you today, four cards |
| Alerts | Everything that needs a decision, with resolve and snooze |
| Stock levels | How much is left and what runs out |
| Expiring soon | Batches by use-by date and what to do with them |
| Waste and breakage | Log and analyse waste |
| Stock takes and missing stock | Counts, approval, what went missing, bought against used |
| Over pouring | Glasses sold against bottles opened or scanned |
| To order, Par levels | Items below minimum and the min/max levels |
| Automatic ordering | The 06:00 run and its rules |
| Predictions | What to order to month end, deliveries at risk |
| Orders | Approvals and status of every order |
| Suppliers | Terms, catalogue and prices, reliability |
| Deliveries and invoices | Three way check of each delivery, invoice approval |
| Revenue | Revenue, outlets, transactions, waiters, covers |
| Flagged transactions | Rules, flags by type, worked example, flagged orders (top 8) |
| Money Back List | The same flagged cases as a full list with assignment, deadlines, outcomes and money recovered |
| Reports | Management report and CSV downloads |
| Settings | Access, demo data, notifications, data sources, roles, thresholds, saved changes |
| Flow, Rooms, Events, Sales and performance, Tips | Previews or other products |

### Where pages overlap

1. **Flagged transactions and the Money Back List** show the same cases: the flags page lists the top 8 "Flagged orders" and links to the Money Back List for the rest; both have Open, Value at risk or Potential losses, and Recovered tiles.
2. **To order, Automatic ordering and Predictions** are three menu items for one job (what to order), on one address `/forecast`.
3. **Deliveries and invoices** lives at `/stock?tab=suppliers` and `/finance?tab=invoices`: two addresses, under two different sections, for one menu item.
4. **Room charges** appear in Revenue > Flagged transactions (Room charge check row), in Reports (before the overnight polish) and as types in the Money Back List, but the room charge rule was usually not among the five rules shown first in "What Tyll checks".
5. **Other tools** repeated menu items (Money Back List, Alerts, Settings) and listed three previews under "Coming soon".
6. **Expiring soon** had its own menu item, an alert, a daily bell notice and a search entry, for a feature a real hotel can only use after entering every batch at receiving.

### Numbers shown on more than one page (F&B Director, 20 Nov 2026, before)

| Figure | Where | Agrees? |
|---|---|---|
| Money lost, 30 days €10,912 | Overview only (the lost and saved drawer breaks it down) | yes |
| Drinks not billed, 7 days €451 | Overview card, Over pouring | yes |
| Stock critical 2 | Overview card "2 critical", Stock "Critical 2", sidebar badge, Predictions "At risk of running out 12, 2 critical" | yes (12 = 2 critical + 10 low) |
| Open flags 13 | Flagged transactions "Open flags 13", Money Back List "Open cases 13" | yes, shown twice |
| Value at risk €1,467 | Flagged transactions "Value at risk €1,467", Money Back List "Potential losses €1,467" | yes, but two names for one figure |
| At risk €1,918 | Revenue "At risk, flags and drinks" (flags €1,467 plus drinks this week €451) | a second version of "at risk" |
| Money in alerts €3,014 | Alerts only | yes (its own scope: everything on Alerts) |
| Orders waiting for approval | Overview Predictions card "1 waiting for approval" (this morning's automatic orders only), Orders "Waiting for approval 3" | **no**: two versions |
| Recovered €451 | Flagged transactions, Money Back List | yes, shown twice |
| Revenue, 7 days €80,176 | Overview card, Revenue, Reports | yes |
| Estimated profit €5,458 | Overview card ("profit, estimate") | an estimate on the first screen |
| To query with suppliers €743 | Deliveries and invoices | counts deliveries the supplier already credited |

### Errors and broken behaviour found while crawling

- **Console error on every Stock page view for Purchasing and the Head Chef:** `GET /api/variance` answers 403, because the Stock page asks for missing stock figures these roles may not see.
- **Head Chef can open Flow and Events** (a different product and a Preview).
- **Date:** Expiring soon could say "Today, Thu 19 Nov" while the charts ran to 20 Nov. Cause: the browser takes "today" from a cookie set by the proxy, which can be a different module instance from the one that serves the figures; a server started on the 19th kept the 19th for its figures while a proxy instance first loaded after midnight said the 20th. Pages built at build time could also carry the build day.

### Before score

| # | Criterion | Before | Evidence |
|---|---|---|---|
| 1 | 5 second clarity | 6 | Purchasing has six items for three jobs; Flagged transactions and the Money Back List answer the same question on two pages. |
| 2 | Story | 5 | The guided path ends on "Coming soon" previews and never shows a bill followed to money recovered or a supplier invoice to query. |
| 3 | Calm | 6 | Flagged transactions shows a top 8 table and a separate full list elsewhere; Overview has a fifth story hidden in cards that report sales. |
| 4 | Trust | 5 | Preview screens, an estimated profit on the first screen, "1 waiting" against "3 waiting", a date that can disagree with the charts. |
| 5 | Action | 7 | Most problems have a next step, but the Overview's Predictions card shows €15,718 with no instruction, and the clearest money story (invoiced, not delivered) is buried. |
| 6 | Consistency | 6 | Deliveries and invoices under two addresses; "Value at risk" and "Potential losses" for one figure; "Money Back List", "Investigations" and "flags" for one thing. |
| 7 | Roles | 7 | Each role is enforced on the server, but the Head Chef sees Flow and Events, and room roles fill Settings and sign in. |
| 8 | Mobile | 8 | Log waste and goods in are two taps; Flagged transactions on a phone repeats the case list twice. |
| 9 | Polish | 7 | Consistent design, but Preview banners and "Coming soon" make parts look unfinished. |
| 10 | Reliability | 7 | A 403 console error on Stock for two of the three main roles; one item with two addresses. |

## 3. Changes, step by step

(Filled in as each step lands.)
