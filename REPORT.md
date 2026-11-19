# Tyll critical audit: report

Branch `fix/critical-audit` (from `feature/purchasing-stock-control`), 19 November 2026. Local only: production and demo.tyll.ai were not touched, no supplier was contacted. Details and repro steps per finding: `AUDIT_LOG.md`.

## A. Readiness

- **Before: 5/10.** Switching to anyone but the F&B director could silently jump to another role on the next click (P0). Unsent orders counted as on their way, the order page claimed emails were sent, and one person's edited quantities carried over to the next person.
- **After: 8/10.** Switching is deterministic and tested, dates come from one source with one rule, and order sending is honest, confirmed and single. Held back by: no real supplier sending, the server's day only moves on restart, and the Next.js security upgrade still pending.

## B. Bugs fixed

| # | Severity | Repro | Root cause | Files | Test | Result |
|---|---|---|---|---|---|---|
| F1 | P0 | As Nadia, open Revenue: the demo becomes the Financial Controller | Proxy started a new session for a fitting role | `proxy.ts`, `app-shell.tsx`, `disclosure.tsx`, `purchasing-tabs.tsx`, `more-page.tsx` | `auth.test.ts` "switches deterministically" (fails on old proxy) | Fixed, checked in app |
| F2 | P1 | Edit a quantity on Predictions as Nadia, switch to Marco: Marco sees and orders it | Edits stored once per browser | `lib/plan-edits.ts`, `predictions.tsx` | `plan-edits.test.ts` | Fixed, checked in app |
| F3 | P1 | Server started before Lisbon midnight, page opened after: screen and server disagree on today | Each module and the browser worked out the day separately | `util.ts`, `proxy.ts` | `dates.test.ts`, `auth.test.ts` | Fixed; the day moves only on restart |
| F4 | P2 | Rule for past deadlines copied six times, time zone hard-coded five times | No shared rule | `domain/deadline.ts`, `types.ts`, `catalog.ts`, six screens, two server files | `dates.test.ts` (yesterday, today, tomorrow, 23:59 and 00:00 hotel time, UTC+4 hotel from UTC+1, closed, deadline moved) | Fixed |
| F5 | P1 | Send an approved order: "Emailed to …" though nothing is emailed | Wording in server history and order panel | `procurement.ts`, `approvals.tsx` | `procurement.test.ts` | Fixed, confirm before sending, checked in app |
| F6 | P2 | Two overlapping sends could both log an email | Check outside the store write | `procurement.ts` | `procurement.test.ts` (one outbox email after repeat sends) | Fixed; two-process race not reproduced |
| F7 | P2 | Approved, unsent order shown as awaiting delivery | Counted every approved request | `domain/procurement.ts`, `forecast/page.tsx`, `approvals.tsx` | `procurement.test.ts` | Fixed, checked in app |
| F5b | P2 | Double click on Send asked twice and showed an error | Action not blocked until the button re-rendered | `approvals.tsx` | Checked in app (three clicks: one log, one message) | Fixed; no automated UI test |

## C. Other improvements

- Every page sets a `tyll_day` cookie so the browser shows the server's business date.
- Order panel shows who sent the order; the send confirmation names the order, supplier and address.
- Earlier in this branch: long text figures in summary rows wrap instead of overlapping (the waste page "Top item").

## D. Checks run

| Check | Command | Result |
|---|---|---|
| Unit and integration tests | `node node_modules/vitest/vitest.mjs run` | 23 files, 241 tests passed |
| Type check | `node node_modules/typescript/bin/tsc --noEmit -p .` | passed |
| Lint | `node node_modules/eslint/bin/eslint.js src` | 0 errors, 2 warnings (both older, in `domain.test.ts`) |
| Build | `node node_modules/next/dist/bin/next build` | first run stops on Next.js's known-vulnerability check, second run succeeds |
| End to end | none | no end-to-end suite exists in the repo; flows were checked by hand in the running app |
| Running app | 19 pages as the F&B director | every API request 200, no script errors; waste logging at phone width without sideways scroll |

## E. Open issues

- **BLOCKED: real supplier sending.** No email provider is connected for orders, so there are no sending, failed or retry states. Needs a provider choice.
- **PARTIALLY FIXED: day rollover.** Server and screen always agree, but the day moves only when the server restarts. Restart a long-running demo daily.
- **BLOCKED: Next.js security upgrade.** Waiting for your yes; the first build of each run fails until then.
- **UNVERIFIED:** a race between two server processes on the same store file (code path guarded, not reproduced).
- **P3:** purchasing can set a line to 0 during review; the line stays on the order with quantity 0. Suggested fix: drop zero lines when approving.
- **P3:** wide tables (par levels, suppliers, three-way match) scroll sideways on phones.
- **Missing features, not bugs:** Arabic translation of longer text; visit tracking, feedback and legal pages (plan waiting for your OK); an end-to-end test suite.

## F. Demo readiness

Yes, it can be shown to a hotel prospect tomorrow, run locally. Before the demo: restart the server that morning, and build twice (or approve the Next.js upgrade). During the demo: say that sending an order logs the email in the demo and does not email the supplier, and avoid the Arabic view beyond titles and buttons.
