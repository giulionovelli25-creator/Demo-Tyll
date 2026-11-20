# Morning report

Branch `feature/overnight-checks`. Nothing was pushed, merged or deployed. All figures below are from the public demo on business date Fri 20 Nov, as the F&B Director (role `u-fnb`), checked on the final build this morning.

## The short version

- **All nine features are in the demo.** Eight are DONE. The ninth, the first real till and guest bill adapters (Lightspeed and Mews), is built but UNVERIFIED: it has only been tried on written sample responses, never on a real sandbox account. That is as the brief asked.
- **Nothing new in the menu.** Every feature is a tab or a sub page inside an existing section, and each answers one manager question.
- **Every check passes.** Type check clean, lint clean (the 2 old warnings), 514 of 514 tests, and the build works (on its second run, as always).
- **Every change people make is now saved on the demo server**, with name, role and time, and each public demo visitor gets their own workspace that the Reset button clears.
- **Three things need you:**
  1. **The original refund cases have dropped out of the public demo.** The new stories now fill all 12 open slots the public demo allows, so the two refunds with no reason (one of them overdue) no longer show, and the demo no longer shows a case past its deadline. Fixing it means raising the cap from 12 to 15, which changes a number in five tests. I did not do that without you. Details under "What is left".
  2. **The headline money is higher than the story target.** Overview money lost is €10,912 (target about €10,000) and saved is €3,615, 33.1% (target 40%). Value at risk is €1,515, of which €1,045 is estimates; every tile now says so.
  3. **A few judgement calls are yours:** waiter names show straight away on Drinks per guest (Over pouring hides them behind a click), and the "cheaper item rung up" rule cannot fully tell a swap from drinks not rung up at all.

## Checks run this morning

All in the repo, after `export PATH=~/.local/share/node-lts/bin:$PATH; unset PORT FORCE_COLOR`.

| Check | Command | Result |
|---|---|---|
| Type check | `node node_modules/typescript/bin/tsc --noEmit -p .` | Pass, 0 errors |
| Lint | `node node_modules/eslint/bin/eslint.js src` | Pass, 0 errors, 2 warnings (the known unused imports in `domain.test.ts`) |
| Tests | `node node_modules/vitest/vitest.mjs run` | Pass: 35 of 35 files, 514 of 514 tests (two clean full runs) |
| Build | `node node_modules/next/dist/bin/next build` | First run stopped on the known `SecurityFatalError` (Next.js known vulnerability check); second run passed, 99 pages generated |

**One thing to know about the tests.** Four tests that rebuild a whole week of data (the Coca-Cola, reserve red, seated table and breakfast stories) take about 5.5 seconds, just over Vitest's 5 second limit, when the machine is busy. Two of my four full runs failed on 3 or 4 of them with "Test timed out", while the load average was above 20 from other work on this Mac. The same four files passed alone (121 of 121), and the last two full runs passed 514 of 514. They are slow, not wrong. Giving those four tests a longer time limit would make the runs steady; I did not change tests in this step.

