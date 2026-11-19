# TYLL DEMO: OVERNIGHT FEATURE BUILD

You are working alone overnight on the Tyll demo (demo.tyll.ai), a stock, purchasing and revenue loss platform for hotel F&B managers. Nobody will answer questions until morning. Never stop to ask: make the most reasonable decision, write it down in OVERNIGHT_LOG.md, and keep going. When I wake up I want to see every feature below working in the demo, looking like it always belonged there.

You have plenty of time. Use it to be thorough, verify your work visually, and polish. Do not rush to finish.

## 1. Hard rules

- Work on a new branch `feature/overnight-checks`. Commit after each finished feature with a clear message. Never push to main, never deploy, never touch production or the live demo.
- Do not redesign or remove existing features. Only change existing screens where a new feature needs to plug in.
- No real external calls: no emails, no supplier messages, no real API credentials. Simulated data and mocks only.
- Keep all existing tests passing. Never weaken or delete tests.
- After each feature, run type check, lint, tests and build. Fix anything you broke before moving on.
- If a feature is blocked, write down why in OVERNIGHT_LOG.md, mark it BLOCKED and move to the next. Never leave the app broken.
- If your context fills up, OVERNIGHT_LOG.md must let a fresh session continue: update it after every feature with what's done, what's next and the decisions you made.

## 2. First, learn the demo (do not skip)

Before building, read the code and run the app. Understand and reuse:
- the page pattern: title, a plain question as subtitle ("Where is money going missing?"), KPI tiles, a chart card with an "Open" button for a larger view, and lists showing the top items with "Show all N" to expand
- the flags system on /money?tab=flags: rule types, the "What Tyll checks" rules list, flags per 1,000 orders, the Money Back List, the worked example, and how flags reach /alerts and the Overview "Needs you today"
- the simulated data story: Grand Hotel Lumière, outlets Mercado, Bar Azulejo, Banquets and Events, In-Room Dining, about 304 to 366 guests a night, business date 2026-11-19
- the adapters in src/lib/adapters.ts and how simulated data is generated
- the roles and permissions matrix (server enforced) and the role switcher
- how shared records are stored on the demo server, and which data is still only kept in the browser
- the translation system (the demo has a language switcher, including Arabic, which is right to left)
- the chart components and design tokens already in use

Write a short summary of this in OVERNIGHT_LOG.md before you start building.

## 3. Design principles for every new feature

The demo must stay calm and quick to read. A busy general manager should understand each new feature in 5 seconds.

- **No new top level menu items** unless there is truly no fitting place. Put features into existing sections as a tab, a card or a flag type.
- **Each feature answers one manager question,** written as the subtitle, in the same plain tone as existing pages.
- **Lists show the top 3 to 5 by money at risk.** Everything else sits behind the existing "Show all N" collapse pattern, or a new collapse you create in the same style. No long tables open by default.
- **Every finding ends in an action** using the existing patterns (review, assign, coach, mark checked), and money found feeds into the Money Back List where it fits.
- **New flag types flow into the existing system:** the flags list, flags by type, "What Tyll checks", Alerts and Overview "Needs you today", ranked by money like everything else. Not a separate silo.
- **Add a chart wherever it makes a pattern obvious faster than numbers.** Use the existing chart components and the "Open" larger view. Add small interactions where they save the manager time: period toggles (7 or 30 days), outlet filter through the existing global outlet selector, and hover or tap for detail. No decoration for its own sake.
- **Honest labels:** estimates are labelled as estimates, simulated data as simulated, and a flag is a prompt to check, not proof. Match the existing wording.
- **Totals must reconcile.** If you add flags, every count and euro figure elsewhere (open flags, value at risk, alerts, Overview) must still add up.
- **New user input is saved on the demo server,** following the existing shared records pattern, never only in the browser.
- **All new text goes through the translation system.** Check the Arabic layout.
- **Respect roles.** Add permissions to the matrix where needed and enforce them on the server.
- **Phone first for staff actions.** Anything staff do mid shift must work on a phone in two taps.

## 4. Features to build, in this order

Build them in this order so the most important are done first if time runs short. For each one, seed realistic simulated data that fits the existing story, including at least one clear "story" case a salesperson can demo.

