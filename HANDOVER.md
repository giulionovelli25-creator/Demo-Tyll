# Tyll platform demo: handover

Everything built so far, how it fits together, and how to set it up on another machine and continue in Claude Code in VS Code.

Last updated 14 October 2026. Repository: https://github.com/giulionovelli25-creator/Demo-Tyll

---

## 1. What this is

An interactive demo of Tyll.ai, a hospitality financial and operational intelligence platform. It covers a fictional two-hotel group (Grand Resort Dubai and Grand Resort Doha, nine outlets). Modules:

- Overview (owner and manager versions)
- Money
- Stock
- Forecast
- Flow
- Rooms
- Investigations (the Money Back List)
- Reports
- Settings

Everything is simulated:
- No real POS, PMS, accounting system or language model is connected.
- All explanations are written by deterministic rules from the demo records.
- The separate Tyll payment reconciliation product is deliberately **not** rebuilt here.

Demo clock: **Tuesday 13 October 2026, 8:55 PM** (Dubai). The hero order is `TRC-1013-198`: a burger and a Coke, with the Coke removed from the bill after it was sent to the bar. Its case is `EX-TRC-1013-198`.

---

## 2. Work completed, stage by stage

The work follows a seven-stage plan, and each stage stopped for approval before the next. Git history:

| Commit | Stage |
| --- | --- |
| `21d07c3` | Original build plus Phase 1 and 2: overview refinement, server-side sign-in with PIN |
| `2be7123` | Stage 1: Overview and navigation |
| `a9ace70` | Stock fix: server-side stock calculations |
| `f09326d` | Stage 2, first pass: shortfall cases, bulk assignment, case history, inventory detail |
| `e670ed9` | Stage 2: Stock intelligence and investigations (full brief) |

### Original build
- Next.js app with every module connected through one shared demo dataset.
- Tyll branding:
  - Inter, plus Noto Sans Arabic.
  - The cool silver and charcoal palette.
  - Pill buttons.
  - The logo, never redrawn.
- A guided five-minute owner tour.

### Phase 1: Overview refinement
- Owner overview with five cards: Revenue, Expenses, Estimated operating profit, Potential losses, Open issues.
- One performance chart.
- A list of outlets.
- "Needs your attention" (the top five issues) and a results summary.
- Estimated profit is labelled as an estimate.

### Phase 2: Real authentication
- Server-side sessions and PINs. Code lives in `src/lib/server/auth.ts` and `src/proxy.ts`.
- Passwords and PINs are stored as scrypt hashes in `.data/auth.json`, which is gitignored and created automatically.
- Session cookie is httpOnly and same-site. Sessions expire after 60 minutes idle and 12 hours in total.
- The PIN re-locks after 10 minutes idle.
- Lockout after 5 failed attempts.
- A PIN is required for every role except employee.
- Data reaches the browser only through `/api/data`, filtered by role in `src/lib/server/snapshot.ts`:
  - Managers receive only their own outlets.
  - Employees receive no sales values or cases.
  - Orders are fetched on demand.

### Stage 1: Overview and navigation
- The outlet list is sortable and filterable. Every hotel and outlet is clickable, so you can drill down: Group → Hotel → Outlet → Menu → Item → Order → Investigation.
- The manager overview has "My tasks and approvals".
- Module choice screens (`src/components/module-hub.tsx`), breadcrumbs, and the open section kept in `?tab=`.

### Stock calculation fix
- Stock and forecasts are worked out **on the server** (`src/lib/server/stock.ts`, `/api/stock`, `/api/forecast`) from every outlet that shares a store.
- Managers still receive only their own outlets' sales detail.
- Outlet-only stores stay separate: Maison Lune holds lobster, truffle and tenderloin; Al Dana holds lobster and truffle. See `OUTLET_STORES` in `src/lib/data/catalog.ts`.
- Root cause of Sara having no purchase approvals: the stock was calculated from her outlet-filtered data. Her permissions were never the problem.

### Stage 2: Stock intelligence and investigations
- **Stock home:** six choices: Check inventory, Where did it go?, Waste and breakage, Stock counts, Recipes and costs, Suppliers.
- **Where did it go?** (`src/components/stock/where.tsx`)
  - Each outlet's bar and kitchen stock is counted at close or handover.
  - Counted use (opening + received ± transfers − closing) is compared with expected use (units sold × recipe, plus recorded waste).
  - Each item opens to:
    - a plain-English summary;
    - the full calculation;
    - possible causes, each with evidence and a status (pointing to it, making it unlikely, or still to check);
    - a clickable timeline and the records;
    - next steps, and an Investigate button.