The preview server `tyll-platform` was restarted on this final build (http://localhost:3210). Fresh screenshots of the Overview, Flagged transactions, room charge check, bought against used, drinks per guest, covers, the breakfast case and the other story cases all load without errors and show the figures below.

## Feature by feature

| # | Feature | Status | Where |
|---|---|---|---|
| 1 | Room charge check | DONE | `/money?tab=rooms` |
| 2 | Bought against sold, per item | DONE | `/stock?tab=bought` |
| 3 | Drinks per guest by waiter | DONE | `/money?tab=waiters` |
| 4 | Empty bottle scan | DONE | `/staff?do=bottle`, `/waste`, `/drinks?open=empties` |
| 5 | Till rule flags | DONE | `/money?tab=till` |
| 6 | Booked against billed covers | DONE | `/money?tab=covers` |
| 7 | Hotel guests against outlet charges | DONE | `/money?tab=guests` |
| 8 | Save everything to the server | DONE | `/settings`, `/alerts`, any case page |
| 9 | First real POS and PMS adapters | UNVERIFIED | `/settings/adapters` |
| 10 | Final polish pass | DONE, one finding left for you | Flags, Money Back List, Overview, Settings |

In case links, `<yesterday MMDD>` means yesterday's month and day: on 20 Nov it is `1119`.

### 1. Room charge check: DONE

**Question:** "Did every room charge reach the guest's bill?"

**Where to click** (role F&B Director `u-fnb`; also the general manager, the Financial Controller `u-fc`, the owner, and restaurant managers for their own outlets):
- `/money?tab=rooms`: 7 days shows 789 charges checked, 99.1% posted correctly, 7 not matched (€318), €224 open to check (2 flags).
- `/money?tab=rooms&open=example` opens the worked example.
- `/investigations/EX-RC-MER-1119-299` is the story case.
- `/money?tab=flags` and `/investigations?type=room&status=all` show the room charge flags in the flags system and the Money Back List.
- As Head Chef `u-chef` the page sends you to Stock, and the API answers 403.

**Story to demo:** last night at Mercado three guests signed their dinner, check MER-1119-299, €143, to room 1412 at 9:04 PM. It landed on room 1421, two digits swapped. Room 1412 checked out this morning without paying for it. Tyll finds the same check and amount on a different room. The suggested message says 1412 has already checked out, so move the charge off 1421 and charge the card on file. Note: this story is no longer item 2 of "Needs you today" on the Overview (Coca-Cola is now); open it from Flagged transactions or Alerts.

**Screenshots:** [overview](overnight-screenshots/01-room-charges-overview-desktop.png), [desktop](overnight-screenshots/01-room-charges-desktop.png), [phone](overnight-screenshots/01-room-charges-phone.png), [Arabic](overnight-screenshots/01-room-charges-ar.png), [flags](overnight-screenshots/01-room-charges-flags-desktop.png), [flags open](overnight-screenshots/01-room-charges-flags-open-desktop.png), [case](overnight-screenshots/01-room-charges-case-desktop.png), [chef sent away](overnight-screenshots/01-room-charges-chef-denied.png). The overview shot shows the figures from before the later features; today's Overview reads €10,912 lost.

### 2. Bought against sold, per item: DONE

**Question:** "Are we buying more than we sell?"

**Where to click** (`u-fnb`; also Purchasing `u-buy`, the general manager, `u-fc`, the owner; not the chef or staff):
- `/stock?tab=bought`: €727 more bought than used (open flags, an estimate), 2 items to check.
- `/stock?tab=bought&item=coke` opens Coca-Cola with the sum, the last count and the two tap check.
- `/investigations/EX-BU-LIS-COKE-1120` is the flag's case (the id ends in today's month and day).
- Overview "Needs you today" item 2 is this story.

**Story to demo:** a standing order adds three cases of Coca-Cola to every drinks delivery. In 30 days, 1,992 cans came in and 1,304 were sold or wasted: 688 cans more bought than used, 448 of them beyond today's delivery, about €605 at the price paid, an estimate. The drawer shows the last count (15 Nov, 539 counted) so you can answer "are the cans really there?". Then show the control: as Purchasing, mark "Counted: the stock is on the shelf"; the flag stays open, waiting for a manager. Switch to F&B Director and press "Confirm and close"; value at risk drops by €605. Use "Take back" to reset. Lobster tail (€122) is a second, harmless flag.

**Screenshots:** [desktop](overnight-screenshots/02-bought-vs-sold-desktop.png), [phone](overnight-screenshots/02-bought-vs-sold-phone.png), [Arabic](overnight-screenshots/02-bought-vs-sold-ar.png), [item](overnight-screenshots/02-bought-vs-sold-item-desktop.png), [item phone](overnight-screenshots/02-bought-vs-sold-item-phone.png), [item Arabic](overnight-screenshots/02-bought-vs-sold-item-ar.png), [wine Arabic](overnight-screenshots/02-bought-vs-sold-item-wine-ar.png), [waiting for a manager](overnight-screenshots/02-bought-vs-sold-awaiting-item-desktop.png), [waiting, phone](overnight-screenshots/02-bought-vs-sold-awaiting-item-phone.png), [waiting, Arabic](overnight-screenshots/02-bought-vs-sold-awaiting-item-ar.png), [as Purchasing](overnight-screenshots/02-bought-vs-sold-awaiting-purchasing-desktop.png), [waiting case](overnight-screenshots/02-bought-vs-sold-awaiting-case-desktop.png), [after the check](overnight-screenshots/02-bought-vs-sold-after-check-desktop.png), [controller](overnight-screenshots/02-bought-vs-sold-controller-item-desktop.png), [controller Arabic](overnight-screenshots/02-bought-vs-sold-controller-item-ar.png), [case](overnight-screenshots/02-bought-vs-sold-case-desktop.png), [case Arabic](overnight-screenshots/02-bought-vs-sold-case-ar.png), [flags](overnight-screenshots/02-bought-vs-sold-flags-desktop.png), [Money Back List](overnight-screenshots/02-bought-vs-sold-moneyback-desktop.png), [Overview](overnight-screenshots/02-bought-vs-sold-overview-desktop.png), [Alerts](overnight-screenshots/02-bought-vs-sold-alerts-desktop.png), [Alerts Arabic](overnight-screenshots/02-bought-vs-sold-alerts-ar.png), [Purchasing view](overnight-screenshots/02-bought-vs-sold-purchasing-desktop.png), [chef not shown](overnight-screenshots/02-bought-vs-sold-chef-not-shown-desktop.png).

