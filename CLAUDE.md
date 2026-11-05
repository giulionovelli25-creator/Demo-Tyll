# Tyll platform demo: instructions for Claude

Tyll is a hospitality intelligence and operations platform. This repository is its interactive demo for a fictional two-hotel group. Read `HANDOVER.md` (what was built, stage by stage), `DEMO_WALKTHROUGH.md` (how it is presented) and `AGENTS.md` (Next.js 16 differs from older versions; `src/proxy.ts` replaces middleware).

## Status
Stages 1–7 are complete. Stage 7 was the final planned stage: integration, notifications, search, guided demo, reset and polish. Do not start new feature stages without the owner's approval; prefer making existing workflows reliable over adding features.

## Architecture
- Next.js 16 App Router, React 19, TypeScript, Tailwind v4, zustand, Vitest. `npm run check` runs type-check, lint, tests and build.
- **Server records** (`src/lib/server/*`, one JSON store `.data/purchasing.json` via `loadStore`/`mutateStore`): purchasing and prep, events and staff support, rooms and guest service, finance, sales, shared waste and counts, notifications. API routes in `src/app/api/*` call these functions; every route uses `guard()` and checks permissions, hotel and record ownership itself.
- **Browser-held (Stage 2):** investigation decisions, price and recipe changes and receipt corrections live in the zustand store (`src/lib/store.ts`). Waste and counts made in the browser are uploaded once to the server (`src/lib/shared-stock.ts`).
- **The dataset** (`src/lib/data/generate.ts`) is deterministic: sales, deliveries with supplier invoices, counts and the seeded investigations.
- **Notifications:** `src/lib/server/notify.ts`. Call `notify()` inside a store change when work passes to someone else, and `resolve()` when it is done. Emails are logged as previews unless a provider is configured.
- **Search:** `src/lib/server/search.ts`, built only from the same list functions the screens use, so results respect access.
- **Guided demo and reset:** `src/components/shell/demo-guide.tsx` and `src/lib/server/demo.ts`. When you add seeded data, make sure the reset scopes restore it.

## Navigation rules
- The four main features are Log waste (`/waste`), Stock (`/stock`), Predictions (`/forecast`) and Revenue (`/money`). The sidebar has Overview on its own at the top, then seven items in this order: those four, Drinks control (`/drinks`), Alerts, Reports and settings (`PRIMARY` in `app-shell.tsx`). Stock and Alerts show a count of what is waiting. Phones get a bottom bar of six, where Log waste opens the sheet; Reports and settings moves to the profile menu. Links do a full page load only when the public demo must change role (`demoRoleFits`), so switching pages stays instant. Settings is linked from Reports and settings and the profile menu. Coming soon modules are on `/more`.
- Every main page starts the same way: `PageHeader` (title and the question the page answers), `SummaryBar` (a few numbers and the one primary button), then `Section` and `SectionLink` rows. One primary button per screen; secondary actions are text links (`textLink`).
- Every sub page has one exit, `BackToMain` in the sticky top bar of `app-shell.tsx`, so it never covers content, ruled by `lib/back.ts`: it returns to the main page you came from, or the page's own main page. Never add a page's own exit to its main page. Steps inside a section (such as All items) stay on the page.
- Nothing long is visible by default. A list with its own filters and search gets a sub page (`SectionLink`). Short context gets a `Section`, which remembers open or closed per person in this browser. Every closed row says in one line what is inside. At most one chart per page by default.
- Anything shown on two pages lives on one page and is linked from the other. The order recommendation lives on Predictions. Over pouring and missing drinks live on Drinks control, with sold, used and not explained always on show, and the detail in closed rows. Flagged bills live on the Flags tab of Revenue. `topAlerts` puts one alert from each area first. One job is one alert: critical items, low items and supplier invoices are each grouped, and every amount says what it is (to order, at risk, not billed). An order is never counted as money at risk. Suppliers, recipes, count records and settings are reached from Reports and settings.
- Overview has four feature cards with one number, one line and one button each, one small chart and the three most important alerts.
- Frontline staff use `/staff` (phone-first). `/count` is a full screen flow with no sidebar.

## Design rules
- The look comes from the brand artwork: black logo, white cards, the supplied silver waves behind every page (`--wave-image`), and a glass sidebar. Primary actions are black. Light is the default; dark is an optional toggle in the profile menu.
- Each section has one accent, set with `data-mod` (`MODULE_TONE` in `components/theme.ts`, values in `tokens.css`): teal for Log waste and Stock, violet for Predictions, blue for Revenue, indigo for Overview and Alerts, plum for Reports. Links, labels, quiet buttons and money figures inside follow it, so never pick a colour by hand.
- Try a look (`components/shell/look-picker.tsx`, `lib/look.ts`) lets the owner switch colours live: by section, by outlet, or one signature colour, and how strong the waves are. It is a decision tool. Once a look is chosen, make it the default and remove the panel.
- All colours, type sizes, radii and shadows are tokens in `src/app/tokens.css`. Red, amber and green only for status. Chart colours are validated separately (`--chart-a`, `--chart-b`).
- Motion is 150 to 200 ms and only answers a person's action. No dashes as punctuation in copy.