- **Worked cases.** The figures come from actual order records:
  - **Coca-Cola, The Terrace** (`EX-VAR-TRC-COKE-1013`): 40 opening + 10 received − 12 counted = 38 used, against 30 sold, leaving 8 unexplained. The hero order's removed Coke falls inside this period, and the two cases link to each other.
  - **House wine, Lobby Lounge** (`EX-VAR-LBY-WINE-1012`): 20 glasses × 150 ml = 3,000 ml expected; 3,750 ml used. Counts are in bottles to the nearest tenth, so the tolerance is ±150 ml.
  - **Wagyu beef, The Terrace** (`EX-VAR-TRC-WAGYU-1013`): 80 burgers × 180 g = 14.4 kg expected; 16.2 kg used; 1.8 kg unexplained (AED 327.60 at cost).
- **Corrections.** All are auditable and never overwrite the original:
  - recounts;
  - late waste entries for a period;
  - waste entry corrections;
  - delivery receiving differences (Suppliers);
  - standard pour or recipe quantity changes, with a preview (owner, general manager and F&B director only).
- **Investigations:**
  - assign, set a deadline and add notes;
  - assign several cases at once from the Money Back List;
  - case history from the audit trail;
  - resolving a stock case requires a verified cause and lets you record a corrective action;
  - recovered money is never assumed;
  - reopening is limited to general manager, F&B director, controller and owner.
- **Overview connection:**
  - Usage case amounts and headlines follow the latest figures.
  - Open-issue counts update when a case is resolved.
  - A dismissible "Tyll needs your attention" alert with one Investigate button.
- **Earlier first pass (kept):**
  - storeroom count shortfall cases;
  - inventory item detail.

### Stage 3: Forecast, purchasing and kitchen preparation
- **Forecast home:** three choices: What to buy, What to prep, Approvals (`src/app/forecast/page.tsx`, `src/components/forecast/*`).
- **Engine** (`src/lib/domain/planning.ts`): guests are reservations, plus walk-ins (usual guests less usual bookings, moved by occupancy), plus about 3 in 10 event attendees. Each guest is counted once. Dishes come from past orders per guest; ingredients from recipes, including corrected standards.
- **What to buy:** suggested purchase = requirement + safety stock − available usable stock − confirmed incoming − open requests, rounded up to packs. Other outlets' use of a shared storeroom is reserved first, and their sales are never sent.
- **What to prep:** portions by dish and meal, live ingredient needs and shortages, a saved plan, "Request missing ingredients" into What to buy, and a kitchen checklist that staff tick off on `/tasks`.
- **Approvals:** Draft → Purchasing → Accounting → (General manager above a threshold) → Approved, which becomes a demo PO. Changes requested and Rejected are possible at each step. Rules and budgets are per hotel in `src/lib/data/purchasing-rules.ts`. Stock rises only when an approved order is recorded as received.
- **Server-backed:** requests and prep plans live in `.data/purchasing.json` (`src/lib/server/purchasing*.ts`), so every account sees the same record.
- **Demo scenario:** Banqueting took 30 kg of chicken today and tomorrow's chicken is unconfirmed, so The Terrace gets "requires an additional 12 kg of chicken breast". Only tomorrow's supplier deliveries are confirmed.

### Stage 4: Events, staffing and cross-department support
- **Sales & Events** (`/events`): Plan an event, My events, Staff support (`src/app/events/page.tsx`, `src/components/events/*`).
- **Event planner:** five steps: details, food and drinks, requirements, staffing, summary. Statuses: draft → planning (committed) → ready, or cancelled. Ready is refused while any role or ingredient is short.
- **Calculations** (`src/lib/domain/events.ts`):
  - Portions are guests × portions per guest, per service, rounded up.
  - Ingredients come from recipes, including corrected standards.
  - Staff are counted from editable demo ratios (1 waiter per 15 seated guests, and so on).
  - Costs are estimates: ingredients from recipe costs, labour at demo hourly rates.