### 3. Drinks per guest by waiter, and tables with food but no drink: DONE

**Question:** "Who needs coaching, and where are drinks going missing?"

**Where to click** (`u-fnb`; `u-fc` sees the same with names but cannot record coaching; chef, purchasing and staff are sent home, API 403):
- `/money?tab=waiters`: opens on Mercado, evening shift, 30 days. 1 waiter to coach, €403 drinks not sold (an estimate).
- `/money?tab=waiters&waiter=MER-S1` opens Rahul Okafor's tables.
- `/money` has the row "Drinks per guest by waiter" under Outlet performance.

**Story to demo:** Rahul Okafor on Mercado evening shifts: 0.50 drinks per guest against 0.73 for colleagues on the same evenings. 64 of his 174 tables with food had no drink, where colleagues' share would give about 15. About €403 in drinks not sold, an estimate. On day shifts he is in line, which shows why Tyll compares shift by shift. Open him, show a table's bill, Record coaching (two taps), see "Coached 20 Nov" on the chart, then Take back (the note stays on record, marked withdrawn).

**Screenshots:** [desktop](overnight-screenshots/03-drinks-per-guest-desktop.png), [phone](overnight-screenshots/03-drinks-per-guest-phone.png), [Arabic](overnight-screenshots/03-drinks-per-guest-ar.png), [waiter](overnight-screenshots/03-drinks-per-guest-waiter-desktop.png), [waiter phone](overnight-screenshots/03-drinks-per-guest-waiter-phone.png), [waiter Arabic](overnight-screenshots/03-drinks-per-guest-waiter-ar.png), [coached](overnight-screenshots/03-drinks-per-guest-coached-desktop.png), [coached phone](overnight-screenshots/03-drinks-per-guest-coached-waiter-phone.png), [controller](overnight-screenshots/03-drinks-per-guest-controller-desktop.png), [controller Arabic](overnight-screenshots/03-drinks-per-guest-controller-waiter-ar.png), [link on Revenue](overnight-screenshots/03-drinks-per-guest-revenue-link-desktop.png), [chef not shown](overnight-screenshots/03-drinks-per-guest-chef-not-shown-desktop.png).

### 4. Empty bottle scan: DONE

**Question:** answered on Over pouring: "how many bottles were really poured?"

**Where to click:**
- Staff phone: `/staff?do=bottle` as staff steward `u-emp` at 375 wide: tile "Empty bottle", then the bottle. Two taps.
- Manager: `/waste` as `u-fnb`, card "Empty wine and spirit bottles".
- Results: `/drinks?open=empties` as `u-fnb` (also the general manager, `u-fc`, the owner, restaurant managers), Section "Empty bottle scans".

**Story to demo:** Bar Azulejo has scanned every empty since 3 Nov, Mercado since 11 Nov; In-Room Dining does not scan and says so. Last Friday, late shift at Bar Azulejo: 7 empties of house red scanned and 1 glass sold. With the open bottle, about 36 glasses expected, so about €315 not billed. "See the scans" lists the times in order with "Who scanned a bottle is not who poured it." Then scan one live as the steward: a toast says "Over pouring counts it." with Undo. Today's figures move by one bottle; the four week patterns and "Sofia Rahman at Bar Azulejo stands out" do not, because they use closed days only.

