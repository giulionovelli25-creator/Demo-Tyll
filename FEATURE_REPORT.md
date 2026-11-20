# Late delivery prediction: report

Branch `feature/late-delivery-prediction`, built on `feature/overnight-checks`. Nothing was pushed to main, deployed, or sent anywhere. Status: **done**, on simulated data.

## What was built and where to click

| What | Where | Who sees it |
|---|---|---|
| **Deliveries at risk** card: "Which deliveries might arrive late?". The deliveries whose lateness would leave a service short come first (top 5); everything else is behind "Show all N coming deliveries". | `/forecast` (Predictions) | Owner, GM, controller, F&B director, restaurant manager, purchasing, head chef |
| **The delivery** in a drawer: promised window, likely arrival, chance of being late, confidence, the one sentence from the record, what it would leave short, and the actions | `/forecast?risk=meat%7C<tomorrow YYYY-MM-DD>` (any alert opens it) | Same; actions need "Act on a late delivery" |
| **Actions**: order from the backup supplier (a draft that needs approval, never sent), call the supplier, adjust prep, mark as handled (stock covers it, or another way, with a note), take back. Each is saved with person, role and time, and closes the alert for the team. | In the drawer | Owner, GM, F&B director, restaurant manager, purchasing, head chef (controller sees, does not act) |
| **Worked example**: how the alert was found, in four steps, like the Coke example | `/forecast?open=late-example` | Same as the card |
| **Alerts, bell, Overview**: the delivery at risk is one alert, ranked like the others; on the Overview it is "Needs you today" number 1 | `/alerts`, the bell, `/` | Alerts: every role with the permission. Bell: Purchasing, head chef, the restaurant managers of the outlets that would be short |
| **Supplier reliability** tab: on time rate with a weekly trend (Open for the larger view), average delay, weekday pattern, deliveries and confidence; least reliable first, the rest folded; 4 or 12 weeks | `/forecast?tab=reliability` (Suppliers, third tab) | Roles that order and see deliveries at risk |
| **Goods in, one tap**: today's and tomorrow's supplier deliveries with a big Received button; "Something missing?" records what is missing | `/staff?do=receive` (Tyll Staff, Deliveries tile) | Storekeeper and purchasing (`purchase.receive`). In the public demo, Purchasing has the same "It has arrived" in the drawer |
| **A day early for unreliable suppliers**: an order that would arrive on a day the supplier is likely late gets ordered a day earlier, and says why | Predictions ("Would arrive", with "A day early" and the reason under the item), automatic orders' explanation | Everyone who sees Predictions or orders |

## The demo story and how to show it