1. **Room charge check.** Question: "Did every room charge reach the guest's bill?" Compare POS bills charged to a room with PMS postings: posted correctly, missing from the folio, wrong amount, wrong room, posted after checkout. Put it in Revenue as a tab or card and add the mismatches as a flag type. Show a matched against mismatched summary with a small chart, plus a worked example like the existing Coke one. Note: the existing Rooms module is a housekeeping preview; don't mix the two.

2. **Bought against sold, per item.** Question: "Are we buying more than we sell?" For each item over 30 days: bought (supplier invoices and deliveries) against used (recipes of what was sold plus logged waste). Flag big gaps in units and euros. This works with no stock count, so label it as an estimate that a count confirms. Put it in Stock (e.g. next to "Stock takes and missing stock"). Use Coca Cola as the story case. Chart: top items by gap.

3. **Drinks per guest by waiter, plus tables with food but no drink.** Question: "Who needs coaching, and where are drinks going missing?" Compare each waiter's drinks per guest with colleagues on the same outlet and shift, so busy nights don't distort it. Frame it first as upsell coaching: a bar chart of waiters against the team average line, with a coach action. Then link it to missing drinks: tables with food billed but no drink, as a drill down per waiter. Follow the existing privacy approach on the over pouring page (names only for roles allowed to see them). Decide the best home, likely Revenue, and log why.

4. **Empty bottle scan.** Over pouring currently uses simulated "bottles opened". Add a two tap phone flow for staff to log an empty wine or spirit bottle before binning it (scan the barcode or pick the bottle), next to the existing waste logging. The over pouring page should use scanned bottles where they exist, keep the simulated fallback clearly labelled, and update its explanation text.

5. **Till rule flags:**
   - **bill reopened and changed after payment,** especially when the total went down
   - **cheap item rung instead of expensive:** house wine billed while premium bottle use rises, or singles billed while doubles are poured
   - **open item, misc button and manual price overrides**
   - **the same item rung twice within seconds,** or a quantity far above normal

   Add each one as a flag type with its rule in "What Tyll checks", the same way existing rules are written.

6. **Booked covers against billed covers.** Question: "Did every seated table get a bill?" Per outlet and service: booked, billed, gap. Chart per service over the period. Put it in Revenue, near outlet performance.

7. **Hotel guests against outlet charges.** Question: "Are in house guests' meals being charged?" In house guests against breakfast charges, and bar and outlet sales against occupancy. Account for rates where breakfast is included in the room rate, so those guests are not flagged.

8. **Save everything to the server.** Waste, counts, investigation decisions and price changes are still only kept in the browser. Move them to the demo server using the existing shared records pattern, recorded with the user and role that made them. Keep "Reset demo data" working. Think about different prospects using the demo at the same time and make sure they cannot see or overwrite each other's changes; choose the approach and log it. Then test the role switcher: switch roles repeatedly, refresh, go back, and confirm no data from one role leaks into another.

9. **First real POS and PMS adapters.** Build one POS adapter (Lightspeed Restaurant K Series, or MICROS Simphony if better documented) and one PMS adapter (Mews or apaleo) behind the existing adapter interface. Use the public API documentation and test with recorded or mocked responses only. Keep the demo on simulated data by default. In Settings > Data sources, show these as "Adapter built, not yet connected to a live account". Mark both UNVERIFIED until tested with real sandbox credentials.

## 5. Verify like a user

For every feature:
- Run the app, open the new screens, and take screenshots at desktop (1440 wide) and phone (375 wide) size with Playwright. Save them in `overnight-screenshots/` named by feature.
- Look at your own screenshots critically. Fix crowding, misalignment, overflow, inconsistent spacing or anything that looks unlike the rest of the demo.
- Add tests for the flag rules and calculations, including cases that should not be flagged.

## 6. Final polish pass

When all features are done, walk through the whole demo as a busy general manager:
- Is any page now longer or noisier than before? Collapse or trim it.
- Does the Overview still show only what needs attention today?
- Do all totals still reconcile across pages?
- Does it all still work in every role and in Arabic?

## 7. Morning report

Write MORNING_REPORT.md with:
- **For each feature:** status (DONE, PARTIAL, BLOCKED, UNVERIFIED), where to click to see it (exact URL path), its screenshots, and the story case to demo
- **Decisions you made** and why
- **What's left** and any problems found
- **Checks run,** with pass and fail counts
- **How to run the branch locally**
