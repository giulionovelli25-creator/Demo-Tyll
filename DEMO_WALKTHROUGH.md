# Tyll demo walkthrough

How to present Tyll: start it, choose the people, follow the stories and reset afterwards. Everything is fictional and simulated.

## Start

```bash
npm install          # first time only, uses package-lock.json
npm run dev -- -p 3210
```

Open **http://localhost:3210**. (Plain `npm run dev` uses port 3000.) Node.js 20.9 or later is required.

**Sign in:** on the sign-in page, people are grouped by department. Choosing a person fills in their details and scrolls back to the form; press **Sign in**. Management accounts then enter a PIN, which the PIN screen shows while demo mode is on. Credentials are in `config/demo-accounts.json`.

**Switching person** is a real sign-out and sign-in: use **Sign out** in the profile menu, or the **Sign in as …** button on a guided demo step.

## Who to use

| Story | People |
| --- | --- |
| Owner's view | Layla Al Mansoori (owner) |
| Missing stock, wine, beef | Sara Haddad (The Terrace manager), Marco Bellini (F&B director, can change pour standards) |
| Forecast to purchasing | Sara, then Nadia Rahman (Purchasing), Priya Raman (Accounting), James Whitfield (General manager, only for orders over AED 5,000), Ahmed Karimi (Storekeeper) |
| Conference and staff support | Yasmin Saleh (Events), Sara (lends her team) |
| Guest Connect | Leila Mansour (Front office) or Lina Haddad (Concierge), then Sara |
| Late room | Leila, Grace Mwangi (Housekeeping), Maria Santos (Room attendant) |
| Luggage | Leila, Tomas Reyes (Bell captain), Yusuf Adeyemi (Bell attendant) |
| Sales | Noor Al Hashimi (Sales), Daniel Mercer (Director of sales, approves discounts) |
| Staff on a phone | Omar Farouk (Steward), Ravi Menon (Commis chef), Maria, Yusuf, Ahmed |
| Other hotel (permission checks) | Mariam Al Kuwari (Sales, Doha), Elena Petrova (Accountant, Doha) |

## Take a tour