**Screenshots:** [desktop](overnight-screenshots/04-empty-bottles-desktop.png), [phone](overnight-screenshots/04-empty-bottles-phone.png), [Arabic](overnight-screenshots/04-empty-bottles-ar.png), [Over pouring](overnight-screenshots/04-empty-bottles-drinks-desktop.png), [Over pouring phone](overnight-screenshots/04-empty-bottles-drinks-phone.png), [Over pouring Arabic](overnight-screenshots/04-empty-bottles-drinks-ar.png), [staff Arabic](overnight-screenshots/04-empty-bottles-staff-ar-phone.png), [staff home](overnight-screenshots/04-empty-bottles-staff-home-phone.png), [waste phone](overnight-screenshots/04-empty-bottles-waste-phone.png), [waste Arabic](overnight-screenshots/04-empty-bottles-waste-ar-phone.png), [chef not shown](overnight-screenshots/04-empty-bottles-chef-not-shown-desktop.png), [buyer not shown](overnight-screenshots/04-empty-bottles-buyer-not-shown-desktop.png).

### 5. Till rule flags: DONE

**Question:** "Which bills broke a till rule?"

**Where to click** (`u-fnb`; also the general manager, `u-fc`, the owner, restaurant managers for their own outlets; chef sent home):
- `/money?tab=till&open=example` (the page with the worked example), `/money?tab=till&open=bottles` (premium bottles against what was billed).
- `/investigations/EX-MER-1119-301`: the reopened bill.
- `/investigations/EX-MIX-AZU-RESERVE-1119`: the reserve red week.
- `/investigations?type=till&status=all`: Money Back List filtered.

**Story to demo:** last night at Mercado a table of 3 paid €124 in cash at 10:07 PM. At 10:31 PM the bill was reopened under the same login, 2 lamb chops came off (the kitchen had marked them ready before the guests paid), and it closed again at €56 with no reason and no approval: €68. Mercado's lamb count agrees. Second story: Douro reserve red at Bar Azulejo, 11 bottles to the bar in 7 days against about 6 a week before, only 31 of about 55 glasses billed as reserve: about €154 to €182, an estimate. An item rung twice is the guest's money, so it never counts as money lost or recovered.

**Screenshots:** [desktop](overnight-screenshots/05-till-rules-desktop.png), [phone](overnight-screenshots/05-till-rules-phone.png), [Arabic](overnight-screenshots/05-till-rules-ar.png), [bottles](overnight-screenshots/05-till-rules-bottles-desktop.png), [bottles phone](overnight-screenshots/05-till-rules-bottles-phone.png), [bottles Arabic phone](overnight-screenshots/05-till-rules-bottles-ar-phone.png), [reopened bill](overnight-screenshots/05-till-rules-case-reopen-desktop.png), [reopened phone](overnight-screenshots/05-till-rules-case-reopen-phone.png), [reopened Arabic](overnight-screenshots/05-till-rules-case-reopen-ar.png), [reserve red](overnight-screenshots/05-till-rules-case-mix-desktop.png), [reserve red Arabic](overnight-screenshots/05-till-rules-case-mix-ar.png), [price by hand](overnight-screenshots/05-till-rules-case-price-desktop.png), [rung twice](overnight-screenshots/05-till-rules-case-ring-desktop.png), [rung twice Arabic](overnight-screenshots/05-till-rules-case-ring-ar.png), [flags](overnight-screenshots/05-till-rules-flags-desktop.png), [flags Arabic](overnight-screenshots/05-till-rules-flags-ar.png), [Alerts](overnight-screenshots/05-till-rules-alerts-desktop.png), [Overview](overnight-screenshots/05-till-rules-overview-desktop.png), [Money Back List](overnight-screenshots/05-till-rules-moneyback-desktop.png), [controller](overnight-screenshots/05-till-rules-controller-desktop.png), [chef not shown](overnight-screenshots/05-till-rules-chef-not-shown-desktop.png). The polish pass shot is [till after polish](overnight-screenshots/10-polish-till-desktop.png).

### 6. Booked covers against billed covers: DONE

**Question:** "Did every seated table get a bill?"

**Where to click** (`u-fnb`; also `u-fc`, the general manager, the owner, restaurant managers; chef sent home):
- `/money?tab=covers`: 30 days, 950 tables seated, 98.5% of booked guests billed, 2 tables with no bill, €150 open to check.
- `/money?tab=covers&days=7&service=lunch` and `/money?tab=covers&open=example`.
- `/investigations/EX-BK-MER-1119-90`: the story case.