## Stock prediction and Pour Control
- Item lists sit under hotel categories (`STOCK_GROUPS`, `groupByStock` in `lib/data/locations.ts`). Stock, Predictions and Log waste are split into Food, Beverage and Inventory (`stockAreaOf` in `lib/data/locations.ts`). Inventory is glassware, china and hotel supplies. Waste and breakage share one record system; only the views are separate. Build order still makes one draft across all three.
- `monthPlanFor` in `lib/server/purchasing.ts` is the one plan to month end. Overview, Stock and All alerts all read it through `lib/alert-feed.tsx`, so they agree. `buildMonthOrder` turns it into one draft request.
- Critical means an order placed today would arrive too late. Low means the order must go by tomorrow, or under half of par is left.
- `lib/domain/pour.ts`: glasses sold are POS lines. **Bottles opened are simulated**, because the POS does not record them, and the one house wine on the menu is shared across four labels. Say so on screen. Never name staff in Pour Control.
- Log waste (`components/shell/breakage.tsx`) covers food, drinks and inventory, and must stay two taps on its page: item, number. Count (`components/stock/count-flow.tsx`) keeps its walking order on the server (`countRoutes`) and its progress in the browser.

## Source-of-truth rules
- One record per thing: purchase requests, events, rooms, tasks and invoices are never copied. Finance figures are derived from requests, deliveries and invoices; Stage 3's budget panel reads the same function.
- Keep stages of money apart: requested, approved commitment, delivered, invoiced, recorded expense. Payments are not recorded. Pipeline, contract value and revenue are different. AED and QAR are never added together.
- Corrections never overwrite: add a correction record and keep the original.

## Product rules
- Never blame staff. Show facts and uncertainty; never label anything fraud or theft. Possible causes are hypotheses until verified.
- Label estimates and simulated data. Nothing here is AI or a live integration. Never claim an email, booking or confirmation happened unless it did.
- Hiding a button is not security: check on the server.

## Seeded demo cases
The public demo sends a shorter list of flags (`lib/data/demo-cases.ts`, applied in `lib/server/snapshot.ts`): the worked examples, the largest open case at each outlet and recent closed cases. Every other mode keeps the full set.
Coca-Cola at The Terrace (8 cans unexplained), house wine at Lobby Lounge (750 ml; 250 ml at 175 ml), wagyu beef (1.8 kg), the hero order TRC-1013-198, VIP suite 1211 predicted late, EVT-DXB-0001 short of staff, invoice MEAT-1011 (chicken invoiced beyond delivery). Tests in `src/lib/__tests__` pin these numbers; keep them passing.

## Languages
English, German, Italian and Arabic, chosen in the top bar (`components/shell/language.tsx`). Screens stay written in English: `lib/i18n/dom.ts` translates text as it renders and `lib/i18n/translate.ts` looks it up in `lib/i18n/messages.json`. Figures, dates, codes and names are lifted out first, so `{0} items` covers every count. Text with no entry shows in English; `window.__tyllMissing` lists it. Use logical classes (`ms-`, `pe-`, `start-`, `text-end`), never `ml-`, `pr-`, `left-` or `text-right`, so Arabic mirrors.

## Brand
Inter and Noto Sans Arabic, regular weight titles with tight tracking, pill buttons, ease `cubic-bezier(.22,1,.36,1)`, white and black with silver waves, one accent per section. The logo is the supplied artwork; the wordmark shows "Tyll" (`public/brand/tyll-lockup-ink-tyll.png`). Never redraw it.

## Working rules
- Show the owner the production build (preview config `tyll-platform`, `next start`), rebuilt with `npm run check`. Live reload on the dev server (`tyll-dev`) can send open tabs into a reload loop, so use dev only while editing, with one tab open.
- Make focused changes; keep the design. Run `npm run check` and test in a browser before reporting. Do not run a build while the dev server is running without restarting the dev server after. `USER_TEST.md` is the script for testing with hotel managers. Never claim a test passed unless it ran.
- The public demo has no entry page or sign-in: any address opens directly as a role that may see it. `/welcome` only shows if the demo cannot start.
- Do not deploy publicly, connect real systems, or commit secrets. Do not ask for GitHub tokens; the owner pushes with `git push origin main`.