- **Workforce** (`src/lib/data/workforce.ts`): departments (outlets, Banqueting, Front Office, Housekeeping, Bell Team), verified skills, rostered shifts and leave. A focused demo model, not payroll.
- **One availability engine for events and everyday help** (`src/lib/server/ops.ts`):
  - It checks leave, the person's own shift and confirmed assignments.
  - Matching shows only people with the skill who are free for the whole time, with the reasons.
  - Only the manager of the person's own department can approve, decline or suggest an alternative.
  - Availability is checked again at approval, so double bookings are refused.
- **Links to Forecast:**
  - Committed events reserve their ingredients in What to Buy and replace the seeded event guests in the outlet forecast.
  - Stock already issued to an event counts as used. The conference continues seeded event EV-1 with the 30 kg of chicken from transfer T-7.
  - "Review purchase requirement" opens What to Buy in event mode. Event orders are issued to the event on receipt.
  - Event portions appear in What to Prep for the chosen kitchen and become checklist tasks.
- **Records:** events, support requests and assignments are stored on the server in `.data/purchasing.json` and seeded on first run.

### Known limitations and the next stage
- Corrections, cases and approvals are stored in the **browser** (zustand plus localStorage). Only sign-in is stored on the server.
- Pour changes update outlet and storeroom stock, but **not the Forecast page yet**. This belongs in Stage 3.
- Late waste entries show in the period's records and timeline, but not in the case's own history list.
- The demo budget is an estimate, and no order is sent to a supplier.
- Purchase requests and prep plans are stored on the server, but Stage 2 corrections still live in each browser.
- Event statuses In progress and Completed exist but are not set automatically from the clock.
- Cancelling an event notes its purchase requests for purchasing but does not reject them automatically.
- The workforce, shifts and labour rates are simulated demo data.
- **Next: Stage 5, guest experience.** Do not start it without the owner's go-ahead.

---

## 3. Demo accounts

Accounts are defined in `config/demo-accounts.json`. On the sign-in page, picking an account fills in its email and password.

| Role | Person | Email | Password | PIN |
| --- | --- | --- | --- | --- |
| Owner | Layla Al Mansoori | layla@grandresorts.example | Tyll-Demo-Owner-26 | 482913 |
| Restaurant manager, The Terrace | Sara Haddad | sara@grandresorts.example | Tyll-Demo-Terrace-26 | 3197 |
| Employee, The Terrace | Omar Farouk | omar@grandresorts.example | Tyll-Demo-Staff-26 | none (staff app PIN 2580) |
| General manager | James Whitfield | james@grandresorts.example | Tyll-Demo-GM-26 | 7364 |
| Financial controller | Priya Raman | priya@grandresorts.example | Tyll-Demo-Finance-26 | 591846 |
| F&B director | Marco Bellini | marco@grandresorts.example | Tyll-Demo-FnB-26 | 2468 |
| Purchasing manager (Stage 3) | Nadia Rahman | nadia@grandresorts.example | Tyll-Demo-Purchasing-26 | 1357 |
| Head chef, The Terrace (Stage 3) | Rafael Costa | rafael@grandresorts.example | Tyll-Demo-Chef-26 | 8642 |
| Events manager (Stage 4) | Yasmin Saleh | yasmin@grandresorts.example | Tyll-Demo-Events-26 | 2026 |
| Lounge manager, Lobby Lounge (Stage 4) | Karim Nassar | karim@grandresorts.example | Tyll-Demo-Lounge-26 | 4455 |

These are demo-only credentials. Never reuse them anywhere real.

---

## 4. Project map

```
tyll-platform/
  config/demo-accounts.json     demo users, passwords and PINs (hashed on first run)
  public/brand/                 logo and banner assets (never redraw the logo)
  scripts/brand-assets.mjs      regenerates brand images
  src/proxy.ts                  route guard (Next 16 uses proxy.ts, not middleware.ts)
  src/app/                      pages and API routes
    api/auth/*                  login, PIN, lock, logout, session
    api/data                    the role-filtered data snapshot
    api/orders/*                orders on demand
    api/stock, api/forecast     server-side stock and forecast
    api/variance                Where did it go? periods for the user's outlets
    stock/page.tsx              Stock home and its six sections
    investigations/[id]         case page
  src/components/
    overview/                   owner and manager overviews, stock alert
    stock/                      inventory, counts, waste logger, suppliers, where, usage
    timeline.tsx                clickable timeline used by orders and stock cases
    ui.tsx                      shared design components
  src/lib/
    data/catalog.ts             hotels, outlets, menus, recipes, ingredients, users
    data/generate.ts            deterministic demo dataset
    data/outlet-stock.ts        outlet stock checks, issues and the three worked cases
    domain/                     pure calculations: metrics, inventory, variance, forecast, access
    server/                     auth, guard, snapshot, stock, variance (server only)
    store.ts                    browser actions; each checks permissions and writes an audit entry
    hooks.ts                    shared React hooks (context, server stock, variance)
  src/lib/__tests__/            Vitest suites (87 tests)
  AGENTS.md                     written by `next dev`: Next 16 differs from older versions
  HANDOVER.md                   this file
```