**Story to demo:** last night at Mercado a booking for 4, made by the guest in room 1108, was seated at Table 31 at 8:12 PM and marked finished at 10:04 PM. No bill was opened at that table in that time, and no bill for 3 to 5 guests was opened nearby. €150 at Mercado's dinner spend per guest, an estimate. One step asks the front office whether the meal can go on room 1108, with the guest's agreement. A checked example: a lunch table of 4 that joined colleagues and paid on their bill, closed as legitimate.

**Screenshots:** [desktop](overnight-screenshots/06-covers-desktop.png), [phone](overnight-screenshots/06-covers-phone.png), [Arabic](overnight-screenshots/06-covers-ar.png), [phone Arabic](overnight-screenshots/06-covers-phone-ar.png), [7 days lunch](overnight-screenshots/06-covers-7days-lunch-desktop.png), [case](overnight-screenshots/06-covers-case-desktop.png), [case phone](overnight-screenshots/06-covers-case-phone.png), [case Arabic](overnight-screenshots/06-covers-case-ar.png), [worked example](overnight-screenshots/06-covers-example-desktop.png), [link on Revenue](overnight-screenshots/06-covers-revenue-link-desktop.png), [flags](overnight-screenshots/06-covers-flags-desktop.png), [controller](overnight-screenshots/06-covers-controller-desktop.png), [chef not shown](overnight-screenshots/06-covers-chef-not-shown-desktop.png).

### 7. Hotel guests against outlet charges: DONE

**Question:** "Are in-house guests' meals being charged?"