1. Open the demo (any role that sees the Overview, for example the F&B Director). "Needs you today" number 1: **Wagyu beef mince short before lunch tomorrow: Carnes Ribeiro & Filhos likely late**, at Mercado and In-Room Dining, €141 of sales at risk (an estimate; the figure depends on the day, about €70 to €140).
2. Open it, or go to Predictions as the Purchasing Manager or Head Chef. The Deliveries at risk card says: late on 7 of the last 10 Saturdays (tomorrow's weekday; on 19 November it reads Fridays), 2 hours 25 minutes on average, so likely about 10:20 AM instead of 7:00 to 8:00 AM; 444 g of Wagyu left when lunch prep starts at 9:30 AM, lunch needs about 1.6 kg.
3. Open the worked example: the delivery brings 10 kg (5 owed from today), stock tonight is 2.4 kg, breakfast uses about 1.9 kg, so lunch is 1.1 kg short before the likely arrival. On time, it would be in. That is why Tyll alerts: lateness is the cause.
4. In the drawer, press **Order 2.0 kg from Talho Central, arrives tomorrow**: a draft purchase order at the backup butcher, which still needs approval and is never sent. The alert closes for everyone ("Ordered from the backup supplier, by Nadia Rahman, purchasing manager"), and stays closed after a refresh. "Take back" reopens it.
5. Switch role: the Head Chef sees the same delivery as handled. Supplier reliability (Suppliers, Reliability) shows Carnes Ribeiro's Saturday cell at 9 of 12, the fish supplier late after public holidays, Fonte Clara almost always on time, and Horeca Ibérica still being learned.

Why the Wagyu is low tonight is in ordinary records: goods in recorded this morning that the meat delivery came with no Wagyu (not charged; owed tomorrow), and the chef logged the Wagyu from a fridge that lost temperature as spoiled. Both show in Saved changes and the shared waste log with person and role.

## Screenshots

In `feature-screenshots/` (1440 wide and 375 wide, plus Arabic):

- `01-overview-*`: Overview with the alert first.
- `02-predictions-card-*`: the Deliveries at risk card.
- `03-delivery-drawer-*`: the drawer with actions.
- `04-worked-example-*`: the worked example.
- `05-supplier-reliability-*`: Supplier reliability.
- `06-alerts-*`: Alerts.
- `07-*-ar`: the drawer, reliability and Alerts in Arabic.
- `08-goods-in-*`: goods in on the staff app, as the storekeeper.

The phone drawer screenshot is captured on a full page height, so it shows the drawer part way down; on a real phone it opens full screen from the top.

## Decisions

See `FEATURE_LOG.md` for the full list with reasons. The main ones:

1. **The story is planted through two ordinary records,** a goods in delivery difference and a spoiled entry, set up when the demo is opened. The dataset's own stock covers more than a day, so a 2 hour delay never hurts, and Tyll would rightly not alert. Changing the dataset's stock instead would break the end to end purchasing test, which relies on Wagyu being above its minimum.
2. **The late weekday follows tomorrow,** so the same story shows every day (Fridays on 19 November, as the brief asks).
3. **The kitchen needs stock when prep starts:** breakfast 06:00, lunch 09:30, dinner 16:30.
4. **An alert needs lateness to be the cause.** On time, the service would have been covered.
5. **Warnings go the evening before (from 18:00) and again from 05:00 until prep starts,** once each, through the bell with a prepared email that is never sent. The demo clock is 8:55 PM, so the evening warning is the one that shows.
6. **Talho Central, the backup butcher, now takes orders until 22:00 for a next morning delivery,** so the backup action can help the next day.
7. **"Handled" is shared by the team;** resolve and snooze on Alerts stay per person, as before.
8. **The alert leads with what hurts:** the item and the service, then the supplier. This was changed after the head chef walk through.
9. **Supplier reliability lists the least reliable first,** four open, the rest folded, and suppliers still being learned last.
10. **Goods in on the phone is for the storekeeper,** who is not one of the public demo's four roles. In the public demo, Purchasing records an arrival from the drawer.

## Checks run

Final run, on the finished branch:

| Check | Result |
|---|---|
| Type check | Passed, 0 errors |
| Lint | 0 errors, 2 warnings, both in `src/lib/__tests__/domain.test.ts` and there before this branch |
| Tests | 36 of 36 files, 538 of 538 tests passed: the existing 514, plus 24 new in `src/lib/__tests__/late-delivery.test.ts` |
| Build | Passed. The first run stops on the known SecurityFatalError (the Next.js version advisory); the second passes, as on the other branches |
| Browser | Every new screen opened at 1440 and 375 wide, plus Arabic. No error text on any page, and no untranslated text left on the new screens |
| Live action | On the running branch, Purchasing's "Order from Talho Central" made draft PR-LIS-0011 (2 kg Wagyu, delivery tomorrow, status draft), and the delivery showed as handled in a fresh session |

The new tests cover:
- a reliable supplier gives no alert;
- a late supplier with enough stock gives no alert;
- a late supplier with stock running out gives an alert;
- fewer than 8 deliveries shows "learning";
- the holiday effect, large orders, and recent deliveries weighing more;
- the hotel's time zone, arrivals past midnight, and warnings around midnight;
- a delivery that arrives clears the alert;
- handled stays handled after a refresh, for every role, and can be taken back;
- role permissions (controller sees but does not act; the storekeeper records arrivals; others are refused);
- a restaurant manager is warned only about their own outlets;
- the backup order is a draft and nothing is sent;
- warnings go once, to the right people, with emails logged and not sent.

## Left unfinished, or worth knowing

- **Real arrival times need goods in to use it.** The 12 weeks of history are simulated. New arrivals recorded at goods in feed the prediction from the next day.
- **The warnings run when the demo is opened, not on a server timer,** like the daily expiry notice and the automatic ordering run.
- **The delivery days in the history are the dataset's** (meat, fish and produce daily). They differ from the supplier terms on the Suppliers page. That difference was already in the demo.
- **The Staff app and the tours are not translated,** as before. The new goods in text has translations ready in the messages file.
- **The two bell notices sent earlier in a workspace keep their wording.** A workspace opened before the wording change keeps the older title; new workspaces use the new one.
- **Older translation gaps elsewhere on Predictions were filled where they showed on these screens.** Gaps on other pages were not looked at.
