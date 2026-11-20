# Late delivery prediction: feature log

Branch `feature/late-delivery-prediction`, started from the finished `feature/overnight-checks` (the overnight run was still polishing when this brief arrived, so the branch waits for its last commit; section 2 was done read only in the meantime).

## What the demo already has (section 2)

**Clock and dates.** The business date is today in Lisbon (`DEMO_TODAY`, `src/lib/util.ts`); the demo clock is 20:55 (`DEMO_NOW_MIN`), so "the evening before" is the moment the demo is shown. Every record is placed with `rel(days)`; tests pin `TYLL_DEMO_DATE=2026-10-13`. `dayIn` and `timeIn` give local day and time for a time zone (`DEMO_TIME_ZONE` Europe/Lisbon, also on `Property.timeZone`). Never a fixed date in data.

**Suppliers.** `SUPPLIERS` in `src/lib/data/catalog.ts`: meat Carnes Ribeiro & Filhos, sea Peixaria Atlântico, produce Hortas do Tejo, dry Mercearia Lusa, wine Douro Cellars, bev Fonte Clara Bebidas, ware Horeca Ibérica, hk Linho Lisboa. Terms per hotel (`SupplierAccount`: delivery days, cut off, lead days, minimum order) in `src/lib/server/procurement-seed.ts`, plus backup suppliers `meat-alt` (Talho Central), `sea-alt`, `produce-alt`, `dry-alt`, `bev-alt`, with catalogue lines (`preferred: false`).

**Deliveries.** `buildDeliveries` in `src/lib/data/generate.ts`: 30 days back plus tomorrow (`status: "expected"`), one per supplier per delivery day, lines ordered, delivered, invoiced. No times at all: no promised window, no arrival time. These drive stock, so the 12 weeks of timing history must not change them (see decisions).

**Orders.** `PurchaseRequest` with `expectedAt` (local `YYYY-MM-DDTHH:MM`), `receipts`, `deliveryId`; seven seeded orders (`src/lib/server/orders-seed.ts`). `orderStage` (`src/lib/domain/order-stage.ts`) names late, on the way, delivered, short. PR-LIS-0005 (fish, due 15:00 today) is the planted late order.

**The existing late alert.** `src/lib/alert-feed.tsx` builds one feed for Alerts, the bell and Overview "Needs you today" (`topAlerts`). A late order becomes `kind: "delivery"`, red, "Fresh fish delivery due 15:00 has not arrived", with menu items at risk, `next` Call supplier (`/forecast?tab=approvals&request=`) and `also` Order from backup supplier (`/forecast?tab=buy&focus=`). Delivery alerts sort first inside red. Resolve and snooze are `alert.state` records on the server per person and role (`src/lib/domain/records.ts`, `/api/records`).

**Stock and run out.** `monthPlanFor` (`src/lib/server/purchasing.ts`) works per day from tomorrow: on hand, confirmed arrivals, predicted use per day from covers, events and occupancy; gives `runOutDate`, `daysUntilOut`, health critical or low. No time of day: the late delivery check needs a within-day split of tomorrow's use by service (breakfast, lunch, dinner).

**Predictions page.** `src/components/prediction/predictions.tsx`: SummaryBar with "Next delivery" (from dataset deliveries with status expected, "N deliveries confirmed"), the order table with "Would arrive" (`useRec().arrives` = order by + lead days), "Show all N recommended items" Section, "How this is calculated".

**Automatic ordering.** `src/lib/domain/auto-order.ts` and `src/lib/server/auto-order.ts`: at 06:00 items due today or tomorrow become one order per supplier; `reviewReason` states why an order waits for a person; under €1,500 with nothing to review it is sent (simulated).

**Goods in.** The staff app already has `/staff?do=receive` (storekeeper u-store, permission `purchase.receive`): expected orders, then per line received. The one tap "Received" with arrival time belongs there.

**Roles.** `src/lib/domain/access.ts`: modules per role and permissions, enforced with `guard()` and `requirePermission` on every route. Purchasing (`purchasing`: forecast, stock, alerts; `purchase.create/review/receive`), head chef (`chef`: forecast, stock, alerts; no money), restaurant manager (`restaurant_manager`, own outlets). Storekeeper receives.

