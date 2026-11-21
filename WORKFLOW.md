# Work and Review Log

This file records every step taken to build the project. It also records the review protocol that
was followed, so a reviewer can repeat it.

## Review protocol

Before changing or adding anything:

1. List every file the change touches and read them in one pass.
2. Write the edit.
3. Run the single relevant check once: typecheck, lint, build or `npm run verify`.
4. State the next action explicitly. Never guess a value or an API shape.

Rules for this log: English only, no em dash, no emoji, no secrets, one line per action.

## Steps

### Step 1. Read the specification

- Files read: `.cloud-attachments/*.txt` (transcript), `Prueba_tecnica_programa_lealtad.pdf`.
- Decisions: fixed cutoff 2026-04-30, Mexico UTC-6, money in integer cents, points as a ledger.
- Next action: install the requested web skill and scaffold the app.

### Step 2. Install Modern Web Guidance

- Command: `npx modern-web-guidance@latest install --agent claude-code -y`.
- Result: `.claude/skills/modern-web-guidance/`, `skills-lock.json`.
- Guides retrieved and applied: `responsive-table`, `forms`, `dark-mode`,
  `validate-input-after-interaction`, `accessible-error-announcement`.
- Next action: scaffold Next.js.

### Step 3. Scaffold

- Command: `npx create-next-app@latest scaffold --ts --app --no-tailwind-flags`.
- Review: `AGENTS.md`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `next.config.ts`,
  `tsconfig.json`, `.gitignore`, `eslint.config.mjs`, `node_modules/next/dist/docs/*`.
- Change: removed Cache Components and Partial Prefetching because every route depends on the
  session, and marked PGlite and pg as server external packages.
- Next action: design the schema before writing any page.

### Step 4. Data model and rules

- Files added: `lib/constants.ts`, `lib/db/schema.ts`, `lib/db/index.ts`, `lib/loyalty.ts`.
- Review: cutoff handling, refund pair, spend window edges, birthday year wrap.
- Check: `npx drizzle-kit generate --name init` produced `drizzle/0000_init.sql` for 13 tables.
- Next action: migrations, seed and a verification suite before building screens.

### Step 5. Sync and redemption writes

- Files added: `lib/sync.ts`, `lib/redeem.ts`, `lib/storage.ts`, `lib/auth.ts`.
- Review: pagination ceiling, 429 backoff, upsert keys, deletion limited to source movements,
  serializable retry, conditional stock update, hashed cookies.
- Check: `npm run verify` after the first test pass; three expectations were wrong and were fixed
  in the test, not in the rules (level of 55,470 MXN is Bronce, 200,000 MXN is 20,000 points, the
  second redemption is blocked by stock for a customer with a balance).
- Next action: build the panel screens.

### Step 6. Panel screens

- Files added: `app/login`, `app/admin/*`, `app/api/staff/*`, `components/*`, `lib/queries.ts`.
- Review: every page calls `requirePermission`, every action re-checks it, amounts hidden without
  `customers:amounts`, last administrator protected, one-time password page is `no-store`.
- Check: `npx tsc --noEmit` and `npm run lint`, both clean.
- Next action: catalog, redemptions, users, roles, tokens, sync screens.

### Step 7. Portal and public API

- Files added: `app/portal/*`, `app/actions/portal.ts`, `app/api/fidelizacion/*`,
  `app/api/cron/sync/route.ts`, `vercel.json`.
- Review: customer id only from the session, forced password change, exact Spanish field names in
  the API, CORS preflight, constant time cron secret comparison.
- Next action: documentation, then one build and one test run.

### Step 8. Documentation

- Files added: `README.md`, `WORKFLOW.md`, `.env.example`.
- Review: env names match the code, two Mermaid diagrams, limitations listed.
- Next action: run the final checks once.

### Step 9. Final checks

- Commands: `npm run typecheck` (clean), `npm run lint` (clean), `npm run verify` (9 tests, 0
  failures), `npm run build` (30 routes compiled).
- Review: every panel route answered 200 with an authenticated session, `/admin` answered 307
  without one, `/api/fidelizacion/riesgo` answered 401 without a token and exposed
  `Access-Control-Allow-Origin: *` on `OPTIONS`.
- Review: portal pages and the three API endpoints were exercised with a temporary fixture row,
  then the fixture was deleted from the local database.
- Next action: set `FAKEAPI_API_KEY` and run the synchronisation, then deploy and confirm the
  public link opens without a Vercel session.

### Step 10. Real synchronisation

- Files read: `lib/sync.ts`, `lib/constants.ts`, `app/api/cron/sync/route.ts`.
- Review: `GET /api/v1/{users,orders,payments}` with the key returns `{ success, data, meta }` and
  `meta.total_pages` (10, 31 and 35 pages at `per_page=100`).
- Change: every write became a multi row statement (`chunk`, `ensureClientAccounts`, upserts that
  read `excluded.<column>`), because one round trip per row could not fit in a function limit.
- Change: page one is read first, then the remaining pages in waves of four and reassembled in
  page order. Measured cause: about 1.1 seconds per page sequentially, 2.1 seconds for eight pages
  concurrently.
- Check: full run against the real API, 76 requests, 7522 records, 22.2 seconds (previously 66.4
  seconds, above the 60 second Hobby limit), same counts and levels before and after the change:
  1000 customers, 3047 orders, 3475 payments, 3141 movements, Bronce 505, Plata 427, Oro 68.
- Next action: make the repository deployable without any manual step.

### Step 11. Vercel readiness

- Files read: `package.json`, `vercel.json`, `README.md`, `scripts/seed.ts`, `.env.example`
  (variable names only).
- Change: `package.json` gained `vercel-build`, which runs `db:migrate`, then `db:seed`, then
  `next build`, so a fresh Neon database becomes usable on the first deployment with no local step.
- Change: the README deploy section became seven numbered steps (Neon, import, variables, deploy,
  first sync, API token, delivery check) and states which variables are required and why.
- Review: `.env.example` already lists every name the new build step needs, so it was not edited.
- Next action: run the final checks once, then import the repository in Vercel.

## Files read before each edit

The following were read in a single pass before the first edit of each area, not re-read
afterwards:

- Configuration: `package.json`, `next.config.ts`, `tsconfig.json`, `.gitignore`,
  `eslint.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `AGENTS.md`.
- Guidance: `.claude/skills/modern-web-guidance/SKILL.md`, `.notes/mwg-guides.md`.
- Next.js 16 behaviour: `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`,
  `15-route-handlers.md`, `16-proxy.md`, `02-guides/authentication-with-cache-components.md`.
- Before the data layer: every file under `lib/` that already existed.
- Before the screens: `lib/auth.ts`, `lib/queries.ts`, `components/ui.tsx`.
