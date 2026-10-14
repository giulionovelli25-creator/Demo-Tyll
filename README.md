# Tyll platform demo

An interactive demonstration of Tyll, the hospitality intelligence and operations platform, for a fictional two-hotel group (Grand Resort Dubai in AED, Grand Resort Doha in QAR). Modules: Overview, Money, Stock and investigations, Forecast and purchasing, Sales & Events with staff support, Rooms & Guests, Finance, Reports, and Tyll Staff for phones.

Everything is simulated. No real hotel system, guest, supplier, payment service or language model is connected. The separate Tyll payment reconciliation product is not rebuilt here.

**To present it, read [DEMO_WALKTHROUGH.md](DEMO_WALKTHROUGH.md).**

## Run it

Requires Node.js 20.9 or later and npm (the repository has a `package-lock.json`).

```bash
npm install
npm run dev -- -p 3210
```

Open http://localhost:3210. Settings are described in `.env.example`; copy it to `.env.local` to change them. In Claude Code or VS Code, open the `tyll-platform` folder and use the same commands in the terminal.

On the machine this was built on, Node lives in `~/.local/share/node-lts` and is not on the shell `PATH`: prefix commands with `PATH="$HOME/.local/share/node-lts/bin:$PATH"`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` then `npm run start` | Production build and server |
| `npm run test` | Automated tests of calculations, workflows, permissions, search, notifications and reset |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run check` | All of the above in one go |

## Demo accounts and reset

22 fictional people, grouped by department on the sign-in page. Credentials are in `config/demo-accounts.json`; the server stores only salted scrypt verifiers of them in `.data/auth.json`. Shared records are in `.data/purchasing.json`. The owner or general manager can reset them from **Settings → Reset demo data** or per story from the guided demo. Deleting `.data/` starts completely fresh.

## Security model

- **Sign-in:** email and password, checked on the server. Five wrong passwords lock the account for 15 minutes. Unknown emails and wrong passwords get the same answer.
- **Sessions:** a random token in an httpOnly, SameSite=Lax cookie (Secure in production). The server keeps only a hash of it. Sessions end after 60 minutes idle or 12 hours.
- **Management PIN:** owners, general managers, controllers, F&B directors and outlet managers unlock management data with a 4 to 6 digit PIN, checked on the server. The unlock lapses after 10 minutes without activity, or at once with "Lock now". Five wrong PINs end the session and block PIN entry for 15 minutes.
- **Pages:** `src/proxy.ts` runs on the server before every page request and redirects anyone without a session, or whose role may not open the page.
- **Data:** the browser no longer generates any data. `/api/data` returns only the records the user may see, filtered on the server, and refuses (423) until the PIN is entered. Orders are fetched one request at a time from `/api/orders`, which hides orders from other outlets behind the same "not found" as missing ones. Operational staff receive quantities only, with no sales, costs or cases.
- **Cross-site requests:** state-changing auth endpoints accept only same-origin JSON.
- **Audit:** sign-ins, failures, lockouts, PIN unlocks, locks, sign-outs and data requests are logged on the server and shown in Settings.

Settings for testing: `TYLL_PIN_IDLE_SECONDS`, `TYLL_SESSION_IDLE_SECONDS`, `TYLL_SESSION_MAX_SECONDS`, `TYLL_AUTH_STORE`. Set `TYLL_DEMO_MODE=off` to hide the demo account list and PIN hints.

Still open: changes users make (closing cases, logging waste) are saved in the browser, not yet on the server, and reference data such as the menu, recipes and list prices ships with the page code. Both move server-side in Phase 3.

## How it is built

Next.js (App Router), TypeScript, Tailwind CSS v4, Recharts, Lucide icons, Zustand, Vitest.

