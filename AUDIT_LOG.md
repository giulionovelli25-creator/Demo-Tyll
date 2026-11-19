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
