# Tyll platform demo: instructions for Claude

Read `HANDOVER.md` first. It describes what has been built, the stage plan, the demo accounts and the setup steps. Also read `AGENTS.md`: this project uses Next.js 16, which differs from older versions (for example, `src/proxy.ts` replaces middleware).

## Working rules
- Work in stages, and stop for the owner's approval after each one. Stages 1–6 are complete; Stage 7 waits for approval.
- Keep the existing design and branding. Make focused changes, not rewrites. Do not rebuild the payment reconciliation product.
- Before reporting work as done, run `npm run check` (type-check, lint, tests and build), and test in a browser where possible. Never claim a test passed unless it was run.
- Do not deploy publicly or connect real customer systems without approval.
- Keep explanations concise.

## Product rules
- Never blame staff. Show facts and uncertainty; never label anything fraud or theft. A POS login is not proof of who acted.
- Label estimates as estimates, including profit without accounting data. Label simulated data and rules-based text as such; nothing here is AI or a live integration.
- Permissions are enforced in two places: the server (`src/lib/server/*`, `src/proxy.ts`) and the store actions (`src/lib/store.ts`). Managers see only their outlets. Calculations that need other outlets' data run on the server.
- Corrections never overwrite records: add a correction record and keep the original.

## Brand
Inter and Noto Sans Arabic, pill buttons, ease `cubic-bezier(.22,1,.36,1)`, and a cool white, silver and charcoal palette. Never redraw the logo.