**Take a tour** (sidebar, under the main tools; **Tour** in the staff app's header) walks through your own workspace: it opens each page, highlights the important part and explains it in a sentence. **Back**, **Next**, **Skip**, **Restart** and **×**; arrow keys and Escape work too. **Tour this page** in the profile menu covers only the current module. New people are offered the tour once on first sign-in. The tour never clicks, submits or approves anything, and only shows pages your role can open.

## Guided demo

Sign in as anyone except frontline staff and choose **Guided demo** at the bottom of the sidebar. Pick a story; a small card at the bottom right gives one instruction at a time, with **Go there**, **Sign in as …**, **Previous**, **Next**, **Reset** and **×** (exit). You perform every action yourself; the card never says something happened. Minimise it with **–**. It stays with you across sign-ins in the same browser.

Main stories: Where did the Cokes go? · More wine than expected · Forecast to purchasing · Conference without staffing problems · Dinner for a guest · Late room to ready room. **More short demos** has sales to event, staff waste on a phone and an invoice difference. The original **Five-minute owner tour** is also in the list.

## Baseline (after a reset)

- **Coca-Cola, The Terrace:** 40 opening + 10 received − 12 counted = 38 used; sales explain 30; **8 cans unexplained**. The hero order TRC-1013-198 has a Coke removed after it went to the bar.
- **House wine, Lobby Lounge:** 20 glasses × 150 ml = 3,000 ml expected; 3,750 ml used; **750 ml unexplained**. At a 175 ml standard: 3,500 ml expected, 250 ml unexplained.
- **Wagyu beef, The Terrace:** 80 burgers × 180 g = 14.4 kg expected; 16.2 kg used; **1.8 kg unexplained**.
- **Rooms:** suite 1211 (VIP, due 21:30) is being cleaned and is predicted about 19 minutes late; the guest for 1205 is already waiting. The demo clock starts at 20:55 and moves with real time.
- **Events:** Regional sales conference dinner (EVT-DXB-0001), 180 guests, short of staff; Doha wedding (EVT-DOH-0001).
- **Purchasing:** no requests; the first new one is PR-DXB-0001. The F&B budget for October is AED 260,000, with about AED 10,000 left before new orders.
- **Finance:** 23 Dubai supplier invoices differ from their delivery, such as Gulf Prime Meats MEAT-1011 (22 kg chicken ordered, 18 received, 22 invoiced).
- **Sales:** five Dubai opportunities, one proposal awaiting the customer (PRP-DXB-0001), one deal already linked to EVT-DXB-0001.

## Everyday actions

- **Order stock:** Tyll Stock → **Order stock** (or Forecast → Order stock) → choose outlet and period → expected demand → **Calculate what to buy** → review items (open a row for its calculation) → **Send to Purchasing**. The request page then says "Request sent to Purchasing" with its reference. **Save draft** keeps it to yourself.
- **Purchasing:** signs in to **Purchasing** with **Requests to review**, **Purchase orders** and **Deliveries**, each with a count; the bell shows new requests. **Record delivery** on an approved order raises stock once.
- **Waste or breakage:** Tyll Stock → **Log waste or breakage**; staff use Tyll Staff → **Log breakage** or **Log waste** → item → quantity → Save.

## Where things are

Each module opens on up to four main choices; less common tools are under **More tools** (for example Stock → Recipes and costs, Suppliers). The Overview shows key figures, Needs attention and the outlet comparison; trends, results, guest experience and confirmed business are behind **Show trends and results**. Finance reports keep department and category filters behind **Filter by department or category**.

## Reset

- **One story:** in the guided demo card, choose **Reset**, then **Reset now**. Only that story's records go back to the start (for example purchasing, or rooms and guests). For the stock stories it also clears this browser's own demo changes.
- **Everything:** Settings → **Reset demo data** → **Yes, reset everything**.

Only the owner or general manager can reset shared records. Other people see **Sign in as Layla to reset**. Reset never touches accounts, sessions, the access log or any file outside `.data/purchasing.json`. To start completely fresh, stop the server and delete the `.data` folder.

## Five-to-seven-minute demo

1. **Owner sees a problem.** Sign in as Layla. The Overview shows revenue, expenses, estimated operating contribution and potential losses (each has a **?** explaining it). The Terrace has the lowest margin and the most open issues.
2. **Manager investigates missing stock.** Guided demo → *Where did the Cokes go?* As Sara: Tyll Stock → Where did it go? → Coca-Cola: 8 cans unexplained, possible explanations listed as things to check.
3. **Tyll shows the evidence.** Open the linked order: a Coke removed from a bill six minutes after its ticket went to the bar. Record the outcome.
4. **Tyll predicts what is needed.** Forecast → What to buy: change expected guests and watch quantities change; open a line's explanation.
5. **Department asks for approval.** Create the request and submit it.
6. **Other departments act.** Sign in as Nadia: the bell shows the request; open it and approve. Priya is notified next and approves. Ahmed records the delivery on his phone.
7. **Owner sees the result.** Back as Layla: the Overview, Finance → Budgets & Reports (spending against budget, never mixing AED and QAR), and the Money Back List.

### Longer version

Add the conference story (Find staff, approval by the lending manager), Guest Connect (dinner for two accepted by The Terrace), the late room (front desk, housekeeping, a phone, inspection), and a phone waste entry that the manager sees straight away. **Ctrl+K** (or the search icon) finds records such as *Coca-Cola*, *PR-DXB-0001*, *1211* or *Guest Connect*.

## Known limitations

- A single-server demo: records are in one JSON file (`.data/purchasing.json`), written one change at a time. Not a production database.
- Investigation decisions, price and recipe changes and receipt corrections from Stage 2 are kept in the browser, so they are shared only within one browser. Waste, counts, purchasing, events, rooms, guests, sales and finance are shared on the server.
- Email is not sent unless a provider is configured (see `.env.example`); otherwise each email is shown in Settings as a preview, marked "Preview only, not sent". There are no native iOS or browser push notifications.
- Venue availability, outside confirmations (taxis, customers) and supplier invoices are simulated or entered by staff.
- Demo PINs are shown on the PIN screen while demo mode is on. Turn demo mode off (`TYLL_DEMO_MODE=off`) for anything else.
