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
- The sidebar has six items, in this order: Overview, Stock, Orders, Money, Waste and Breakage, Reports (`PRIMARY` in `app-shell.tsx`). Phones get the same places in a bottom bar. Settings, More tools and All alerts are in the profile menu. Coming soon modules are on `/more`. Orders keeps its `/forecast` address, so old links work.
- Every page starts the same way (`PageHeader`): title, one question it answers, a one line summary, the primary action top right. Key numbers (`KeyNumbers`) come next, then detail.
- Anything shown on two pages lives on one page and is linked from the other. The order recommendation lives on Stock. Pour Control lives in Money. Flags live in Money.
- Overview has five cards with one number, one line and one button each.
- Frontline staff use `/staff` (phone-first). `/count` is a full screen flow with no sidebar.

## Design rules
- All colours, type sizes, radii and shadows are tokens in `src/app/tokens.css`, one set per theme. Light is the default; dark is an optional toggle in the profile menu. Never hard-code a colour in a component.
- Navy for primary actions, copper only for money, red, amber and green only for status. Keep it restrained. Chart colours are validated separately (`--chart-a`, `--chart-b`).
- Motion is 150 to 200 ms and only answers a person's action. No dashes as punctuation in copy.

## Stock prediction and Pour Control
- Stock and Waste and Breakage are split into Food, Drinks and Inventory (`stockAreaOf` in `lib/data/locations.ts`). Inventory is glassware, china and hotel supplies. Waste and breakage share one record system; only the views are separate. Build order still makes one draft across all three.
- `monthPlanFor` in `lib/server/purchasing.ts` is the one plan to month end. Overview, Stock and All alerts all read it through `lib/alert-feed.tsx`, so they agree. `buildMonthOrder` turns it into one draft request.
- Critical means an order placed today would arrive too late. Low means the order must go by tomorrow, or under half of par is left.
- `lib/domain/pour.ts`: glasses sold are POS lines. **Bottles opened are simulated**, because the POS does not record them, and the one house wine on the menu is shared across four labels. Say so on screen. Never name staff in Pour Control.
- Breakage (`components/shell/breakage.tsx`) must stay three taps. Count (`components/stock/count-flow.tsx`) keeps its walking order on the server (`countRoutes`) and its progress in the browser.

## Source-of-truth rules
- One record per thing: purchase requests, events, rooms, tasks and invoices are never copied. Finance figures are derived from requests, deliveries and invoices; Stage 3's budget panel reads the same function.
- Keep stages of money apart: requested, approved commitment, delivered, invoiced, recorded expense. Payments are not recorded. Pipeline, contract value and revenue are different. AED and QAR are never added together.
- Corrections never overwrite: add a correction record and keep the original.

## Product rules
- Never blame staff. Show facts and uncertainty; never label anything fraud or theft. Possible causes are hypotheses until verified.
- Label estimates and simulated data. Nothing here is AI or a live integration. Never claim an email, booking or confirmation happened unless it did.
- Hiding a button is not security: check on the server.

## Seeded demo cases
Coca-Cola at The Terrace (8 cans unexplained), house wine at Lobby Lounge (750 ml; 250 ml at 175 ml), wagyu beef (1.8 kg), the hero order TRC-1013-198, VIP suite 1211 predicted late, EVT-DXB-0001 short of staff, invoice MEAT-1011 (chicken invoiced beyond delivery). Tests in `src/lib/__tests__` pin these numbers; keep them passing.

## Brand
Inter and Noto Sans Arabic, pill buttons, ease `cubic-bezier(.22,1,.36,1)`, warm off white base, deep navy for actions, copper for money. The logo is the supplied artwork; the wordmark shows "Tyll" (`public/brand/tyll-lockup-ink-tyll.png`). Never redraw it.

## Working rules
- Make focused changes; keep the design. Run `npm run check` and test in a browser before reporting. Never claim a test passed unless it ran.
- Do not deploy publicly, connect real systems, or commit secrets. Do not ask for GitHub tokens; the owner pushes with `git push origin main`.