**Saved records and workspaces.** Server store via `loadStore`/`mutateStore`, one workspace per public visitor (`tyll_ws`), decisions as typed changes in `records.ts` with person, role and time. Notifications `src/lib/server/notify.ts` (`notify()`, `resolve()`), emails logged as previews, never sent.

**Page pattern, charts, translation.** `PageHeader` (title, question, "Simulated data"), `SummaryBar`, `StripTrend` with Open to `TrendExplorer`, `Section` for "Show all N", `Drawer`. Text translated at render from `src/lib/i18n/messages.json` (`scripts/i18n-add.py`), logical classes for Arabic.

## How to run this branch

```bash
export PATH=~/.local/share/node-lts/bin:$PATH; unset PORT FORCE_COLOR
node node_modules/typescript/bin/tsc --noEmit -p .
node node_modules/eslint/bin/eslint.js src
node node_modules/vitest/vitest.mjs run
node node_modules/next/dist/bin/next build   # the first run can stop on the known SecurityFatalError; run it again
```

## Progress

| Step | Status | Notes |
|---|---|---|
| 2. Learn the demo | done | Summary above |
| 1. Delivery history and receiving | in progress | History, rules and server module built; goods in screen next |
| 2. Prediction logic | done (logic) | `src/lib/domain/late-delivery.ts` |
| 3. Only alert when it matters | done (logic) | `lateShortfall`, per service, prep times |
| 4. Warn the right people | done (logic) | `ensureLateNotices`, evening and morning, bell and prepared email |
| 5. Screens | to do | Predictions card, reliability tab, would arrive text, goods in |
| 6. Demo story | done (data) | See "The demo story" |

## Where things are