---

## 5. Setting up on a new machine

### 5.1 Install the tools
1. **Git:** https://git-scm.com/downloads. On a Mac, running `git --version` in Terminal offers to install it.
2. **Node.js 24 LTS:** https://nodejs.org (choose the LTS installer). Node 20.9 or later is the minimum. npm comes with Node. Check both:

```bash
node -v
```

```bash
npm -v
```

3. **VS Code:** https://code.visualstudio.com
4. **Claude Code for VS Code:** see section 6.

### 5.2 Clone the repository
```bash
git clone https://github.com/giulionovelli25-creator/Demo-Tyll.git
```

```bash
cd Demo-Tyll
```

If the repository holds the app inside a `tyll-platform` folder, `cd tyll-platform` as well. The folder you want is the one that contains `package.json`.

### 5.3 Install the packages
```bash
npm install
```

This installs everything in `package.json`: Next.js 16.4, React 19, TypeScript, Tailwind CSS 4, zustand, Recharts, lucide-react, ESLint and Vitest. No global packages are needed.

### 5.4 Run it
```bash
npm run dev
```

Open http://localhost:3000 and sign in with an account from section 3. The first run creates `.data/auth.json` with hashed credentials.

### 5.5 Check everything
```bash
npm run check
```

This runs, in order:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run test` | 87 Vitest tests |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |

### 5.6 Troubleshooting
- **`node: command not found`:** Node isn't on your PATH. On the original Mac it was installed in `~/.local/share/node-lts`. To add it permanently:

```bash
echo 'export PATH="$HOME/.local/share/node-lts/bin:$PATH"' >> ~/.zshrc
```

  Then open a new terminal. On a new machine, simply use the nodejs.org installer.
- **Turbopack error "spawning node pooled process":** an inherited environment variable is interfering. Start the server from a clean shell:

```bash
env -u PORT -u FORCE_COLOR -u MallocNanoZone npm run dev
```

- **Locked out after wrong PINs or passwords:** stop the server, delete the `.data` folder and start again. Sign-in data is rebuilt from `config/demo-accounts.json`.
- **Demo state looks stale:** use Settings → Reset demo, or clear the site's localStorage in the browser.

---

## 6. Continuing in Claude Code in VS Code

1. Install the extension: in VS Code open Extensions (⇧⌘X on Mac, Ctrl+Shift+X on Windows), search **"Claude Code"** (publisher: Anthropic), install it and sign in with your Claude account.
2. **File → Open Folder…** and choose the cloned project folder (the one with `package.json`).
3. Open Claude Code from the Claude icon in the sidebar, or with the command palette: "Claude Code: Open".
4. Give it context. The repo contains `CLAUDE.md`, which Claude Code reads automatically, and `HANDOVER.md` (this file). A good first message:

   > Read HANDOVER.md and CLAUDE.md. We have finished Stage 2. Run `npm run check` and confirm everything passes before we start Stage 3, Forecast and Purchasing.

5. To run the app, use VS Code's integrated terminal (Ctrl+`) for `npm run dev`.

### Pushing the work to GitHub
The local repo has **several commits that are not on GitHub yet**: Stage 1, the stock fix, both Stage 2 commits and these handover files. Run `git status` to see how many. Pushing failed earlier with a 403 because the stored token lacked write access. To push:

```bash
git push origin main
```

When asked for a password, use a GitHub **personal access token** with `repo` scope (GitHub → Settings → Developer settings → Personal access tokens), not your account password. Alternatively, run `gh auth login` with the GitHub CLI. Never paste tokens into chat or commit them.

