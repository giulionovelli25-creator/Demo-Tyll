# Tyll critical audit log

Branch `fix/critical-audit`, started 19 November 2026 from `feature/purchasing-stock-control` (eb8cec9), the newest work.
Resume from this file if a session runs out of context.

## Section 0, worked out from the code

- **Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, zustand on the client. Server state is a JSON file (`.data/purchasing.json`) behind `loadStore`/`mutateStore`; sales, stock and the rest are simulated, generated from a seed relative to the business date. Vitest for tests. No database, no hosting config in the repo.
- **Run locally:** `node node_modules/next/dist/bin/next build` then the `tyll-platform` preview (port 3210). Tests: `node node_modules/vitest/vitest.mjs run`. Seed data is generated automatically; the public demo resets it on the first visit after a start, then at most hourly.
- **Test accounts:** fictional demo roles, no passwords: u-buy Nadia (purchasing), u-fnb Marco (F&B director), u-chef Rafael (head chef), u-fc Priya (financial controller); others in `src/lib/data/catalog.ts`.
- **Person switcher:** in the public demo, "View the demo as" is a real session switch: the server issues a new session cookie for the chosen fictional role and every API route checks that role. Outside the public demo it is a sign-in.
- **How a purchase reaches the supplier:** an email with a PDF is prepared and written to an outbox log. Nothing is sent: no email provider is connected for supplier orders.
- **Approval rules:** purchasing reviews every order; accounting approves orders of any size at Lisbon (`accountingAbove 0`); the F&B director above €2,000; the general manager above €5,000. Nobody approves their own order. One signer per step.
- **Property time zone:** not stored. "Europe/Lisbon" is written into the code in several places; the demo has one hotel, in Lisbon.
- **Production:** not touched. Work is local only; demo.tyll.ai was not used.

## Findings

| # | Area | Severity | Finding | Status |
|---|---|---|---|---|
| F1 | Switching | P0 | Opening a page the role could not use silently signed the visitor in as another role (proxy). | FIXED in eb8cec9, tests added here |
| F2 | Switching | P1 | Quantities edited by hand on Predictions are kept in the browser for everyone, not per person: after a switch the next person sees, and orders, the previous person's numbers. | see below |
| F3 | Dates | P1 | The server fixes "today" when it starts; the browser works it out on each load. After midnight in Lisbon the two disagree until a restart: expiry days, late orders and deadlines differ between server figures and screen labels. | see below |
| F4 | Dates | P2 | The "past deadline" rule is written out in six places, and the hotel time zone is hard-coded in five. | see below |
| F5 | Purchasing | P1 | The order page says "Emailed to …" and "Sent to the supplier" although nothing is emailed (outbox log only). | see below |
| F6 | Purchasing | P2 | "Already sent" is checked before the store write, not inside it, so two sends that overlap could both write. | see below |
| F7 | Purchasing | P2 | Approved orders not yet sent are counted as "on the way" on Orders. | see below |

## Rules decided

- **Overdue:** a record with a date-only deadline is past its deadline when it is still open and the hotel's today is after the deadline. Due today is not overdue. Closed records never are. "Today" is the hotel's day, in its time zone.
- **Editing an approved order:** blocked on the server (only the author, only in draft or changes requested). Already the behaviour; documented.

## Log

### F1, role switched behind the visitor's back (P0): FIXED
- **Repro:** public demo as Nadia (Purchasing), open Revenue from a link or the address bar: the page opens as the Financial Controller. Same from any page the current role cannot use.
- **Root cause:** `src/proxy.ts` started a new demo session for a role that fits whenever the current role could not open the page; the menu also listed those pages, and links did a full reload to let it happen.
- **Fix (eb8cec9):** the proxy keeps the session and sends the role to its home page; menus, tabs and Other tools list only pages the role may open; no forced reloads.
- **Tests:** `auth.test.ts` "switches deterministically" (10 switches, last wins, earlier sessions dead, refresh, Back) fails on the old proxy and passes now. Checked in the running app: 10 pages opened as the chef, still the chef.

### F2, Predictions edits carried over to the next person (P1): FIXED
- **Repro:** as Nadia, change a quantity on Predictions (Order quantities). Switch to Marco: the same quantity shows as "Changed from the suggested …", and building the order as Marco uses Nadia's number.
- **Root cause:** `usePlanEdits` in `predictions.tsx` kept one map per browser (`tyll-plan-edits-v1`), not per person. Other drafts (`tyll-plan-drafts`, count progress, remembered tabs) were already per person.
- **Fix:** `src/lib/plan-edits.ts` keeps edits per person (`tyll-plan-edits-v2`; old shared edits are dropped); building an order clears only that person's edits.
- **Test:** `plan-edits.test.ts`.