- `src/lib/domain/late-delivery.ts`: every rule. Late means more than 15 minutes after the promised window closes. Recent deliveries weigh more (a delivery 42 days old counts half). Patterns: same weekday, the two days after a Lisbon public holiday, a large order (30% above the supplier's usual value), the time slot. The pattern that moves the chance most (by at least 15 points) explains the prediction in one sentence; small patterns are pulled towards the supplier's own rate. Under 8 deliveries: "Learning this supplier", no prediction. Confidence: 8 to 19 deliveries low, 20 to 39 medium, 40 and more high, one step lower when the pattern has under 6 deliveries. Likely late at 50%, may be late at 30%.
- `src/lib/data/delivery-history.ts`: 12 weeks of deliveries with promised window, arrival time and completeness, simulated. The last 30 days are the dataset's deliveries (same ids, values, lines); older days keep each supplier's delivery days.
- `src/lib/server/late-delivery.ts`: coming deliveries (confirmed by suppliers for tomorrow, and approved orders in Tyll not yet arrived), the risk list for one hotel, warnings, actions (backup order, called, prep, covered, other), arrivals at goods in, supplier reliability. Saved in the store's `lateDelivery` section with person and role; reset with purchasing.
- `src/app/api/deliveries/route.ts` (goods in, arrivals, actions) and `src/app/api/deliveries/reliability/route.ts`.
- The month plan carries `risk` (the list), `needByDay` (use for the next three days) and `leadBuffer` per item.
- Permissions: `deliveries.view` (owner, GM, controller, F&B director, restaurant manager, purchasing, head chef) and `deliveries.handle` (the same less the controller). Arrivals need the existing `purchase.receive` (purchasing, storekeeper).

## The demo story

Tomorrow's meat delivery from Carnes Ribeiro & Filhos (07:00 to 08:00) is likely late: "Late on 7 of the last 10 <tomorrow's weekday>s, 2 hours 25 minutes on average" (on 19 November that reads Fridays, as in the brief). The delivery brings 10 kg of Wagyu mince, 5 kg of it owed from today. Tonight about 2.4 kg is left: breakfast takes about 1.7 to 1.9 kg, so when lunch prep starts at 09:30 well under a kilo is left against about 1.3 to 1.6 kg for lunch (the Wagyu beef burger at Mercado and In-Room Dining). Red, lunch short, about €70 to €140 of burger sales at risk (an estimate at lunch sales per kg). Talho Central, the backup butcher, can deliver tomorrow morning.

Why tonight's stock is low, all as ordinary records:
- Today's meat delivery came with no Wagyu, and the supplier did not charge it: the dataset invoices 0 kg, and goods in (Ahmed Karimi, storekeeper) recorded the delivery difference, received 0, at 07:52 (a saved delivery difference, `RR-STORY-<day>`). Tomorrow's confirmed delivery carries the 5 kg owed.
- At 15:40 Mercado's chef (Rafael Costa) logged the Wagyu from Fridge 2, which lost temperature, as spoiled (shared waste `W-STORY-<day>`). The quantity is whatever leaves 2.4 kg tonight, so the story is the same every day: about 1 kg on the November dates, more on the test date.

## Decisions

1. **Started before the overnight run finished.** The brief arrived while the overnight build was polishing in the same folder. This branch was built in a separate git worktree from `feature/overnight-checks` at its polish commit (9917863). The only later overnight commit is the morning report (documents only).
2. **The story is planted through ordinary records, not by changing stock rules.** With the dataset as it is, Wagyu stock covers more than a day and a 2 hour delay never hurts a service, so Tyll would rightly not alert. Reducing the dataset's delivery instead would push Wagyu below its par minimum in the test data, which the existing end to end purchasing test (Wagyu, pinned at 2026-10-13) relies on. A goods in record and a spoiled entry are what a hotel would actually have, and they show in Saved changes and on Waste like any other entry. They are set up when the demo is opened (records and plan requests), like the daily expiry notice, so pure function tests are untouched. The extra spoiled Wagyu adds about €45 to money lost on the November dates.
3. **The story weekday follows tomorrow.** The business date is today in Lisbon and must show the same story every day, so the meat supplier is late on the weekday of tomorrow's delivery. On 19 November that is Friday, as the brief asks.
4. **Prep times decide what a late delivery can hurt.** The kitchen needs the stock when prep starts: breakfast 06:00, lunch 09:30, dinner 16:30. A service whose prep starts after the likely arrival is covered by the delivery.
5. **Lateness has to be the cause.** An alert needs a shortage at the likely arrival time that would not be there if the delivery came on time. A shortage that would happen anyway is a stock problem, already shown as critical or low on Stock.
6. **Use by service comes from the last 28 days of sales**, by the hour each bill opened (before 11:00 breakfast, before 17:00 lunch, then dinner), applied to the plan's predicted use for the day. The plan's stock is the Stock page's, so the figures agree.
7. **Severity.** Red when a quarter or more of a lunch or dinner is short, amber otherwise. Sales at risk is the short quantity at the service's sales per unit of the item (an estimate).
8. **Who is told.** Purchasing, the head chef, and the restaurant managers of the outlets that would be short, through the bell and a prepared email (never sent). The evening before from 18:00, and again from 05:00 on the day until prep starts, once each. The demo clock is 20:55, so the evening warning is the one that shows.
9. **The backup butcher delivers the next morning.** Talho Central's terms were changed so it takes orders until 22:00 for a next morning delivery, every day (it was Monday, Wednesday and Friday with 2 days' lead). Without that, the backup action could never help the next day. Ordering from it creates a draft order, which still needs approval and is never sent.
10. **"Handled" is shared.** Once one person marks a delivery handled (and how), it is handled for the team: the alert moves to Resolved for everyone and the warning notices are closed. Resolve and snooze on Alerts stay per person, as before.
11. **A lead time buffer for automatic ordering and Predictions.** When the order would arrive on a day the supplier is likely late by an hour or more, the order date moves a day earlier, with the reason ("Ordered a day early: Carnes Ribeiro & Filhos is often late on Saturdays."). Only the order date moves; stock health keeps its rules.
12. **Delivery days.** The history keeps the dataset's delivery days for the suppliers that have them (meat, fish and produce daily; dry goods Monday and Thursday; drinks and wine Tuesday and Friday). They differ from the supplier terms on the Suppliers page; that difference was already in the demo and is left as it is.