```
src/lib/types.ts            the shared data model
src/lib/data/catalog.ts     hotels, outlets, menu, recipes, ingredients, people (all fictional)
src/lib/data/generate.ts    deterministic generator for 60 days of orders, postings, stock and rooms
src/lib/domain/             all business logic, with no UI code
  orders.ts                 order arithmetic and order history
  detect.ts                 rules that flag unusual transactions and room-charge postings
  explain.ts                evidence-based investigation wording (rules, not a language model)
  metrics.ts                every financial figure on every screen
  pricing.ts                ingredient and recipe cost as of a date
  inventory.ts              estimated stock, waste cost, count variance, three-way match
  forecast.ts               demand forecast and purchase suggestions
  operations.ts             service delay prediction and housekeeping timing
  access.ts                 roles, scopes and permission checks
src/lib/adapters.ts         interfaces a real POS, PMS, stock or ledger integration implements
src/lib/store.ts            everything a user changes, with permission checks and an audit trail
src/components/             design system (ui.tsx, charts.tsx), shell, and module components
src/app/                    one folder per screen
```

One dataset feeds every module, and every figure is calculated from records rather than typed in. Logging waste lowers estimated stock and raises waste cost on the Overview and in Reports. Changing an ingredient price changes recipe costs, margins and forecast order values. Closing an investigation moves its amount from potential loss to confirmed loss or recovered everywhere it appears.

The demo runs on a fixed business date, Tuesday 13 October 2026 at 8:55 PM, so the numbers are the same every time.

### Brand

Type, pill buttons and easing follow tyll.ai (Inter at regular weight with tight tracking, Noto Sans Arabic for Arabic). The palette is the cool white and silver of the supplied icon and banner. The two supplied images are in `public/brand/`. `scripts/brand-assets.mjs` derives the transparent logo and the wave background from them without redrawing anything.

## What is simulated, estimated or planned

- **Simulated:** all POS, PMS, reservation, delivery and stock records; live tickets in Flow; rooms and arrivals.
- **Estimated and labelled as such:** labor (from rostered hours), other operating costs (allocated), and therefore operating profit. No ledger or payroll is connected, so no figure is presented as accounting or net profit.
- **Rules, not AI:** investigation explanations are assembled from recorded facts by rules. No language model is called.
- **Arithmetic, not a trained model:** the forecast is transparent arithmetic on four weeks of history with stated assumptions.
- **Browser only:** sign-in, permissions, saved changes and the audit trail live in this browser's storage. Offline waste entries synchronise into that storage, not to a server.
- **Previews:** tip distribution, Flow and Rooms are interactive previews. Room-damage charges, expiry and linen tracking, banqueting, and Winnow and Orbisk links are planned.

**Settings → Data sources** shows the same list inside the app.

## Deploying

The app is a standard Next.js project with no environment variables, database or secrets.

- **Vercel or similar:** import the repository and deploy with the defaults.
- **Your own server:** `npm run build`, then `npm run start` behind a reverse proxy.

Do not present a deployed copy as a live product, and do not connect real customer data to this codebase as it stands.

## Before genuine customer use

1. Single sign-on and multi-factor sign-in through the customer's identity provider, plus password reset and account management.
2. A managed database with backups, migrations and tenant isolation in place of the local auth file and browser storage, and server-side saving of every user action.
3. Tested adapters for each customer's POS, PMS, stock and accounting systems, with reconciliation of Tyll's totals against the systems of record.
4. An independent security review and penetration test, dependency scanning, and secrets management.
5. Monitoring, alerting, error tracking and an incident process.
6. Data-protection work for each country: processing agreements, hosting location, retention, cross-border transfer rules (UAE PDPL, Qatar PDPPL, GDPR for the Berlin establishment).
7. Legal review of anything that touches staff (monitoring by POS login, tip rules) in each jurisdiction, and works-council or labor-law requirements where they apply.
8. Accessibility audit and full Arabic localisation beyond the staff waste app.
9. Load testing with real data volumes. The demo holds about 34,000 orders in memory.
