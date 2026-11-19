# Overnight build log

Branch `feature/overnight-checks`, started from `feature/visit-tracking` (1fdbe6d), which holds all earlier work (purchasing, audit fixes, visit tracking). The brief is in `OVERNIGHT_BRIEF.md`.

## How to work in this repo (for any session picking this up)

- Node: `export PATH=~/.local/share/node-lts/bin:$PATH; unset PORT FORCE_COLOR`
- Checks: `node node_modules/typescript/bin/tsc --noEmit -p .`, `node node_modules/eslint/bin/eslint.js src` (0 errors; 2 old warnings in `domain.test.ts`), `node node_modules/vitest/vitest.mjs run`, build `node node_modules/next/dist/bin/next build` (the first run stops on Next.js's known-vulnerability check; run it again and it succeeds).
- App: the preview server `tyll-platform` serves the last build on http://localhost:3210 (`next start`). After a build, restart it so it serves the new code.
- Screenshots: `node scripts/screenshot.mjs <path> overnight-screenshots/<feature>-desktop.png --width 1440 --role u-fnb`, phone with `--width 375`, Arabic with `--lang ar`. Uses the Chrome installed on this Mac.

## Decisions

- **Screenshots without Playwright:** Playwright is not installed and downloading its browser is not allowed here, so `scripts/screenshot.mjs` drives the installed Chrome through its debugging protocol. Same result: full-page PNGs at 1440 and 375 wide, in any role or language.

## Progress

| # | Feature | Status | Notes |
|---|---|---|---|
| 0 | Learn the demo | in progress | |
