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
- Each role sees a few main modules (`PRIMARY` in `app-shell.tsx`); the rest sits under "More" and in search. The owner sees Overview, Investigations, Finance and Reports, plus outcomes; no operational forms.
- Frontline staff use `/staff` (phone-first, `components/staff/staff-app.tsx`); quick actions follow `staffActions()`.
- Module pages open on "What do you want to do?" choices (`ModuleHub`), each with a `?` explanation (`components/help.tsx`, texts in `HELP`).

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
Inter and Noto Sans Arabic, pill buttons, ease `cubic-bezier(.22,1,.36,1)`, cool white, silver and charcoal. The logo is the supplied artwork; the wordmark shows "Tyll" (`public/brand/tyll-lockup-ink-tyll.png`). Never redraw it.

## Working rules
- Make focused changes; keep the design. Run `npm run check` and test in a browser before reporting. Never claim a test passed unless it ran.
- Do not deploy publicly, connect real systems, or commit secrets. Do not ask for GitHub tokens; the owner pushes with `git push origin main`.