Important: these commits exist only on the original Mac until they are pushed. Push **before** cloning on the new machine.

---

## 7. Skills used in this work

These are Claude Code skills or plugins, installed per user, not part of the repo. Install them on the new machine if you want the same behaviour:

- **frontend-design:** distinctive, non-generic interface design. It was used for the original Tyll visual design.
- **superpowers** (`using-superpowers`, `brainstorming`, `systematic-debugging` and others): a process-skills collection. It was loaded in the session.

In Claude Code, run `/plugin` to browse and install plugins. Neither skill is required to build or run the app.

---

## 8. Local memory (copied from Claude's memory on the original Mac)

Claude's memory is stored per machine and does not move with the repo. Its contents are reproduced here. The project rules are also in `CLAUDE.md`, so Claude Code picks them up automatically.

### Tyll project context
- Giulio Novelli works on Tyll.ai (tyll.ai), a hospitality financial and operational intelligence product for hotels and restaurants. Markets are the Gulf and DACH, with a Berlin base.
- Products: Tyll Money, Stock, Overview and Forecast, plus Flow and Rooms previews.
- A separate payment reconciliation demo already exists and must not be rebuilt.
- Product rules:
  - **Never blame staff.** Flag facts; never label an action fraud or theft. A POS login is not proof of who acted.
  - Profit without accounting or payroll data must be labelled an estimate.
  - Tyll runs read-only alongside existing POS and PMS systems, in Arabic and English. Owners see everything; managers see their own outlet.
  - Never present simulated data, rules-based text or untrained forecasts as live integrations or AI.
- Brand (measured from the live site):
  - Fonts: Inter (regular-weight headings, tight tracking) and Noto Sans Arabic.
  - Pill buttons (999px radius).
  - Easing: `cubic-bezier(.22,1,.36,1)`.
  - Use the cool white, silver and charcoal palette of the logo icon and waveform banner, not the site's warmer tones.
  - Never redraw the logo.

### Node install location (original Mac only)
- Node 24 LTS is in `~/.local/share/node-lts` and is not on PATH; there is no Homebrew.
- The preview launcher must `unset PORT FORCE_COLOR MallocNanoZone` before starting Turbopack.
- Next.js telemetry is disabled on that machine.

### Working preferences the owner has stated
- Work in stages, and **stop for approval after each stage**.
- Keep the existing design. Make focused changes, not rewrites.
- Keep explanations concise.
- Never claim a test passed unless it was actually run. Separate what fully works from what is simulated.
- Do not deploy publicly or connect real customer systems without approval.

## Stage 5: Guest experience and connected hotel operations (done, awaiting approval)
All under **Rooms & Guests** (`/rooms`); sections depend on the role (`src/components/guest/tabs.ts`).
- **Room readiness / Housekeeping** (`src/lib/server/guest.ts`, `components/guest/rooms.tsx`): ready-time estimates from rules in `src/lib/domain/guest.ts`, priority, helpers, inspection, issues, moving an arrival. Borrowed staff count only once Staff Support approves.
- **Bell & luggage** (`components/guest/bell.tsx`): requested → assigned → on the way → collected → delivered (handover note, not a signature) → completed.
- **Guest requests and Guest Connect** (`src/lib/server/guest-service.ts`, `components/guest/service.tsx`): a taxi is confirmed only with a recorded (simulated) reference. Venue requests are pending until the outlet accepts; capacity is rechecked on every acceptance; changes return to the venue; duplicates are refused. Availability is a simulated pattern.
- **Table requests**: outlet managers answer (accept, decline with reason, suggest a time). The spa and activities are answered by the GM.
- **Housekeeping supplies**: the supplies panel drafts a department purchase request (`deptId`) in the Stage 3 workflow; one open request per item; receiving raises stock.
- **Service performance** and the owner's one-line Overview strip: figures from recorded times only; no satisfaction score.
- Guest notices are merged into `/api/ops/alerts`; the owner gets at most one.
- Accounts: leila (front office, 3344), grace (housekeeping, 5566), maria (room attendant, 1122), lina (concierge, 7788), tomas (bell captain, 9900), yusuf (bell, 2233). Passwords are in `config/demo-accounts.json`.
- Demo clock: 20:55 plus real minutes elapsed since the store was created, capped at 23:59. Delete `.data/purchasing.json` to reset.