**Where to click** (`u-fnb`; also `u-fc`, the general manager, the owner, restaurant managers; chef, purchasing and staff sent home):
- `/money?tab=guests`, `/money?tab=guests&open=rates` (rooms by rate), `/money?tab=guests&open=example`, `&days=7`.
- `/investigations/EX-BF-MER-1120-900`: the story case (ends in today's month and day).
- "See the bills" on an outlet row opens All transactions for that outlet only.

**Story to demo:** this morning at Mercado the breakfast host ticked in room 1517, one guest on "Advance purchase, room only". Nothing was charged to the room and no breakfast bill was paid at the table from 7:08 AM to 7:48 AM. The guest is still in house tonight, so the €26 breakfast can go on the room before check-out; close it live as Revenue recovered. Guests on a rate with breakfast are never flagged. Beside it, outlet sales against the guests in house: Bar Azulejo on Tue 10 Nov sold €1,738 against about €2,185 usual, a prompt to look, not a flag.

**Screenshots:** [desktop](overnight-screenshots/07-guests-vs-charges-desktop.png), [phone](overnight-screenshots/07-guests-vs-charges-phone.png), [Arabic](overnight-screenshots/07-guests-vs-charges-ar.png), [phone Arabic](overnight-screenshots/07-guests-vs-charges-phone-ar.png), [7 days, rates](overnight-screenshots/07-guests-vs-charges-7days-rates-desktop.png), [case](overnight-screenshots/07-guests-vs-charges-case-desktop.png), [case Arabic](overnight-screenshots/07-guests-vs-charges-case-ar.png), [case phone](overnight-screenshots/07-guests-vs-charges-case-phone.png), [flags](overnight-screenshots/07-guests-vs-charges-flags-desktop.png), [controller](overnight-screenshots/07-guests-vs-charges-controller-desktop.png), [See the bills](overnight-screenshots/07-guests-vs-charges-see-bills-desktop.png), [See the bills Arabic](overnight-screenshots/07-guests-vs-charges-see-bills-ar.png), [chef not shown](overnight-screenshots/07-guests-vs-charges-chef-not-shown-desktop.png).

### 8. Save everything to the server: DONE

**Question:** "Who changed what, and when?"

**What it does:** case decisions, stock cases opened by hand, recounts, standard quantities, delivery differences, ingredient prices, purchase approvals, forecast inputs, order status, closed notices, and Resolve and Snooze on Alerts are all saved on the demo server with the person, role and time. The server checks the permission again for every change. Each public demo visitor gets a workspace of their own; Settings > Demo data > Reset clears it.

**Where to click:**
- `/investigations/EX-MER-1119-301` as `u-fnb`: close it as Revenue recovered.
- `/alerts` as `u-fnb`: resolve the late fish delivery, snooze Coca-Cola, reload.
- `/settings` as `u-fc`: Saved changes lists every change with name and role.

**Story to demo:** close the reopened Mercado bill (€68) as Revenue recovered, resolve and snooze two alerts, reload: all kept. Switch to Financial Controller: the case reads "Closed by Marco Bellini, F&B director", money recovered is up by €68, and all alerts are open again, because resolve and snooze belong to the person. Saved changes lists all three. Open the demo in a private window: everything is fresh there. Reset demo data: back to the start.

**Screenshots:** [Settings](overnight-screenshots/08-server-storage-desktop.png), [Settings phone](overnight-screenshots/08-server-storage-phone.png), [Settings Arabic](overnight-screenshots/08-server-storage-ar.png), [Alerts](overnight-screenshots/08-server-storage-alerts-desktop.png), [Alerts phone](overnight-screenshots/08-server-storage-alerts-phone.png), [Alerts Arabic](overnight-screenshots/08-server-storage-alerts-ar.png), [stock case](overnight-screenshots/08-server-storage-stockcase-desktop.png), [case](overnight-screenshots/08-server-storage-case-desktop.png), [case Arabic](overnight-screenshots/08-server-storage-case-ar.png), [chef](overnight-screenshots/08-server-storage-chef-desktop.png), [another visitor](overnight-screenshots/08-server-storage-other-visitor-desktop.png).

### 9. First real POS and PMS adapters: UNVERIFIED

**Question:** "Can Tyll read our own tills and guest bills?"

**What it is:** two adapters, Lightspeed Restaurant K Series (tills) and Mews (guest bills), written from their public documentation, behind the demo's existing adapter interface. No live call is made and no credentials exist. They run only on `/settings/adapters`, on written sample responses, and the sample never changes any figure in the demo. Settings > Data sources labels both "Adapter built, not yet connected to a live account" and "Unverified".

**Where to click:** `/settings/adapters` as `u-fnb` or `u-fc` (also the owner and general manager). `/settings` shows the Data sources rows to every role. As `u-chef`, `u-buy` or `u-emp` the page sends you home and the API answers 403.

**Story to demo:** 12 bills read from the sample; net of tax €849 in both Lightspeed and Tyll; live calls made: 0. The first room charge is the Mercado dinner signed to room 1312 and posted to room 1321 (€116), the same check Tyll runs in the room charge check. Then a breakfast that never reached Mews (€96) and a lunch posted twice (€31). A 10% loyalty discount, a posting the front desk cancelled and redid, and a supper posted before check-out are correctly not flagged.

**Why UNVERIFIED:** it has to be run against a Lightspeed demo account and a Mews demo environment with sandbox credentials before anyone can say it works. The page lists what only a sandbox can confirm (where the room number sits on a Lightspeed room payment, whether discounts include tax, who approved a discount or a removal, which Mews services the outlets post to, and more).

**Screenshots:** [desktop](overnight-screenshots/09-adapters-desktop.png), [phone](overnight-screenshots/09-adapters-phone.png), [Arabic](overnight-screenshots/09-adapters-ar.png), [Settings](overnight-screenshots/09-adapters-settings-desktop.png), [Settings Arabic](overnight-screenshots/09-adapters-settings-ar.png), [chef sent away](overnight-screenshots/09-adapters-chef-desktop.png).

### Final polish pass

Value at risk and the Money Back List now say how much is estimates; "What Tyll checks" shows five rules with the rest behind "Show all 14 rules"; flagged orders show as cards on phones; Settings lists the nine new permissions and the new rule thresholds; more Arabic gaps filled; "1 of 2 weekly bottle checks" wording.

**Screenshots:** [flags](overnight-screenshots/10-polish-flags-desktop.png), [flags phone](overnight-screenshots/10-polish-flags-phone.png), [flags Arabic](overnight-screenshots/10-polish-flags-ar.png), [Money Back List](overnight-screenshots/10-polish-moneyback-desktop.png), [Money Back List phone](overnight-screenshots/10-polish-moneyback-phone.png), [Money Back List Arabic](overnight-screenshots/10-polish-moneyback-ar.png), [Overview](overnight-screenshots/10-polish-overview-desktop.png), [Overview Arabic](overnight-screenshots/10-polish-overview-ar.png), [Revenue](overnight-screenshots/10-polish-revenue-desktop.png), [Settings](overnight-screenshots/10-polish-settings-desktop.png), [Over pouring Arabic](overnight-screenshots/10-polish-drinks-ar.png), [staff Arabic](overnight-screenshots/10-polish-staff-ar.png).

## The demo's figures today (20 Nov, public demo, F&B Director)

- Overview: money lost €10,912, saved €3,615 (33.1%). Needs you today: 1 fresh fish delivery due 15:00 not arrived, 2 Coca-Cola €605 at risk (an estimate), 3 Bar Azulejo Friday late shift €342 not billed.
- Flagged transactions: 13 open flags, €1,515 value at risk, €1,045 of it estimates, 0 past their deadline, 26 new this week, €451 recovered (the same on the Money Back List).
- Alerts: 22 open, €2,808.
- These reconcile: the 13 open flags and €1,515 are the same on the flags page, the Money Back List and in Alerts; Revenue's "at risk" €1,966 is €1,515 plus €451 drinks.

## Decisions made, and why

- **No new menu items.** Every feature is a tab or sub page in the section where a manager would look for it (room charges, till rules and guest charges under Flagged transactions; waiters and covers under Revenue; bought against used under Stock takes; adapters under Settings). The menu caps in the tests are unchanged.
- **New flags go through the existing flags system.** Seven new flag types reach the flags list, Flagged by type, What Tyll checks, flags per 1,000 orders, the Money Back List, Alerts and the Overview, ranked by money.
- **Room charges were toned down** so they did not take over the demo's money story: fewer differences in the data (about 1 charge in 200).
- **Bought against used puts only the part beyond the last delivery at risk,** because the last delivery may still be on the shelf. A check made by Purchasing waits for a manager to confirm it, so the team that ordered cannot close the flag about its own ordering.
- **Waiter names** follow the same rule as Over pouring for who may see them, but show straight away (not behind "Show who was on"), because each bill is rung under that waiter's own till login, which is a fact, not a guess. Yours to change.
- **Empty bottle patterns use closed days only,** so one live scan in the demo never changes who stands out.
- **An item rung twice is the guest's money,** so it never counts as money lost or recovered; it closes only as a legitimate correction or no finding.
- **Public demo trimming:** the public demo shows a shorter list of cases. Pages that count cases say when checked cases were left out and then make no comparison with the period before, rather than show a misleading change.
- **Alerts resolve and snooze belong to the person,** and a snooze lasts until the next business day, as its message always said.
- **Arabic uses the 24 hour clock** everywhere, like German and Italian.
- **Lightspeed and Mews** were chosen because both publish complete documentation (Lightspeed a machine readable OpenAPI file). Approval checks are held on Lightspeed bills because its sales export has no "approved by" field; otherwise every Lightspeed discount would be flagged against staff.
- **The Money Back List stays a full table,** because it is the page every "Show all" leads to, with its own filters and paging.
- More detail on each decision is in `OVERNIGHT_LOG.md`, one section per feature and per review round.

## What is left, and problems found

**Needs your decision**
1. **Original refund cases are out of the public demo** (polish finding, medium, not fixed). The public demo keeps at most 12 open cases per hotel, and the new stories now fill them: on 20 Nov 13 cases must stay open. The two refunds with no reason (MER-1116-022, €70, overdue and assigned to Sara Haddad; MER-1120-063, €62) and the Mercado wine use case no longer show, `/investigations/EX-MER-1116-022` says "not available", and "0 past their deadline" means the demo no longer shows an overdue case. They are still in the full data. The fix is raising the cap to 15 in `src/lib/data/demo-cases.ts` and the number 12 in five tests (`dashboard.test.ts`, `bought-used`, `till-rules`, `covers`, `guests`), and reserving three slots for the largest original bill cases. I did not change test numbers without you.
2. **Money lost €10,912 against the €10,000 story target, saved 33.1% against 40%.** To lower it by €150, drop the checked covers example from the public demo list (`COVERS_EXAMPLE_EXCEPTION_ID` in `demo-cases.ts`).
3. **Cheaper item rung up** cannot fully tell a premium serve rung on the cheaper key from drinks not rung up at all. Making it decisive changes another pinned story (which outlet's margin fell most). About 30 lines; details in the log.
4. **Waiter names shown straight away** on Drinks per guest (see Decisions).
5. **A room charge posted twice** is also the guest's money but still closes as "recovered", unlike items rung twice.

**Review findings not fixed (all low)**
- Feature 1: over 30 days In-Room Dining leads flags per 1,000 orders over Mercado (7 days shows Mercado first); room charge types are 3 of the 5 largest flag types; the room check's 30 day trend can read "trending up".
- Feature 2: Coca-Cola's amount swings from €182 to €605 across the week; the case title wraps to three lines; Count records shows "Last full count, Wed 18 Nov" with housekeeping items only (older).
- Feature 3: a shift with no guests reads "None drinks per guest" on phones; Record coaching sits just below the fold on a 375 phone; the explanation is four open paragraphs on phones; the 1.14 tile mixes all outlets while the chart line reads 0.69; two near simultaneous Take back taps could overwrite each other.
- Feature 4: a live tap still moves today's figures and this week's totals (intended, Undo reverts); which outlets scan is fixed in code; demo barcodes are in-house codes, so a real bottle scanned by camera is not found.
- Feature 5: the "A week before" column is an average of up to four weeks; "bills with a repeat entry" counts large banquet bills; "N of M" notes are cut on phones; the lamb chops raise two flags (the reopened bill and the lamb usage), so they count twice in value at risk; "Total 56, 68 less than paid" has no currency.
- Feature 6: the public demo's headline 98.5% leaves out dropped checked tables (the full data says about 97.7%); "69 tables matched another way" includes 6 that left before ordering; outside the public demo the period before is 29 days long; a party much larger than its bill still counts as billed.
- Feature 7: the rate table mixes nightly averages with period totals; closed breakfast cases are dropped in the public demo, so its tiles never compare with the period before; a recovered breakfast still counts as "not charged"; the period before is 29 days but labelled 30.
- Feature 8: notes and typed reasons stay as written in every language; closing a bell notice is not listed in Saved changes (it happens on every notice click); stock cases saved before last night keep their old ids until a reset.
- Feature 9: a discount rounded to 2 decimals can leave a large bill some cents (not one cent) away from Lightspeed, and the page shows both totals; the approval hold also switches off the 25% limit and missing reason check for Lightspeed discounts; a Lightspeed void with no reason could read as "after items were sent", which the source cannot show; "Sample totals agree" keeps its label when they disagree.

**Other gaps**
- Some older screens are still partly English in Arabic: the case page's "Manage this case" panel, the cash page, older Settings panels (Cookies, Purchasing settings, Sign-in and access log), and the avatar initials "MB". Outlet, person and supplier names stay as written inside Arabic sentences by design.
- Restaurant manager views (`u-rm`, `u-lby`) are covered by tests only; those roles are not in the public demo role switcher, so there are no screenshots of them.
- No screenshot shows the covers "Already matched to booking" list or the shorter outcome list for an item rung twice; the cases are not in the public demo list. Tests cover both.
- Four slow story tests can time out when the machine is busy (see Checks).
- The Next.js build asks for a security upgrade. Not done, because upgrading Next.js was not allowed tonight. Worth planning.
- `.claude/launch.json` is untracked and was left out of every commit on purpose.
- Feature 9 next steps: sandbox accounts, then the live transports (OAuth2 for Lightspeed; ClientToken and AccessToken for Mews), then remove "Unverified".

## How to run the branch locally

From the repo folder (quote the path, it has spaces):

```sh
git switch feature/overnight-checks
export PATH=~/.local/share/node-lts/bin:$PATH; unset PORT FORCE_COLOR

node node_modules/typescript/bin/tsc --noEmit -p .     # type check
node node_modules/eslint/bin/eslint.js src             # lint
node node_modules/vitest/vitest.mjs run                # tests
node node_modules/next/dist/bin/next build             # build: the first run stops on the
node node_modules/next/dist/bin/next build             # known security check; run it again
node node_modules/next/dist/bin/next start -p 3210     # serve the build at http://localhost:3210
```

Never run two builds at the same time. In the Claude desktop app the same server is the preview named `tyll-platform`.

**Screenshots** (uses the Chrome installed on this Mac):

```sh
node scripts/screenshot.mjs "/money?tab=rooms" overnight-screenshots/example.png --width 1440 --role u-fnb
```

Add `--width 375` for a phone, `--lang ar` for Arabic (it also lists any untranslated text). Roles: `u-fnb` F&B Director (sees everything), `u-buy` Purchasing Manager, `u-chef` Head Chef, `u-fc` Financial Controller, `u-gm` General Manager, `u-emp` staff steward, `u-rm` restaurant manager.

The full night, feature by feature, with every review round, is in `OVERNIGHT_LOG.md`.