### F3, server and browser disagree on "today" after midnight (P1): FIXED, rollover needs a restart
- **Repro (by reasoning and test, not waited out live):** start the server before midnight Lisbon time and open a page after midnight. The server's `DEMO_TODAY` was fixed when each module loaded; the browser computed its own on every load. Expiry "Use by today", late orders and deadlines on screen then use the new day while server figures use the old one; a module first loaded after midnight even disagrees with the rest of the server.
- **Root cause:** `businessToday()` in `src/lib/util.ts` ran separately in every module instance and in the browser.
- **Fix:** `resolveBusinessDay` gives one day per server process (shared on `globalThis`); the proxy sets a `tyll_day` cookie on every page; the browser reads it. Server and screen always show the same day.
- **Not fixed:** the server's day only moves on restart. The simulated data is generated once per process from that day, so a live rollover needs a restart. For a demo that runs overnight, restart it daily (or after midnight Lisbon time).
- **Tests:** `dates.test.ts` (one value per process, browser takes the server's), `auth.test.ts` (cookie on every page).

### F4, one rule for past deadlines and the hotel's time zone (P2): FIXED
- **Finding:** the rule was written out in six places (case list, case page, summary, alerts, overview tasks, issues). They agreed, but nothing kept them in step. "Europe/Lisbon" was hard-coded in five places.
- **Fix:** `src/lib/domain/deadline.ts` (`isPastDeadline`, `caseIsPastDeadline`) holds the rule with its comment; all six use it. `Property.timeZone` holds the hotel's zone; `dayIn`/`timeIn` in `util.ts` give the hotel's day and time; order times and receipts use the property's zone.
- **Tests:** `dates.test.ts`: yesterday, today, tomorrow, closed, deadline moved later, 23:59 and 00:00 hotel time, a UTC+4 hotel viewed from UTC+1.
- **Note:** the demo has no task module with due dates; deadlines exist on investigations only. Bell and guest-request "overdue" are minutes against a service target, a different rule, left as is.

### F6, "already sent" checked outside the store write (P2): FIXED (hardening)
- **Finding:** `sendPurchaseOrder` checked `sent` on a snapshot read before the write. Within one Node process sends cannot interleave, and the button is disabled while sending, so a double click already gave one email. Two processes sharing the store file could both pass the check.
- **Fix:** the check runs again inside `mutateStore`, against the saved store, before the outbox email is added.
- **Test:** `procurement.test.ts`: a second send by the same and another person is refused and the outbox holds one email for the order. A true two-process race was not reproduced: UNVERIFIED beyond the code path.

### F7, approved orders not yet sent counted as on the way (P2): FIXED
- **Repro:** approve a purchase order and do not send it. Orders shows it under "Awaiting delivery" and in "N on the way", though the supplier has not been told.
- **Root cause:** `src/app/forecast/page.tsx` and the "Awaiting delivery" filter counted every request with status approved.
- **Fix:** `awaitingDelivery` and `awaitingSend` in `src/lib/domain/procurement.ts`. The header now reads "N approved and not sent" separately; the tile and filter count sent orders only.
- **Test:** `procurement.test.ts`, approved then sent.

### F5, the order page said "Emailed to" although nothing is emailed (P1): FIXED
- **Repro:** approve a purchase order, click "Email the order". The history says "Emailed to …" and the panel "Emailed to … on …", while the outbox status is `logged` and no email exists.
- **Root cause:** wording in `sendPurchaseOrder` (`procurement.ts`) and `SendPanel` (`approvals.tsx`) described a delivery the backend never confirms.
- **Fix:** history "Order logged for …"; panel "Sent to the supplier (demo: logged, not emailed)" with who sent it; button "Send the order" asks for confirmation first, naming the order, supplier and address; the toast says it was logged. The lifecycle badge stays "Sent", the step the order is in.
- **Test:** `procurement.test.ts` checks the history wording.
- **Not built:** a real sender. There is no "sending", "failed" or "retry" state because no transport exists; when an email provider is connected, those states are needed (the notification emails in `notify.ts` already have queued, sent and failed). BLOCKED on choosing a provider.
- **Follow-up (checked in the app):** a quick double click asked twice and posted twice; the server refused the second, which showed an error. Order actions now run one at a time (`inflight` ref in `RequestView`), so three quick clicks give one confirmation, one log entry and one success message.
- **Checked in the running app:** approved order PR-LIS-0008 shows "1 approved and not sent" on Orders (F7); sending it logs "Order logged for Peixaria Atlântico …" and the panel reads "Sent to the supplier (demo: logged, not emailed)" (F5). F2: Nadia's edited beer quantity is kept for her and not shown to Marco after a switch.

## Phase D and E

- Walked 19 pages as the F&B director in a production build: every API request 200, no script errors. Waste logging at 375 px: no sideways scroll.
- Final checks and open issues: see `REPORT.md`.
